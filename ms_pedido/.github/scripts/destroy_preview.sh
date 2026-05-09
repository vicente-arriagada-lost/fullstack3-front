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

run_schema_cleanup() {
  local task_definition_arn="$1"
  if [[ -z "$task_definition_arn" || "$task_definition_arn" == "None" ]]; then
    return 0
  fi

  local task_arn
  task_arn="$(aws ecs run-task \
    --cluster "$CLUSTER_NAME" \
    --launch-type FARGATE \
    --task-definition "$task_definition_arn" \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --overrides "$(jq -c -n \
      --arg container "$PEDIDOS_CONTAINER_NAME" \
      --arg schema "pr_${PR_NUMBER}" \
      '{
        containerOverrides: [
          {
            name: $container,
            command: ["npm", "run", "drop:preview-schema"],
            environment: [
              {name: "DATABASE_SCHEMA", value: $schema}
            ]
          }
        ]
      }')" \
    --query 'tasks[0].taskArn' \
    --output text 2>/dev/null || true)"

  if [[ -n "$task_arn" && "$task_arn" != "None" ]]; then
    aws ecs wait tasks-stopped --cluster "$CLUSTER_NAME" --tasks "$task_arn" || true
  fi
}

require_env AWS_REGION
require_env PR_NUMBER

PEDIDOS_PREFIX="${PEDIDOS_DEPLOY_CONTRACT_PREFIX:-/smartlogix/pedidos/deploy}"
KONG_PREFIX="${KONG_DEPLOY_CONTRACT_PREFIX:-/smartlogix/kong/deploy}"

PREVIEW_HOST_TEMPLATE="${PREVIEW_HOST_TEMPLATE:-pr-%s.pedidos-preview.internal}"
PREVIEW_HOST="$(printf "$PREVIEW_HOST_TEMPLATE" "$PR_NUMBER")"
PREVIEW_NAMESPACE="smartlogix-pr-${PR_NUMBER}.local"
PEDIDOS_SERVICE_NAME="srv-pedidos-pr-${PR_NUMBER}"
PEDIDOS_TASK_FAMILY="pedidos-pr-${PR_NUMBER}"
KONG_SERVICE_NAME="srv-kong-pedidos-pr-${PR_NUMBER}"
KONG_TASK_FAMILY="kong-pedidos-pr-${PR_NUMBER}"
KONG_TARGET_GROUP_NAME="tg-kpedpr-${PR_NUMBER}"

CLUSTER_NAME="$(get_param "$PEDIDOS_PREFIX" cluster_name)"
PEDIDOS_CONTAINER_NAME="$(get_param "$PEDIDOS_PREFIX" container_name)"
LISTENER_ARN="$(get_param "$KONG_PREFIX" listener_arn)"
PRIVATE_SUBNET_IDS_CSV="$(get_param "$KONG_PREFIX" private_subnet_ids_csv)"
SECURITY_GROUP_ID="$(get_param "$KONG_PREFIX" security_group_id)"

SUBNETS_COMPACT="${PRIVATE_SUBNET_IDS_CSV// /}"
NETWORK_CONFIGURATION="awsvpcConfiguration={subnets=[${SUBNETS_COMPACT}],securityGroups=[${SECURITY_GROUP_ID}],assignPublicIp=DISABLED}"

PEDIDOS_TASK_DEFINITION_ARN="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$PEDIDOS_SERVICE_NAME" --query 'services[0].taskDefinition' --output text 2>/dev/null || true)"
run_schema_cleanup "$PEDIDOS_TASK_DEFINITION_ARN"

KONG_TARGET_GROUP_ARNS="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$KONG_SERVICE_NAME" --query 'services[0].loadBalancers[].targetGroupArn' --output text 2>/dev/null || true)"

delete_ecs_service_if_active "$KONG_SERVICE_NAME"
delete_ecs_service_if_active "$PEDIDOS_SERVICE_NAME"

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
deregister_task_definitions "$PEDIDOS_TASK_FAMILY"

NAMESPACE_ID="$(find_namespace_id || true)"
for service_name in pedidos pedidos-canary; do
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
