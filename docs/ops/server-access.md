# Server access: non-root users and hardening

For operators. Replaces "everything as root" with two named users, then locks down SSH. Written for Debian/Ubuntu; adapt the package commands for another distro.

> **Do this with a second terminal open.** A typo in the SSH or firewall steps can lock you out. Keep your provider's web console (VNC/serial) as the way back in, and do not close the root session until the new logins work.

## The two users

| User | For | Rights |
| --- | --- | --- |
| `admin` | you, by hand: logs, restores, `sudo` | `sudo` (with a password), `docker` group |
| `deploy` | the CI deploy job (`DEPLOY_USER`) | `docker` group, **no** `sudo` |

Membership of the `docker` group is effectively root on the host (a container can mount `/`). Splitting the users still helps: the CI key cannot change SSH, the firewall or other users, and each person or key is named in the logs. For stronger isolation, run Docker rootless; that is a larger change and not covered here.

## 1. Create the users (as root)

```bash
adduser admin                          # set a strong password: sudo asks for it
usermod -aG sudo,docker admin
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# Your laptop's PUBLIC key for admin; the CI key's PUBLIC half for deploy.
install -d -m 700 -o admin  -g admin  /home/admin/.ssh
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo 'ssh-ed25519 AAAA... you@laptop'      > /home/admin/.ssh/authorized_keys
echo 'ssh-ed25519 AAAA... zenflow-deploy' > /home/deploy/.ssh/authorized_keys
chmod 600 /home/*/.ssh/authorized_keys
chown admin:admin /home/admin/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

The CI private key is the `DEPLOY_SSH_KEY` GitHub secret; its public half is the `.pub` you generated with it.

## 2. Hand the deploy files to `deploy`

Files a root deploy created are root-owned. Give them to `deploy` (the AppRole credentials and `/run/zenflow` are the ones [vault.md](vault.md#deploy-user) already requires):

```bash
DEPLOY_PATH=/path/you/set/in/DEPLOY_PATH
chown -R deploy:deploy "$DEPLOY_PATH"
chown deploy:deploy /etc/zenflow/vault/role_id /etc/zenflow/vault/secret_id
echo 'd /run/zenflow 0700 deploy deploy' > /etc/tmpfiles.d/zenflow.conf   # /run is tmpfs: recreated each boot
systemd-tmpfiles --create
```

Docker volumes and running containers are unaffected. `.env.prod` and the rendered secrets become owned by `deploy` (mode 600), which is why [secrets.md](secrets.md) no longer says root-owned.

## 3. Test both logins before changing anything else

From your laptop, new terminals:

```bash
ssh admin@<host> 'sudo -v && docker ps'
ssh -i <ci-key> deploy@<host> 'docker ps && ls /etc/zenflow/vault'
```

Then in GitHub, set the `DEPLOY_USER` variable on each Environment to `deploy` (`DEPLOY_HOST`, the key and `DEPLOY_KNOWN_HOSTS` stay) and run a deploy. Staging first if it shares the host. Confirm the stack is healthy and Vault renders ([ci-cd.md](ci-cd.md)).

## 4. Lock down SSH

As `admin`:

```bash
sudo tee /etc/ssh/sshd_config.d/10-zenflow.conf >/dev/null <<'EOF2'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers admin deploy
EOF2
sudo sshd -t && sudo systemctl reload ssh      # service is "sshd" on some distros
```

`sshd -t` prints nothing when the config is valid; do not reload if it errors. Open a **new** terminal and log in as `admin` and as `deploy` again; only then close the root session. If the main config sets these options too, the first value wins, so check `sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication|allowusers'`.

## 5. Firewall, brute-force, updates

```bash
sudo apt-get update && sudo apt-get install -y ufw fail2ban unattended-upgrades
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable                                   # allow 22 first or this cuts you off
sudo dpkg-reconfigure -plow unattended-upgrades
```

- Docker publishes container ports through its own iptables rules, which **bypass `ufw`**. Only nginx (80/443) is published; Vault is bound to `127.0.0.1:8200` and everything else is on internal networks. Do not add `ports:` for a database or Redis without thinking about this.
- `fail2ban` protects SSH with its defaults once installed.
- Reboot after kernel updates in a quiet window; a reboot clears `/run/zenflow`, so Vault must be unsealed and the next deploy re-renders ([vault.md](vault.md#after-a-vault-restart-or-host-reboot)).

## 6. Root

With `PermitRootLogin no` root is only reachable from the console. Optionally lock the password too (`sudo passwd -l root`). Day-to-day work is `ssh admin@host`, then `cd $DEPLOY_PATH/backend` (`docker` needs no `sudo`; system changes use `sudo`).

## Record it

Add the new users and who holds each key to the access table in [secrets.md](secrets.md) ("Deploy host SSH"). Rotating a key: add the new public key, test it, remove the old one.
