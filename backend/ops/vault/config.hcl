# Vault server config for staging/prod (compose.staging.yml / compose.prod.yml).
# Contains no secrets. Seal keys and root token are produced by `vault operator
# init` (docs/ops/secrets.md) and are never stored in this repo or the image.

ui            = false
disable_mlock = false # the container is started with cap IPC_LOCK
log_level     = "info"

storage "file" {
  path = "/vault/file" # named volume `vault_data`
}

# Listens on all container interfaces so Docker can forward to it, but compose
# publishes the port on 127.0.0.1 only and the container sits on a private
# network. TLS is off because traffic never leaves the host. If Vault is ever
# reachable from another machine, enable tls_cert_file/tls_key_file first.
listener "tcp" {
  address         = "0.0.0.0:8200"
  tls_disable     = true
  telemetry {
    unauthenticated_metrics_access = false
  }
}

api_addr = "http://127.0.0.1:8200"
