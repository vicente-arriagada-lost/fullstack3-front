#!/usr/bin/env sh
set -eu

TEMPLATE_PATH="/opt/kong-gateway/kong.yml.template"
GENERATED_CONFIG="${KONG_DECLARATIVE_CONFIG:-/tmp/kong.generated.yml}"
RESOLUTION_SOURCE="desconocido"
RESOLVED_NAMESPACE=""

log() {
  printf '%s\n' "[kong-gateway] $*"
}

is_positive_integer() {
  case "$1" in
    ""|*[!0-9]*|0)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

metadata_http_get() {
  url="$1"
  timeout_seconds="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsS \
      --connect-timeout "$timeout_seconds" \
      --max-time "$timeout_seconds" \
      "$url"
    return 0
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout="$timeout_seconds" "$url"
    return 0
  fi

  log "ERROR: no existe cliente HTTP (curl o wget) para consultar metadata ECS"
  return 1
}

fetch_ecs_task_metadata() {
  metadata_uri="$1"
  retries="${KONG_METADATA_RETRIES:-5}"
  retry_delay_seconds="${KONG_METADATA_RETRY_DELAY_SECONDS:-1}"
  timeout_seconds="${KONG_METADATA_HTTP_TIMEOUT_SECONDS:-2}"

  if ! is_positive_integer "$retries"; then
    log "ERROR: KONG_METADATA_RETRIES debe ser entero positivo; recibido '$retries'"
    return 1
  fi
  if ! is_positive_integer "$retry_delay_seconds"; then
    log "ERROR: KONG_METADATA_RETRY_DELAY_SECONDS debe ser entero positivo; recibido '$retry_delay_seconds'"
    return 1
  fi
  if ! is_positive_integer "$timeout_seconds"; then
    log "ERROR: KONG_METADATA_HTTP_TIMEOUT_SECONDS debe ser entero positivo; recibido '$timeout_seconds'"
    return 1
  fi

  task_metadata_url="${metadata_uri}/task"
  attempt=1
  while [ "$attempt" -le "$retries" ]; do
    metadata="$(metadata_http_get "$task_metadata_url" "$timeout_seconds" 2>/dev/null || true)"
    if [ -n "$metadata" ]; then
      printf '%s' "$metadata"
      return 0
    fi

    if [ "$attempt" -lt "$retries" ]; then
      log "metadata ECS no disponible (intento ${attempt}/${retries}); reintentando en ${retry_delay_seconds}s"
      sleep "$retry_delay_seconds"
    fi

    attempt=$((attempt + 1))
  done

  return 1
}

extract_family_from_metadata() {
  metadata="$1"

  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$metadata" | jq -er '.Family | strings'
    return $?
  fi

  printf '%s' "$metadata" | sed -n 's/.*"Family"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

map_environment_to_namespace() {
  environment="$1"

  case "$environment" in
    main)
      printf '%s' "smartlogix-main.local"
      ;;
    canary)
      printf '%s' "smartlogix-canary.local"
      ;;
    pr-*|ephemeral)
      printf '%s' "smartlogix.local"
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_namespace_from_ecs_metadata() {
  metadata_uri="${ECS_CONTAINER_METADATA_URI_V4:-}"
  if [ -z "$metadata_uri" ]; then
    log "ERROR: ECS_CONTAINER_METADATA_URI_V4 no esta seteada y no se recibio KONG_SERVICE_DISCOVERY_NAMESPACE"
    return 1
  fi

  if ! metadata="$(fetch_ecs_task_metadata "$metadata_uri")"; then
    log "ERROR: no se pudo obtener metadata ECS desde ${metadata_uri}/task"
    return 1
  fi

  family="$(extract_family_from_metadata "$metadata")"
  if [ -z "$family" ]; then
    log "ERROR: metadata ECS invalida: no se pudo extraer el campo Family"
    return 1
  fi

  case "$family" in
    kong-*)
      environment="${family#kong-}"
      ;;
    *)
      log "ERROR: Family '$family' no cumple formato esperado 'kong-<environment>'"
      return 1
      ;;
  esac

  if ! namespace="$(map_environment_to_namespace "$environment")"; then
    log "ERROR: environment '$environment' no mapea a un namespace permitido"
    return 1
  fi

  RESOLVED_NAMESPACE="$namespace"
  RESOLUTION_SOURCE="ECS metadata (Family=${family})"
}

resolve_namespace() {
  if [ -n "${KONG_SERVICE_DISCOVERY_NAMESPACE:-}" ]; then
    RESOLUTION_SOURCE="KONG_SERVICE_DISCOVERY_NAMESPACE"
    RESOLVED_NAMESPACE="$KONG_SERVICE_DISCOVERY_NAMESPACE"
    return 0
  fi

  if ! resolve_namespace_from_ecs_metadata; then
    return 1
  fi
}

validate_namespace() {
  namespace="$1"

  case "$namespace" in
    *[!a-zA-Z0-9.-]*|""|.*|*.|*..*)
      log "ERROR: namespace invalido '$1'"
      exit 1
      ;;
  esac

  if [ "${#namespace}" -gt 253 ]; then
    log "ERROR: namespace invalido '$1' (largo maximo: 253)"
    exit 1
  fi

  old_ifs="$IFS"
  IFS='.'
  set -- $namespace
  IFS="$old_ifs"

  for label in "$@"; do
    case "$label" in
      ""|*[!a-zA-Z0-9-]*|-*|*-) # DNS labels: alnum/hyphen, no leading/trailing hyphen
        log "ERROR: namespace invalido '$namespace' (label DNS invalido: '$label')"
        exit 1
        ;;
    esac

    if [ "${#label}" -gt 63 ]; then
      log "ERROR: namespace invalido '$namespace' (label '$label' excede 63 caracteres)"
      exit 1
    fi
  done
}

validate_weight() {
  name="$1"
  value="$2"

  case "$value" in
    ""|*[!0-9]*)
      log "ERROR: $name debe ser un entero entre 0 y 1000; recibido '$value'"
      exit 1
      ;;
  esac

  if [ "$value" -gt 1000 ]; then
    log "ERROR: $name debe ser menor o igual a 1000; recibido '$value'"
    exit 1
  fi
}

render_config() {
  namespace="$1"

  inventario_stable_weight="${KONG_INVENTARIO_STABLE_WEIGHT:-100}"
  inventario_canary_weight="${KONG_INVENTARIO_CANARY_WEIGHT:-0}"
  pedidos_stable_weight="${KONG_PEDIDOS_STABLE_WEIGHT:-100}"
  pedidos_canary_weight="${KONG_PEDIDOS_CANARY_WEIGHT:-0}"
  envios_stable_weight="${KONG_ENVIOS_STABLE_WEIGHT:-100}"
  envios_canary_weight="${KONG_ENVIOS_CANARY_WEIGHT:-0}"
  notificaciones_stable_weight="${KONG_NOTIFICACIONES_STABLE_WEIGHT:-100}"
  notificaciones_canary_weight="${KONG_NOTIFICACIONES_CANARY_WEIGHT:-0}"

  validate_weight KONG_INVENTARIO_STABLE_WEIGHT "$inventario_stable_weight"
  validate_weight KONG_INVENTARIO_CANARY_WEIGHT "$inventario_canary_weight"
  validate_weight KONG_PEDIDOS_STABLE_WEIGHT "$pedidos_stable_weight"
  validate_weight KONG_PEDIDOS_CANARY_WEIGHT "$pedidos_canary_weight"
  validate_weight KONG_ENVIOS_STABLE_WEIGHT "$envios_stable_weight"
  validate_weight KONG_ENVIOS_CANARY_WEIGHT "$envios_canary_weight"
  validate_weight KONG_NOTIFICACIONES_STABLE_WEIGHT "$notificaciones_stable_weight"
  validate_weight KONG_NOTIFICACIONES_CANARY_WEIGHT "$notificaciones_canary_weight"

  sed \
    -e "s|__SERVICE_DISCOVERY_NAMESPACE__|$namespace|g" \
    -e "s|__INVENTARIO_STABLE_WEIGHT__|$inventario_stable_weight|g" \
    -e "s|__INVENTARIO_CANARY_WEIGHT__|$inventario_canary_weight|g" \
    -e "s|__PEDIDOS_STABLE_WEIGHT__|$pedidos_stable_weight|g" \
    -e "s|__PEDIDOS_CANARY_WEIGHT__|$pedidos_canary_weight|g" \
    -e "s|__ENVIOS_STABLE_WEIGHT__|$envios_stable_weight|g" \
    -e "s|__ENVIOS_CANARY_WEIGHT__|$envios_canary_weight|g" \
    -e "s|__NOTIFICACIONES_STABLE_WEIGHT__|$notificaciones_stable_weight|g" \
    -e "s|__NOTIFICACIONES_CANARY_WEIGHT__|$notificaciones_canary_weight|g" \
    "$TEMPLATE_PATH" > "$GENERATED_CONFIG"
}

main() {
  if [ ! -f "$TEMPLATE_PATH" ]; then
    log "ERROR: no existe plantilla en $TEMPLATE_PATH"
    exit 1
  fi

  if ! resolve_namespace; then
    log "ERROR: no fue posible resolver el namespace de service discovery"
    exit 1
  fi
  namespace="$RESOLVED_NAMESPACE"
  validate_namespace "$namespace"

  render_config "$namespace"

  kong config parse "$GENERATED_CONFIG" >/dev/null

  log "configuracion renderizada en $GENERATED_CONFIG"
  log "namespace de service discovery: $namespace"
  log "fuente de resolucion de namespace: $RESOLUTION_SOURCE"

  exec /docker-entrypoint.sh "$@"
}

main "$@"
