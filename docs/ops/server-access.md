# Server access

For operators. Replaces root-only access with two named users, then locks down SSH. Written for Debian and Ubuntu.

Keep a second terminal and your provider's web console open. Do not close the root session until both new logins work.

| User | For | Rights |
| --- | --- | --- |
| `admin` | You: logs, restores | `sudo` (password), `docker` group |
| `deploy` | CI deploy (`DEPLOY_USER`) | `docker` group, no `sudo` |

The `docker` group is effectively root. The split still stops the CI key from changing SSH, the firewall or users, and names each key in the logs.

## 1. Create users (as root)

```bash
adduser admin
usermod -aG sudo,docker admin
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# Public keys only: your laptop for admin, the CI key for deploy
install -d -m 700 -o admin  -g admin  /home/admin/.ssh
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo 'ssh-ed25519 AAAA... you@laptop'      > /home/admin/.ssh/authorized_keys
echo 'ssh-ed25519 AAAA... zenflow-deploy' > /home/deploy/.ssh/authorized_keys
chmod 600 /home/*/.ssh/authorized_keys
chown admin:admin /home/admin/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

The CI private key is the `DEPLOY_SSH_KEY` GitHub secret.

## 2. Hand deploy files to `deploy`

```bash
DEPLOY_PATH=/path/you/set/in/DEPLOY_PATH
chown -R deploy:deploy "$DEPLOY_PATH"
chown deploy:deploy /etc/zenflow/vault/role_id /etc/zenflow/vault/secret_id
echo 'd /run/zenflow 0700 deploy deploy' > /etc/tmpfiles.d/zenflow.conf
systemd-tmpfiles --create
```

Volumes and running containers are unaffected. See [vault.md](vault.md#deploy-user).

## 3. Test both logins

From your laptop, in new terminals:

```bash
ssh admin@<host> 'sudo -v && docker ps'
ssh -i <ci-key> deploy@<host> 'docker ps && ls /etc/zenflow/vault'
```

Set `DEPLOY_USER=deploy` on each GitHub Environment and run a deploy (staging first). See [ci-cd.md](ci-cd.md).

## 4. Lock down SSH

As `admin`:

```bash
sudo tee /etc/ssh/sshd_config.d/10-zenflow.conf >/dev/null <<'EOF2'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers admin deploy
EOF2
sudo sshd -t && sudo systemctl reload ssh      # "sshd" on some distros
```

Do not reload if `sshd -t` prints an error. Log in again as both users before closing root. The first value wins, so check `sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication|allowusers'`.

## 5. Firewall, fail2ban, updates

```bash
sudo apt-get update && sudo apt-get install -y ufw fail2ban unattended-upgrades
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable                                   # allow 22 first
sudo dpkg-reconfigure -plow unattended-upgrades
```

- Docker ports bypass `ufw`. Only nginx (80, 443) is published and Vault is on `127.0.0.1:8200`. Do not add `ports:` for a database or Redis.
- `fail2ban` guards SSH with defaults.
- A reboot clears `/run/zenflow`: unseal Vault and redeploy ([vault.md](vault.md#after-a-restart-or-reboot)).

## 6. Root

With `PermitRootLogin no`, root is console-only. Optionally `sudo passwd -l root`. Day to day: `ssh admin@host`, then `cd $DEPLOY_PATH/backend`.

## Record it

Add the users and key holders to the "Deploy host SSH" row in [secrets.md](secrets.md#access-fill-in). To rotate a key: add the new public key, test it, remove the old one.
