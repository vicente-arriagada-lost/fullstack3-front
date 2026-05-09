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

find_listener_rule_by_host() {
  aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" --output json \
    | jq -r --arg host "$PREVIEW_HOST" '
        .Rules[]
        | select(any(.Conditions[]?; .Field == "host-header" and any(.HostHeaderConfig.Values[]?; . == $host)))
        | .RuleArn
      ' \
    | head -n1
}

require_env AWS_REGION
require_env PR_NUMBER

CONTRACT_PREFIX="${KONG_DEPLOY_CONTRACT_PREFIX:-/smartlogix/kong/deploy}"
PREVIEW_HOST_TEMPLATE="${PREVIEW_HOST_TEMPLATE:-pr-%s.kong-preview.internal}"
PREVIEW_HOST="$(printf "$PREVIEW_HOST_TEMPLATE" "$PR_NUMBER")"
SERVICE_NAME="srv-kong-pr-${PR_NUMBER}"
TASK_FAMILY="kong-pr-${PR_NUMBER}"

CLUSTER_NAME="$(get_param cluster_name)"
LISTENER_ARN="$(get_param listener_arn)"

TARGET_GROUP_ARNS="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --query 'services[0].loadBalancers[].targetGroupArn' --output text 2>/dev/null || true)"
SERVICE_STATUS="$(aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --query 'services[0].status' --output text 2>/dev/null || true)"

if [[ "$SERVICE_STATUS" == "ACTIVE" ]]; then
  aws ecs delete-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" --force >/dev/null
  aws ecs wait services-inactive --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME"
fi

RULE_ARN="$(find_listener_rule_by_host || true)"
if [[ -n "$RULE_ARN" ]]; then
  aws elbv2 delete-rule --rule-arn "$RULE_ARN" >/dev/null
fi

for tg in $TARGET_GROUP_ARNS; do
  if [[ -n "$tg" && "$tg" != "None" ]]; then
    aws elbv2 delete-target-group --target-group-arn "$tg" >/dev/null || true
  fi
done

TASK_DEFS="$(aws ecs list-task-definitions --family-prefix "$TASK_FAMILY" --sort DESC --query 'taskDefinitionArns' --output text 2>/dev/null || true)"
for arn in $TASK_DEFS; do
  if [[ -n "$arn" && "$arn" != "None" ]]; then
    aws ecs deregister-task-definition --task-definition "$arn" >/dev/null || true
  fi
done

echo "Preview environment removed for PR ${PR_NUMBER}"
