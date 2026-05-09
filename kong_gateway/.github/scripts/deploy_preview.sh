#!/usr/bin/env bash
set -euo pipefail

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

upsert_namespace_env() {
  local td_json="$1"
  jq -c --arg container "$CONTAINER_NAME" --arg image "$IMAGE_URI" --arg ns "$CLOUDMAP_NAMESPACE_NAME" '
    .containerDefinitions |= map(
      if .name == $container then
        .image = $image |
        .environment = ((.environment // []) | map(select(.name != "KONG_SERVICE_DISCOVERY_NAMESPACE")) + [{"name":"KONG_SERVICE_DISCOVERY_NAMESPACE","value":$ns}])
      else
        .
      end
    )
  ' <<<"$td_json"
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

find_listener_rule_by_host() {
  aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" --output json \
    | jq -r --arg host "$PREVIEW_HOST" '
        .Rules[]
        | select(any(.Conditions[]?; .Field == "host-header" and any(.HostHeaderConfig.Values[]?; . == $host)))
        | .RuleArn
      ' \
    | head -n1
}

next_available_priority() {
  local used priority
  used="$(aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" --output json | jq -r '.Rules[].Priority' | grep -E '^[0-9]+$' || true)"
  priority=$((10000 + (PR_NUMBER % 10000)))

  while grep -qx "$priority" <<<"$used"; do
    priority=$((priority + 1))
    if [[ "$priority" -gt 49999 ]]; then
      priority=10000
    fi
  done

  echo "$priority"
}

wait_for_target_group_association() {
  local target_group_arn="$1"
  local load_balancer_arn="$2"
  local max_attempts="${TARGET_GROUP_ASSOCIATION_MAX_ATTEMPTS:-20}"
  local sleep_seconds="${TARGET_GROUP_ASSOCIATION_SLEEP_SECONDS:-3}"
  local attempt
  local is_associated

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    is_associated="$(aws elbv2 describe-target-groups --target-group-arns "$target_group_arn" --output json \
      | jq -r --arg lb "$load_balancer_arn" '.TargetGroups[0].LoadBalancerArns // [] | index($lb) != null')"

    if [[ "$is_associated" == "true" ]]; then
      return 0
    fi

    sleep "$sleep_seconds"
  done

  echo "Target group ${target_group_arn} was not associated with load balancer ${load_balancer_arn} within ${max_attempts} attempts." >&2
  return 1
}

require_env AWS_REGION
require_env PR_NUMBER
require_env IMAGE_URI

CONTRACT_PREFIX="${KONG_DEPLOY_CONTRACT_PREFIX:-/smartlogix/kong/deploy}"
PREVIEW_HOST_TEMPLATE="${PREVIEW_HOST_TEMPLATE:-pr-%s.kong-preview.internal}"
PREVIEW_HOST="$(printf "$PREVIEW_HOST_TEMPLATE" "$PR_NUMBER")"
SERVICE_NAME="srv-kong-pr-${PR_NUMBER}"
TASK_FAMILY="kong-pr-${PR_NUMBER}"
TARGET_GROUP_NAME="tg-kpr-${PR_NUMBER}"

CLUSTER_NAME="$(get_param cluster_name)"
PROD_SERVICE_NAME="$(get_param service_name)"
LISTENER_ARN="$(get_param listener_arn)"
PRIVATE_SUBNET_IDS_CSV="$(get_param private_subnet_ids_csv)"
SECURITY_GROUP_ID="$(get_param security_group_id)"
VPC_ID="$(get_param vpc_id)"
CONTAINER_NAME="$(get_param container_name)"
CONTAINER_PORT="$(get_param container_port)"
CLOUDMAP_NAMESPACE_NAME="$(get_param cloudmap_namespace_name)"
LB_ARN="$(aws elbv2 describe-listeners --listener-arns "$LISTENER_ARN" --query 'Listeners[0].LoadBalancerArn' --output text)"

PROD_TASK_DEFINITION_ARN="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$PROD_SERVICE_NAME" --query 'services[0].taskDefinition' --output text)"
BASE_TASK_DEFINITION_JSON="$(aws ecs describe-task-definition --task-definition "$PROD_TASK_DEFINITION_ARN" --query 'taskDefinition' --output json)"
PATCHED_TASK_DEFINITION_JSON="$(upsert_namespace_env "$BASE_TASK_DEFINITION_JSON")"
REGISTER_PAYLOAD="$(build_register_payload "$PATCHED_TASK_DEFINITION_JSON")"

TASK_DEFINITION_ARN="$(aws ecs register-task-definition --cli-input-json "$REGISTER_PAYLOAD" --query 'taskDefinition.taskDefinitionArn' --output text)"

TARGET_GROUP_ARN="$(aws elbv2 describe-target-groups --names "$TARGET_GROUP_NAME" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
if [[ -z "$TARGET_GROUP_ARN" || "$TARGET_GROUP_ARN" == "None" ]]; then
  TARGET_GROUP_ARN="$(aws elbv2 create-target-group \
    --name "$TARGET_GROUP_NAME" \
    --protocol HTTP \
    --port "$CONTAINER_PORT" \
    --target-type ip \
    --vpc-id "$VPC_ID" \
    --health-check-protocol HTTP \
    --health-check-path "/" \
    --health-check-interval-seconds 30 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 3 \
    --unhealthy-threshold-count 3 \
    --matcher HttpCode=200-499 \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)"
fi

RULE_ARN="$(find_listener_rule_by_host || true)"
if [[ -n "$RULE_ARN" ]]; then
  aws elbv2 modify-rule --rule-arn "$RULE_ARN" --actions "Type=forward,TargetGroupArn=${TARGET_GROUP_ARN}" >/dev/null
else
  PRIORITY="$(next_available_priority)"
  aws elbv2 create-rule \
    --listener-arn "$LISTENER_ARN" \
    --priority "$PRIORITY" \
    --conditions "Field=host-header,HostHeaderConfig={Values=[\"${PREVIEW_HOST}\"]}" \
    --actions "Type=forward,TargetGroupArn=${TARGET_GROUP_ARN}" >/dev/null
fi

wait_for_target_group_association "$TARGET_GROUP_ARN" "$LB_ARN"

SUBNETS_COMPACT="${PRIVATE_SUBNET_IDS_CSV// /}"
NETWORK_CONFIGURATION="awsvpcConfiguration={subnets=[${SUBNETS_COMPACT}],securityGroups=[${SECURITY_GROUP_ID}],assignPublicIp=DISABLED}"

SERVICE_STATUS="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --query 'services[0].status' --output text 2>/dev/null || true)"
if [[ "$SERVICE_STATUS" == "ACTIVE" ]]; then
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEFINITION_ARN" \
    --desired-count 1 \
    --force-new-deployment \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --load-balancers "targetGroupArn=${TARGET_GROUP_ARN},containerName=${CONTAINER_NAME},containerPort=${CONTAINER_PORT}" >/dev/null
else
  aws ecs create-service \
    --cluster "$CLUSTER_NAME" \
    --service-name "$SERVICE_NAME" \
    --task-definition "$TASK_DEFINITION_ARN" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --load-balancers "targetGroupArn=${TARGET_GROUP_ARN},containerName=${CONTAINER_NAME},containerPort=${CONTAINER_PORT}" \
    --health-check-grace-period-seconds 60 >/dev/null
fi

aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME"

LB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$LB_ARN" --query 'LoadBalancers[0].DNSName' --output text)"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "preview_host=${PREVIEW_HOST}"
    echo "alb_dns=${LB_DNS}"
    echo "service_name=${SERVICE_NAME}"
  } >> "$GITHUB_OUTPUT"
fi

echo "Preview deployed"
echo "Host: ${PREVIEW_HOST}"
echo "ALB: ${LB_DNS}"
echo "Test command: curl -H 'Host: ${PREVIEW_HOST}' http://${LB_DNS}/"
