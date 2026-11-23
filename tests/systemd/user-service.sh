#!/usr/bin/env bash
set -euo pipefail

fixture=$(mktemp -d /tmp/anjian-user-service.XXXXXX)
account=anjian-systemd-test
node_bin=$(command -v node)
sudo useradd --home-dir "$fixture" --shell /bin/bash "$account"
uid=$(id -u "$account")
cleanup() {
  sudo journalctl --no-pager -u "user@$uid.service" -n 45 || true
  sudo loginctl disable-linger "$account" || true
  sudo loginctl terminate-user "$account" || true
  sudo userdel "$account" || true
  sudo rm -rf "$fixture"
}
trap cleanup EXIT

cp -R artifacts/dist "$fixture/dist"
project="$fixture/Review 100% with \$ markers"
mkdir -p "$project/.anjian/artifacts/document/plan"
printf '%s\n' '<doc><p>systemd smoke test</p></doc>' > "$project/.anjian/artifacts/document/plan/doc.xml"
sudo chown -R "$account:$account" "$fixture"
sudo loginctl enable-linger "$account"

user_home=(sudo -u "$account" env "HOME=$fixture" "XDG_RUNTIME_DIR=/run/user/$uid" "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus")
cli() { "${user_home[@]}" "$node_bin" "$fixture/dist/cli.cjs" "$@" --json; }
manager() { "${user_home[@]}" systemctl --user "$@"; }

wait_for() {
  local check=$1
  for _ in {1..80}; do
    if "$check"; then return 0; fi
    sleep 0.25
  done
  manager status anjian-hub.service || true
  "${user_home[@]}" journalctl --user -u anjian-hub.service --no-pager -n 50 || true
  return 1
}
manager_ready() { manager show-environment > /dev/null 2>&1; }
pid_file="$fixture/.anjian/server/server.pid"
state() { manager show --property=ActiveState --value anjian-hub.service; }
service_ready() {
  [[ "$(state)" == active && -s "$pid_file" ]] \
    && sudo kill -0 "$(cat "$pid_file")" 2> /dev/null
}
no_takeover() { [[ "$(manager show --property=ExecMainStatus --value anjian-hub.service)" == 78 ]]; }
new_pid() { service_ready && [[ "$(cat "$pid_file")" != "$original" ]]; }

wait_for manager_ready
cli service install --project-dir "$project"
cli service install --project-dir "$project"
manager is-enabled --quiet anjian-hub.service

cli start --project-dir "$project" --no-open --background
original=$(cat "$pid_file")
cli service start || true
wait_for no_takeover
[[ "$(cat "$pid_file")" == "$original" ]]
cli stop

# Restart the isolated user manager to exercise automatic startup through default.target.
sudo systemctl restart "user@$uid.service"
wait_for manager_ready
wait_for service_ready
cli start --project-dir "$project" --artifact document/plan --no-open | jq -e '.reused and (.link | contains("/document/"))'

original=$(cat "$pid_file")
sudo kill -KILL "$original"
wait_for new_pid
cli service status | jq -e '.ActiveState == "active" and .UnitFileState == "enabled"'
cli service stop
[[ "$(state)" == inactive ]]
cli service start
wait_for service_ready
cli service uninstall
[[ ! -e "$fixture/.config/systemd/user/anjian-hub.service" ]]
[[ -f "$project/.anjian/artifacts/document/plan/doc.xml" ]]
[[ -f "$fixture/.anjian/server/key" ]]
cli service status | jq -e '.type == "service-not-installed"'
