#!/usr/bin/env bash
# Keeps the machine awake for as long as this process lives, WITHOUT touching the power plan.
# `exec` replaces the shell, so killing this process releases the inhibitor.
set -u
case "$(uname -s)" in
  Darwin)
    exec caffeinate -dis ;;
  Linux)
    if command -v systemd-inhibit >/dev/null 2>&1; then
      exec systemd-inhibit --what=idle:sleep --who=zenflow-loadtest --why="k6 load test" sleep infinity
    fi
    echo "keep-awake: systemd-inhibit not found; the heartbeat will flag any host sleep" >&2
    exec sleep infinity ;;
  MINGW*|MSYS*|CYGWIN*)
    # Git Bash on Windows: SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED), inline.
    exec powershell.exe -NoProfile -Command \
      "Add-Type -Namespace W -Name P -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'; while (\$true) { [void][W.P]::SetThreadExecutionState(0x80000001); Start-Sleep -Seconds 30 }" ;;
  *)
    echo "keep-awake: unsupported OS; the heartbeat will flag any host sleep" >&2
    exec sleep 2147483647 ;;
esac
