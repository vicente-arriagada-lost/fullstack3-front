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

find_namespace_id() {
  aws servicediscovery list-namespaces --output json \
    | jq -r --arg name "$PREVIEW_NAMESPACE" '
        .Namespaces[]
        | select(.Name == $name and .Type == "DNS_PRIVATE")
        | .Id
      ' \
    | head -n1
}

ensure_namespace() {
  local namespace_id operation_id
  namespace_id="$(find_namespace_id || true)"
  if [[ -n "$namespace_id" ]]; then
    echo "$namespace_id"
    return 0
  fi

  operation_id="$(aws servicediscovery create-private-dns-namespace \
    --name "$PREVIEW_NAMESPACE" \
    --vpc "$VPC_ID" \
    --creator-request-id "pedidos-pr-${PR_NUMBER}-namespace" \
    --query 'OperationId' \
    --output text)"

  aws servicediscovery get-operation --operation-id "$operation_id" >/tmp/namespace-operation.json
  while [[ "$(jq -r '.Operation.Status' /tmp/namespace-operation.json)" == "SUBMITTED" || "$(jq -r '.Operation.Status' /tmp/namespace-operation.json)" == "PENDING" ]]; do
    sleep 3
    aws servicediscovery get-operation --operation-id "$operation_id" >/tmp/namespace-operation.json
  done

  if [[ "$(jq -r '.Operation.Status' /tmp/namespace-operation.json)" != "SUCCESS" ]]; then
    cat /tmp/namespace-operation.json >&2
    exit 1
  fi

  find_namespace_id
}

find_discovery_service_arn() {
  local service_name="$1"
  aws servicediscovery list-services --filters "Name=NAMESPACE_ID,Values=${NAMESPACE_ID},Condition=EQ" --output json \
    | jq -r --arg name "$service_name" '.Services[] | select(.Name == $name) | .Arn' \
    | head -n1
}

ensure_discovery_service() {
  local service_name="$1"
  local service_arn
  service_arn="$(find_discovery_service_arn "$service_name" || true)"
  if [[ -n "$service_arn" ]]; then
    echo "$service_arn"
    return 0
  fi

  aws servicediscovery create-service \
    --name "$service_name" \
    --dns-config "NamespaceId=${NAMESPACE_ID},RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]" \
    --query 'Service.Arn' \
    --output text
}

patch_microservice_task_definition() {
  jq -c \
    --arg container "$PEDIDOS_CONTAINER_NAME" \
    --arg image "$IMAGE_URI" \
    --arg node_env "pr-${PR_NUMBER}" \
    --arg schema "pr_${PR_NUMBER}" '
      .containerDefinitions |= map(
        if .name == $container then
          .image = $image |
          del(.command) |
          .environment = ((.environment // [])
            | map(select(
                .name != "NODE_ENV"
                and .name != "DATABASE_SCHEMA"
                and .name != "DATABASE_SSL"
                and .name != "EVENTS_TOPIC_ARN"
              ))
            + [
                {"name":"NODE_ENV","value":$node_env},
                {"name":"DATABASE_SCHEMA","value":$schema},
                {"name":"DATABASE_SSL","value":"true"}
              ])
        else
          .
        end
      )
    '
}

patch_kong_task_definition() {
  jq -c \
    --arg container "$KONG_CONTAINER_NAME" \
    --arg namespace "$PREVIEW_NAMESPACE" '
      .containerDefinitions |= map(
        if .name == $container then
          .environment = ((.environment // [])
            | map(select(
                .name != "KONG_SERVICE_DISCOVERY_NAMESPACE"
                and .name != "KONG_PEDIDOS_STABLE_WEIGHT"
                and .name != "KONG_PEDIDOS_CANARY_WEIGHT"
              ))
            + [
                {"name":"KONG_SERVICE_DISCOVERY_NAMESPACE","value":$namespace},
                {"name":"KONG_PEDIDOS_STABLE_WEIGHT","value":"100"},
                {"name":"KONG_PEDIDOS_CANARY_WEIGHT","value":"0"}
              ])
        else
          .
        end
      )
    '
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
  priority=$((20000 + (PR_NUMBER % 10000)))

  while grep -qx "$priority" <<<"$used"; do
    priority=$((priority + 1))
    if [[ "$priority" -gt 49999 ]]; then
      priority=20000
    fi
  done

  echo "$priority"
}

wait_for_target_group_association() {
  local target_group_arn="$1"
  local load_balancer_arn="$2"
  local max_attempts="${TARGET_GROUP_ASSOCIATION_MAX_ATTEMPTS:-20}"
  local sleep_seconds="${TARGET_GROUP_ASSOCIATION_SLEEP_SECONDS:-3}"
  local attempt is_associated

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
PROD_PEDIDOS_SERVICE_NAME="$(get_param "$PEDIDOS_PREFIX" service_name)"
PEDIDOS_CONTAINER_NAME="$(get_param "$PEDIDOS_PREFIX" container_name)"
PEDIDOS_CONTAINER_PORT="$(get_param "$PEDIDOS_PREFIX" container_port)"

PROD_KONG_SERVICE_NAME="$(get_param "$KONG_PREFIX" service_name)"
LISTENER_ARN="$(get_param "$KONG_PREFIX" listener_arn)"
PRIVATE_SUBNET_IDS_CSV="$(get_param "$KONG_PREFIX" private_subnet_ids_csv)"
SECURITY_GROUP_ID="$(get_param "$KONG_PREFIX" security_group_id)"
VPC_ID="$(get_param "$KONG_PREFIX" vpc_id)"
KONG_CONTAINER_NAME="$(get_param "$KONG_PREFIX" container_name)"
KONG_CONTAINER_PORT="$(get_param "$KONG_PREFIX" container_port)"

NAMESPACE_ID="$(ensure_namespace)"
PEDIDOS_DISCOVERY_SERVICE_ARN="$(ensure_discovery_service pedidos)"
ensure_discovery_service pedidos-canary >/dev/null

PROD_PEDIDOS_TASK_DEFINITION_ARN="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$PROD_PEDIDOS_SERVICE_NAME" --query 'services[0].taskDefinition' --output text)"
BASE_PEDIDOS_TASK_DEFINITION_JSON="$(aws ecs describe-task-definition --task-definition "$PROD_PEDIDOS_TASK_DEFINITION_ARN" --query 'taskDefinition' --output json)"
PEDIDOS_TASK_DEFINITION_JSON="$(patch_microservice_task_definition <<<"$BASE_PEDIDOS_TASK_DEFINITION_JSON")"
PEDIDOS_REGISTER_PAYLOAD="$(build_register_payload "$PEDIDOS_TASK_DEFINITION_JSON" "$PEDIDOS_TASK_FAMILY")"
PEDIDOS_TASK_DEFINITION_ARN="$(aws ecs register-task-definition --cli-input-json "$PEDIDOS_REGISTER_PAYLOAD" --query 'taskDefinition.taskDefinitionArn' --output text)"

SUBNETS_COMPACT="${PRIVATE_SUBNET_IDS_CSV// /}"
NETWORK_CONFIGURATION="awsvpcConfiguration={subnets=[${SUBNETS_COMPACT}],securityGroups=[${SECURITY_GROUP_ID}],assignPublicIp=DISABLED}"

PEDIDOS_STATUS="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$PEDIDOS_SERVICE_NAME" --query 'services[0].status' --output text 2>/dev/null || true)"
if [[ "$PEDIDOS_STATUS" == "ACTIVE" ]]; then
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$PEDIDOS_SERVICE_NAME" \
    --task-definition "$PEDIDOS_TASK_DEFINITION_ARN" \
    --desired-count 1 \
    --force-new-deployment \
    --network-configuration "$NETWORK_CONFIGURATION" >/dev/null
else
  aws ecs create-service \
    --cluster "$CLUSTER_NAME" \
    --service-name "$PEDIDOS_SERVICE_NAME" \
    --task-definition "$PEDIDOS_TASK_DEFINITION_ARN" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --service-registries "registryArn=${PEDIDOS_DISCOVERY_SERVICE_ARN}" >/dev/null
fi

PROD_KONG_TASK_DEFINITION_ARN="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$PROD_KONG_SERVICE_NAME" --query 'services[0].taskDefinition' --output text)"
BASE_KONG_TASK_DEFINITION_JSON="$(aws ecs describe-task-definition --task-definition "$PROD_KONG_TASK_DEFINITION_ARN" --query 'taskDefinition' --output json)"
KONG_TASK_DEFINITION_JSON="$(patch_kong_task_definition <<<"$BASE_KONG_TASK_DEFINITION_JSON")"
KONG_REGISTER_PAYLOAD="$(build_register_payload "$KONG_TASK_DEFINITION_JSON" "$KONG_TASK_FAMILY")"
KONG_TASK_DEFINITION_ARN="$(aws ecs register-task-definition --cli-input-json "$KONG_REGISTER_PAYLOAD" --query 'taskDefinition.taskDefinitionArn' --output text)"

LB_ARN="$(aws elbv2 describe-listeners --listener-arns "$LISTENER_ARN" --query 'Listeners[0].LoadBalancerArn' --output text)"
TARGET_GROUP_ARN="$(aws elbv2 describe-target-groups --names "$KONG_TARGET_GROUP_NAME" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
if [[ -z "$TARGET_GROUP_ARN" || "$TARGET_GROUP_ARN" == "None" ]]; then
  TARGET_GROUP_ARN="$(aws elbv2 create-target-group \
    --name "$KONG_TARGET_GROUP_NAME" \
    --protocol HTTP \
    --port "$KONG_CONTAINER_PORT" \
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

KONG_STATUS="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$KONG_SERVICE_NAME" --query 'services[0].status' --output text 2>/dev/null || true)"
if [[ "$KONG_STATUS" == "ACTIVE" ]]; then
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$KONG_SERVICE_NAME" \
    --task-definition "$KONG_TASK_DEFINITION_ARN" \
    --desired-count 1 \
    --force-new-deployment \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --load-balancers "targetGroupArn=${TARGET_GROUP_ARN},containerName=${KONG_CONTAINER_NAME},containerPort=${KONG_CONTAINER_PORT}" >/dev/null
else
  aws ecs create-service \
    --cluster "$CLUSTER_NAME" \
    --service-name "$KONG_SERVICE_NAME" \
    --task-definition "$KONG_TASK_DEFINITION_ARN" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --load-balancers "targetGroupArn=${TARGET_GROUP_ARN},containerName=${KONG_CONTAINER_NAME},containerPort=${KONG_CONTAINER_PORT}" \
    --health-check-grace-period-seconds 60 >/dev/null
fi

aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$PEDIDOS_SERVICE_NAME" "$KONG_SERVICE_NAME"

LB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$LB_ARN" --query 'LoadBalancers[0].DNSName' --output text)"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "preview_host=${PREVIEW_HOST}"
    echo "alb_dns=${LB_DNS}"
    echo "namespace=${PREVIEW_NAMESPACE}"
  } >> "$GITHUB_OUTPUT"
fi

echo "Preview deployed"
echo "Host: ${PREVIEW_HOST}"
echo "Namespace: ${PREVIEW_NAMESPACE}"
echo "ALB: ${LB_DNS}"
