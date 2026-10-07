# Read-only access for the Zenflow API/migrations/bandit AppRole.
# __ENV__ is replaced with dev|staging|prod by setup-approle.sh.
path "secret/data/zenflow/__ENV__/*" {
  capabilities = ["read"]
}
