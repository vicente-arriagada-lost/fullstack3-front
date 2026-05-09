#!/usr/bin/env bash
set -euo pipefail

KONG_DEPLOYMENT_ID=""

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

get_param() {
  local prefix="$1"
  local key="$2"
  aws ssm get-parameter --name "${prefix}/${key}" --query 'Parameter.Value' --output text
}

build_register_payload() {
  local task_definition_json="$1"
  local family="$2"
  jq -c --arg family "$family" '
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
  ' <<<"$task_definition_json"
}

patch_pedidos_task_definition() {
  jq -c \
    --arg container "$PEDIDOS_CONTAINER_NAME" \
    --arg image "$IMAGE_URI" \
    --arg aws_region "$AWS_REGION" \
    --arg events_topic_arn "$EVENTS_TOPIC_ARN" '
    .containerDefinitions |= map(
      if .name == $container then
        .image = $image |
        del(.command) |
        .environment = ((.environment // [])
          | map(select(
              .name != "NODE_ENV"
              and .name != "DATABASE_SCHEMA"
              and .name != "DATABASE_SSL"
              and .name != "AWS_REGION"
              and .name != "EVENTS_TOPIC_ARN"
            ))
          + [
              {"name":"NODE_ENV","value":"main"},
              {"name":"DATABASE_SSL","value":"true"},
              {"name":"AWS_REGION","value":$aws_region},
              {"name":"EVENTS_TOPIC_ARN","value":$events_topic_arn}
            ])
      else
        .
      end
    )
  '
}

patch_kong_task_definition() {
  local stable_weight="$1"
  local canary_weight="$2"
  jq -c \
    --arg container "$KONG_CONTAINER_NAME" \
    --arg stable_weight "$stable_weight" \
    --arg canary_weight "$canary_weight" '
      .containerDefinitions |= map(
        if .name == $container then
          .environment = ((.environment // [])
            | map(select(.name != "KONG_PEDIDOS_STABLE_WEIGHT" and .name != "KONG_PEDIDOS_CANARY_WEIGHT"))
            + [
                {"name":"KONG_PEDIDOS_STABLE_WEIGHT","value":$stable_weight},
                {"name":"KONG_PEDIDOS_CANARY_WEIGHT","value":$canary_weight}
              ])
        else
          .
        end
      )
    '
}

create_kong_deployment() {
  local task_definition_arn="$1"
  local appspec_content revision_json
  appspec_content="$(jq -c -n \
    --arg taskDef "$task_definition_arn" \
    --arg container "$KONG_CONTAINER_NAME" \
    --argjson port "$KONG_CONTAINER_PORT" \
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

  revision_json="$(jq -c -n --arg content "$appspec_content" '{revisionType:"AppSpecContent", appSpecContent:{content:$content}}')"

  echo "Deploying Kong weight update with CodeDeploy config: ${KONG_WEIGHT_DEPLOYMENT_CONFIG}"

  KONG_DEPLOYMENT_ID="$(aws deploy create-deployment \
    --application-name "$KONG_CODEDEPLOY_APP_NAME" \
    --deployment-group-name "$KONG_CODEDEPLOY_GROUP_NAME" \
    --deployment-config-name "$KONG_WEIGHT_DEPLOYMENT_CONFIG" \
    --revision "$revision_json" \
    --query 'deploymentId' \
    --output text)"

  aws deploy wait deployment-successful --deployment-id "$KONG_DEPLOYMENT_ID"
}

deploy_kong_weights() {
  local stable_weight="$1"
  local canary_weight="$2"
  local current_kong_task_definition_arn base_kong_task_definition_json patched_kong_task_definition_json register_payload new_kong_task_definition_arn

  current_kong_task_definition_arn="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$KONG_SERVICE_NAME" --query 'services[0].taskDefinition' --output text)"
  base_kong_task_definition_json="$(aws ecs describe-task-definition --task-definition "$current_kong_task_definition_arn" --query 'taskDefinition' --output json)"
  patched_kong_task_definition_json="$(patch_kong_task_definition "$stable_weight" "$canary_weight" <<<"$base_kong_task_definition_json")"
  register_payload="$(build_register_payload "$patched_kong_task_definition_json" "$KONG_TASK_FAMILY")"
  new_kong_task_definition_arn="$(aws ecs register-task-definition --cli-input-json "$register_payload" --query 'taskDefinition.taskDefinitionArn' --output text)"
  create_kong_deployment "$new_kong_task_definition_arn"
}

smoke_test_canary_route() {
  local listener_arn="$1"
  local lb_arn alb_dns status_code
  lb_arn="$(aws elbv2 describe-listeners --listener-arns "$listener_arn" --query 'Listeners[0].LoadBalancerArn' --output text)"
  alb_dns="$(aws elbv2 describe-load-balancers --load-balancer-arns "$lb_arn" --query 'LoadBalancers[0].DNSName' --output text)"

  status_code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Host: ${PROD_HOST_HEADER}" \
    --connect-timeout 5 \
    --max-time 15 \
    "http://${alb_dns}/api/pedidos/00000000-0000-4000-8000-000000000000/estado")"

  if [[ "$status_code" != "404" ]]; then
    echo "Smoke test failed. Expected 404 from pedidos service, got ${status_code}." >&2
    exit 1
  fi
}

rollback_canary() {
  if [[ -n "${CLUSTER_NAME:-}" && -n "${KONG_SERVICE_NAME:-}" ]]; then
    deploy_kong_weights 100 0 || true
  fi

  if [[ -n "${CLUSTER_NAME:-}" && -n "${CANARY_SERVICE_NAME:-}" ]]; then
    aws ecs update-service --cluster "$CLUSTER_NAME" --service "$CANARY_SERVICE_NAME" --desired-count 0 >/dev/null 2>&1 || true
  fi
}

print_deploy_diagnostics() {
  if [[ -n "$KONG_DEPLOYMENT_ID" ]]; then
    aws deploy get-deployment --deployment-id "$KONG_DEPLOYMENT_ID" \
      --query 'deploymentInfo.{status:status,errorInformation:errorInformation,createTime:createTime,completeTime:completeTime}' \
      --output json || true
  fi
}

trap 'print_deploy_diagnostics; rollback_canary' ERR

require_env AWS_REGION
require_env IMAGE_URI

PEDIDOS_PREFIX="${PEDIDOS_DEPLOY_CONTRACT_PREFIX:-/smartlogix/pedidos/deploy}"
KONG_PREFIX="${KONG_DEPLOY_CONTRACT_PREFIX:-/smartlogix/kong/deploy}"
KONG_WEIGHT_DEPLOYMENT_CONFIG="${KONG_WEIGHT_DEPLOYMENT_CONFIG:-CodeDeployDefault.ECSAllAtOnce}"
CANARY_STABLE_WEIGHT="${CANARY_STABLE_WEIGHT:-90}"
CANARY_WEIGHT="${CANARY_WEIGHT:-10}"
CANARY_BAKE_SECONDS="${CANARY_BAKE_SECONDS:-60}"
PROD_HOST_HEADER="${PROD_HOST_HEADER:-slot-main.internal.invalid}"

CLUSTER_NAME="$(get_param "$PEDIDOS_PREFIX" cluster_name)"
STABLE_SERVICE_NAME="$(get_param "$PEDIDOS_PREFIX" service_name)"
CANARY_SERVICE_NAME="$(get_param "$PEDIDOS_PREFIX" canary_service_name)"
PEDIDOS_CONTAINER_NAME="$(get_param "$PEDIDOS_PREFIX" container_name)"
PEDIDOS_TASK_FAMILY="$(get_param "$PEDIDOS_PREFIX" task_definition_family)"
CANARY_DISCOVERY_SERVICE_ARN="$(get_param "$PEDIDOS_PREFIX" canary_discovery_service_arn)"
EVENTS_TOPIC_ARN="$(get_param "$PEDIDOS_PREFIX" events_topic_arn)"

KONG_SERVICE_NAME="$(get_param "$KONG_PREFIX" service_name)"
KONG_CONTAINER_NAME="$(get_param "$KONG_PREFIX" container_name)"
KONG_CONTAINER_PORT="$(get_param "$KONG_PREFIX" container_port)"
KONG_TASK_FAMILY="$(get_param "$KONG_PREFIX" task_definition_family)"
KONG_CODEDEPLOY_APP_NAME="$(get_param "$KONG_PREFIX" codedeploy_app_name)"
KONG_CODEDEPLOY_GROUP_NAME="$(get_param "$KONG_PREFIX" codedeploy_deployment_group_name)"
LISTENER_ARN="$(get_param "$KONG_PREFIX" listener_arn)"
PRIVATE_SUBNET_IDS_CSV="$(get_param "$KONG_PREFIX" private_subnet_ids_csv)"
SECURITY_GROUP_ID="$(get_param "$KONG_PREFIX" security_group_id)"

SUBNETS_COMPACT="${PRIVATE_SUBNET_IDS_CSV// /}"
NETWORK_CONFIGURATION="awsvpcConfiguration={subnets=[${SUBNETS_COMPACT}],securityGroups=[${SECURITY_GROUP_ID}],assignPublicIp=DISABLED}"

CURRENT_STABLE_TASK_DEFINITION_ARN="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$STABLE_SERVICE_NAME" --query 'services[0].taskDefinition' --output text)"
BASE_STABLE_TASK_DEFINITION_JSON="$(aws ecs describe-task-definition --task-definition "$CURRENT_STABLE_TASK_DEFINITION_ARN" --query 'taskDefinition' --output json)"
PATCHED_PEDIDOS_TASK_DEFINITION_JSON="$(patch_pedidos_task_definition <<<"$BASE_STABLE_TASK_DEFINITION_JSON")"
CURRENT_STABLE_IMAGE="$(jq -r --arg container "$PEDIDOS_CONTAINER_NAME" '.containerDefinitions[] | select(.name == $container) | .image' <<<"$BASE_STABLE_TASK_DEFINITION_JSON")"

if [[ "$CURRENT_STABLE_IMAGE" == "alpine:latest" ]]; then
  STABLE_REGISTER_PAYLOAD="$(build_register_payload "$PATCHED_PEDIDOS_TASK_DEFINITION_JSON" "$PEDIDOS_TASK_FAMILY")"
  NEW_STABLE_TASK_DEFINITION_ARN="$(aws ecs register-task-definition --cli-input-json "$STABLE_REGISTER_PAYLOAD" --query 'taskDefinition.taskDefinitionArn' --output text)"

  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$STABLE_SERVICE_NAME" \
    --task-definition "$NEW_STABLE_TASK_DEFINITION_ARN" \
    --force-new-deployment >/dev/null

  aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$STABLE_SERVICE_NAME"
  deploy_kong_weights 100 0

  trap - ERR

  echo "Initial production deployment completed without canary because stable was the bootstrap alpine task."
  echo "Stable task definition: ${NEW_STABLE_TASK_DEFINITION_ARN}"
  exit 0
fi

CANARY_REGISTER_PAYLOAD="$(build_register_payload "$PATCHED_PEDIDOS_TASK_DEFINITION_JSON" "pedidos-canary-main")"
CANARY_TASK_DEFINITION_ARN="$(aws ecs register-task-definition --cli-input-json "$CANARY_REGISTER_PAYLOAD" --query 'taskDefinition.taskDefinitionArn' --output text)"

CANARY_STATUS="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$CANARY_SERVICE_NAME" --query 'services[0].status' --output text 2>/dev/null || true)"
if [[ "$CANARY_STATUS" == "ACTIVE" ]]; then
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$CANARY_SERVICE_NAME" \
    --task-definition "$CANARY_TASK_DEFINITION_ARN" \
    --desired-count 1 \
    --force-new-deployment \
    --network-configuration "$NETWORK_CONFIGURATION" >/dev/null
else
  aws ecs create-service \
    --cluster "$CLUSTER_NAME" \
    --service-name "$CANARY_SERVICE_NAME" \
    --task-definition "$CANARY_TASK_DEFINITION_ARN" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --service-registries "registryArn=${CANARY_DISCOVERY_SERVICE_ARN}" >/dev/null
fi

aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$CANARY_SERVICE_NAME"

deploy_kong_weights "$CANARY_STABLE_WEIGHT" "$CANARY_WEIGHT"
smoke_test_canary_route "$LISTENER_ARN"
sleep "$CANARY_BAKE_SECONDS"

STABLE_REGISTER_PAYLOAD="$(build_register_payload "$PATCHED_PEDIDOS_TASK_DEFINITION_JSON" "$PEDIDOS_TASK_FAMILY")"
NEW_STABLE_TASK_DEFINITION_ARN="$(aws ecs register-task-definition --cli-input-json "$STABLE_REGISTER_PAYLOAD" --query 'taskDefinition.taskDefinitionArn' --output text)"

aws ecs update-service \
  --cluster "$CLUSTER_NAME" \
  --service "$STABLE_SERVICE_NAME" \
  --task-definition "$NEW_STABLE_TASK_DEFINITION_ARN" \
  --force-new-deployment >/dev/null

aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$STABLE_SERVICE_NAME"

deploy_kong_weights 100 0

aws ecs update-service --cluster "$CLUSTER_NAME" --service "$CANARY_SERVICE_NAME" --desired-count 0 >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$CANARY_SERVICE_NAME"

trap - ERR

echo "Production canary deployment completed"
echo "Stable task definition: ${NEW_STABLE_TASK_DEFINITION_ARN}"
