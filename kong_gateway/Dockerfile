ARG KONG_BASE_IMAGE=kong:3.7
FROM ${KONG_BASE_IMAGE}

USER root
WORKDIR /opt/kong-gateway

RUN set -eux; \
  if command -v apt-get >/dev/null 2>&1; then \
    apt-get update; \
    apt-get install -y --no-install-recommends curl jq ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
  elif command -v apk >/dev/null 2>&1; then \
    apk add --no-cache curl jq ca-certificates; \
  elif command -v microdnf >/dev/null 2>&1; then \
    microdnf install -y curl jq ca-certificates; \
    microdnf clean all; \
  elif command -v dnf >/dev/null 2>&1; then \
    dnf install -y curl jq ca-certificates; \
    dnf clean all; \
  else \
    echo "Unsupported base image: no known package manager found" >&2; \
    exit 1; \
  fi

COPY kong.yml.template ./kong.yml.template
COPY entrypoint.sh ./entrypoint.sh

RUN chmod 0555 ./entrypoint.sh \
 && chown -R kong:0 /opt/kong-gateway \
 && chmod -R g=u /opt/kong-gateway

USER kong

ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/tmp/kong.generated.yml \
    KONG_PROXY_LISTEN="0.0.0.0:8000 reuseport backlog=16384" \
    KONG_ADMIN_LISTEN=off \
    KONG_STATUS_LISTEN=off \
    KONG_NGINX_WORKER_PROCESSES=auto

ENTRYPOINT ["/opt/kong-gateway/entrypoint.sh"]
CMD ["kong", "docker-start"]
