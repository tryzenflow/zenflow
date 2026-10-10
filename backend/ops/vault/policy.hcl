# Read-only access for the Zenflow renderer AppRole: one explicit path per secret
# set (a new set needs a deliberate line here and a re-run of setup-approle.sh).
# __ENV__ is replaced with dev|staging|prod by setup-approle.sh.
path "secret/data/zenflow/__ENV__/api" {
  capabilities = ["read"]
}
path "secret/data/zenflow/__ENV__/bandit" {
  capabilities = ["read"]
}
path "secret/data/zenflow/__ENV__/postgres" {
  capabilities = ["read"]
}
path "secret/data/zenflow/__ENV__/minio" {
  capabilities = ["read"]
}
path "secret/data/zenflow/__ENV__/grafana" {
  capabilities = ["read"]
}
path "secret/data/zenflow/__ENV__/backup" {
  capabilities = ["read"]
}
