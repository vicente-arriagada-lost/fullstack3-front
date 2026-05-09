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
  local prefix="$1"
  local key="$2"
  aws ssm get-parameter --name "${prefix}/${key}" --query 'Parameter.Value' --output text
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

find_namespace_id() {
  aws servicediscovery list-namespaces --output json \
    | jq -r --arg name "$PREVIEW_NAMESPACE" '
        .Namespaces[]
        | select(.Name == $name and .Type == "DNS_PRIVATE")
        | .Id
      ' \
    | head -n1
}

find_discovery_service_id() {
  local service_name="$1"
  if [[ -z "$NAMESPACE_ID" ]]; then
    return 0
  fi

  aws servicediscovery list-services --filters "Name=NAMESPACE_ID,Values=${NAMESPACE_ID},Condition=EQ" --output json \
    | jq -r --arg name "$service_name" '.Services[] | select(.Name == $name) | .Id' \
    | head -n1
}

delete_ecs_service_if_active() {
  local service_name="$1"
  local status
  status="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$service_name" --query 'services[0].status' --output text 2>/dev/null || true)"
  if [[ "$status" == "ACTIVE" ]]; then
    aws ecs delete-service --cluster "$CLUSTER_NAME" --service "$service_name" --force >/dev/null
    aws ecs wait services-inactive --cluster "$CLUSTER_NAME" --services "$service_name"
  fi
}

deregister_task_definitions() {
  local family="$1"
  local task_definitions
  task_definitions="$(aws ecs list-task-definitions --family-prefix "$family" --sort DESC --query 'taskDefinitionArns' --output text 2>/dev/null || true)"
  for arn in $task_definitions; do
    if [[ -n "$arn" && "$arn" != "None" ]]; then
      aws ecs deregister-task-definition --task-definition "$arn" >/dev/null || true
    fi
  done
}

require_env AWS_REGION
require_env PR_NUMBER

ENVIOS_PREFIX="${ENVIOS_DEPLOY_CONTRACT_PREFIX:-/smartlogix/envios/deploy}"
KONG_PREFIX="${KONG_DEPLOY_CONTRACT_PREFIX:-/smartlogix/kong/deploy}"

PREVIEW_HOST_TEMPLATE="${PREVIEW_HOST_TEMPLATE:-pr-%s.envios-preview.internal}"
PREVIEW_HOST="$(printf "$PREVIEW_HOST_TEMPLATE" "$PR_NUMBER")"
PREVIEW_NAMESPACE="smartlogix-pr-${PR_NUMBER}.local"
ENVIOS_SERVICE_NAME="srv-envios-pr-${PR_NUMBER}"
ENVIOS_TASK_FAMILY="envios-pr-${PR_NUMBER}"
KONG_SERVICE_NAME="srv-kong-envios-pr-${PR_NUMBER}"
KONG_TASK_FAMILY="kong-envios-pr-${PR_NUMBER}"
KONG_TARGET_GROUP_NAME="tg-kenvpr-${PR_NUMBER}"

CLUSTER_NAME="$(get_param "$ENVIOS_PREFIX" cluster_name)"
LISTENER_ARN="$(get_param "$KONG_PREFIX" listener_arn)"

KONG_TARGET_GROUP_ARNS="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$KONG_SERVICE_NAME" --query 'services[0].loadBalancers[].targetGroupArn' --output text 2>/dev/null || true)"

delete_ecs_service_if_active "$KONG_SERVICE_NAME"
delete_ecs_service_if_active "$ENVIOS_SERVICE_NAME"

RULE_ARN="$(find_listener_rule_by_host || true)"
if [[ -n "$RULE_ARN" ]]; then
  aws elbv2 delete-rule --rule-arn "$RULE_ARN" >/dev/null
fi

for target_group_arn in $KONG_TARGET_GROUP_ARNS; do
  if [[ -n "$target_group_arn" && "$target_group_arn" != "None" ]]; then
    aws elbv2 delete-target-group --target-group-arn "$target_group_arn" >/dev/null || true
  fi
done

TARGET_GROUP_ARN="$(aws elbv2 describe-target-groups --names "$KONG_TARGET_GROUP_NAME" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
if [[ -n "$TARGET_GROUP_ARN" && "$TARGET_GROUP_ARN" != "None" ]]; then
  aws elbv2 delete-target-group --target-group-arn "$TARGET_GROUP_ARN" >/dev/null || true
fi

deregister_task_definitions "$KONG_TASK_FAMILY"
deregister_task_definitions "$ENVIOS_TASK_FAMILY"

NAMESPACE_ID="$(find_namespace_id || true)"
for service_name in envios envios-canary; do
  SERVICE_ID="$(find_discovery_service_id "$service_name" || true)"
  if [[ -n "$SERVICE_ID" ]]; then
    aws servicediscovery delete-service --id "$SERVICE_ID" >/dev/null || true
  fi
done

if [[ -n "$NAMESPACE_ID" ]]; then
  OPERATION_ID="$(aws servicediscovery delete-namespace --id "$NAMESPACE_ID" --query 'OperationId' --output text 2>/dev/null || true)"
  if [[ -n "$OPERATION_ID" && "$OPERATION_ID" != "None" ]]; then
    aws servicediscovery get-operation --operation-id "$OPERATION_ID" >/dev/null || true
  fi
fi

echo "Preview environment removed for PR ${PR_NUMBER}"
