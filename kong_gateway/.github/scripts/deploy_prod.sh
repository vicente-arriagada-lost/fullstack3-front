#!/usr/bin/env bash
set -euo pipefail

DEPLOYMENT_ID=""

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

get_param() {
  local key="$1"
  aws ssm get-parameter --name "${CONTRACT_PREFIX}/${key}" --query 'Parameter.Value' --output text
}

build_register_payload() {
  local td_json="$1"
  jq -c --arg family "$TASK_FAMILY" '
    {
      family: $family,
      taskRoleArn: .taskRoleArn,
      executionRoleArn: .executionRoleArn,
      networkMode: .networkMode,
      containerDefinitions: .containerDefinitions,
      volumes: (.volumes // []),
      placementConstraints: (.placementConstraints // []),
      requiresCompatibilities: (.requiresCompatibilities // []),
      cpu: .cpu,
      memory: .memory,
      runtimePlatform: .runtimePlatform,
      proxyConfiguration: .proxyConfiguration,
      ephemeralStorage: .ephemeralStorage
    }
    | with_entries(select(.value != null))
  ' <<<"$td_json"
}

print_deploy_diagnostics() {
  if [[ -z "$DEPLOYMENT_ID" ]]; then
    return 0
  fi

  aws deploy get-deployment --deployment-id "$DEPLOYMENT_ID" \
    --query 'deploymentInfo.{status:status,errorInformation:errorInformation,createTime:createTime,completeTime:completeTime}' \
    --output json || true
}

trap print_deploy_diagnostics ERR

require_env AWS_REGION
require_env IMAGE_URI

CONTRACT_PREFIX="${KONG_DEPLOY_CONTRACT_PREFIX:-/smartlogix/kong/deploy}"

CLUSTER_NAME="$(get_param cluster_name)"
SERVICE_NAME="$(get_param service_name)"
CONTAINER_NAME="$(get_param container_name)"
CONTAINER_PORT="$(get_param container_port)"
TASK_FAMILY="$(get_param task_definition_family)"
CLOUDMAP_NAMESPACE_NAME="$(get_param cloudmap_namespace_name)"
CODEDEPLOY_APP_NAME="$(get_param codedeploy_app_name)"
CODEDEPLOY_GROUP_NAME="$(get_param codedeploy_deployment_group_name)"

CURRENT_TASK_DEFINITION_ARN="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --query 'services[0].taskDefinition' --output text)"
BASE_TASK_DEFINITION_JSON="$(aws ecs describe-task-definition --task-definition "$CURRENT_TASK_DEFINITION_ARN" --query 'taskDefinition' --output json)"

PATCHED_TASK_DEFINITION_JSON="$(jq -c --arg container "$CONTAINER_NAME" --arg image "$IMAGE_URI" --arg ns "$CLOUDMAP_NAMESPACE_NAME" '
  .containerDefinitions |= map(
    if .name == $container then
      .image = $image |
      .environment = ((.environment // []) | map(select(.name != "KONG_SERVICE_DISCOVERY_NAMESPACE")) + [{"name":"KONG_SERVICE_DISCOVERY_NAMESPACE","value":$ns}])
    else
      .
    end
  )
' <<<"$BASE_TASK_DEFINITION_JSON")"

REGISTER_PAYLOAD="$(build_register_payload "$PATCHED_TASK_DEFINITION_JSON")"
NEW_TASK_DEFINITION_ARN="$(aws ecs register-task-definition --cli-input-json "$REGISTER_PAYLOAD" --query 'taskDefinition.taskDefinitionArn' --output text)"

APPSPEC_CONTENT="$(jq -c -n \
  --arg taskDef "$NEW_TASK_DEFINITION_ARN" \
  --arg container "$CONTAINER_NAME" \
  --argjson port "$CONTAINER_PORT" \
  '{
    version: "0.0",
    Resources: [
      {
        TargetService: {
          Type: "AWS::ECS::Service",
          Properties: {
            TaskDefinition: $taskDef,
            LoadBalancerInfo: {
              ContainerName: $container,
              ContainerPort: $port
            }
          }
        }
      }
    ]
  }')"

REVISION_JSON="$(jq -c -n --arg content "$APPSPEC_CONTENT" '{revisionType:"AppSpecContent", appSpecContent:{content:$content}}')"

DEPLOYMENT_ID="$(aws deploy create-deployment \
  --application-name "$CODEDEPLOY_APP_NAME" \
  --deployment-group-name "$CODEDEPLOY_GROUP_NAME" \
  --revision "$REVISION_JSON" \
  --query 'deploymentId' \
  --output text)"

aws deploy wait deployment-successful --deployment-id "$DEPLOYMENT_ID"

echo "Production deployment completed"
echo "Deployment ID: ${DEPLOYMENT_ID}"
