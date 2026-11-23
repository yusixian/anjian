#!/usr/bin/env bash
set -euo pipefail

fixture=$(mktemp -d /tmp/anjian-user-service.XXXXXX)
account=anjian-systemd-test
archive=${1:-}
sudo useradd --home-dir "$fixture" --shell /bin/bash "$account"
uid=$(id -u "$account")
drop_in="/etc/systemd/system/user@$uid.service.d"
cleanup() {
  sudo journalctl --no-pager -u "user@$uid.service" -n 45 || true
  sudo loginctl disable-linger "$account" || true
  sudo loginctl terminate-user "$account" || true
  sudo userdel "$account" || true
  sudo rm -f "$drop_in/anjian-test.conf"
  sudo rmdir "$drop_in" || true
  sudo systemctl daemon-reload || true
  if sudo test -f "$fixture/runner-environment"; then
    sudo cp -p "$fixture/runner-environment" /etc/environment
  fi
  sudo rm -rf "$fixture"
}
trap cleanup EXIT

if [[ -n "$archive" ]]; then
  install_dir="$fixture/Anjian 100% with \$"
  mkdir "$install_dir"
  tar -xzf "$archive" -C "$install_dir" --strip-components=1
  launcher=("$install_dir/anjian")
else
  launcher=("$(command -v node)" "$fixture/dist/cli.cjs")
  cp -R artifacts/dist "$fixture/dist"
fi

project="$fixture/Review 100% with \$ markers"
mkdir -p "$project/.anjian/artifacts/document/plan"
printf '%s\n' '<doc><p>systemd smoke test</p></doc>' > "$project/.anjian/artifacts/document/plan/doc.xml"
sudo chown -R "$account:$account" "$fixture"
# The hosted runner's manager-wide defaults point to the runner account.
sudo mkdir -p "$drop_in"
sudo tee "$drop_in/anjian-test.conf" > /dev/null << MANAGER
[Service]
Environment=HOME=$fixture XDG_CONFIG_HOME=$fixture/.config XDG_RUNTIME_DIR=/run/user/$uid DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus
MANAGER
sudo systemctl daemon-reload

# GitHub may set the runner account's XDG paths in PAM's global environment.
if [[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted ]] \
  && sudo grep -Eq '^[[:space:]]*(XDG_RUNTIME_DIR|XDG_CONFIG_HOME)=' /etc/environment; then
  sudo cp -p /etc/environment "$fixture/runner-environment"
  sudo sed -i -E '/^[[:space:]]*(XDG_RUNTIME_DIR|XDG_CONFIG_HOME)=/d' /etc/environment
fi
sudo loginctl enable-linger "$account"

user_home=(sudo -u "$account" env "HOME=$fixture" "XDG_CONFIG_HOME=$fixture/.config" "XDG_RUNTIME_DIR=/run/user/$uid" "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus")
cli() { "${user_home[@]}" "${launcher[@]}" "$@" --json; }
manager() { "${user_home[@]}" systemctl --user "$@"; }

wait_for() {
  local check=$1
  for _ in {1..80}; do
    if "$check"; then return 0; fi
    sleep 0.25
  done
  manager list-jobs || true
  manager status anjian-hub.service || true
  "${user_home[@]}" journalctl --user -u anjian-hub.service --no-pager -n 50 || true
  return 1
}
manager_ready() {
  sudo test -S "/run/user/$uid/bus" \
    && manager is-active --quiet default.target \
    && manager show-environment | grep -Fx "XDG_RUNTIME_DIR=/run/user/$uid" > /dev/null
}
pid_file="$fixture/.anjian/server/server.pid"
read_pid() { sudo cat "$pid_file"; }
state() { manager show --property=ActiveState --value anjian-hub.service; }
service_ready() {
  local previous=${1:-} pid port
  [[ "$(state)" == active ]] || return 1
  pid=$(read_pid 2> /dev/null) || return 1
  [[ "$pid" =~ ^[1-9][0-9]*$ && "$pid" != "$previous" ]] || return 1
  port=$(sudo jq -er --argjson pid "$pid" 'select(.pid == $pid) | .port' \
    "$fixture/.anjian/server/server-info" 2> /dev/null) || return 1
  curl --fail --silent --max-time 1 "http://127.0.0.1:$port/api/status" \
    | jq -e --argjson pid "$pid" '.pid == $pid' > /dev/null
}
no_takeover() { [[ "$(manager show --property=ExecMainStatus --value anjian-hub.service)" == 78 ]]; }
new_pid() { service_ready "$original"; }

wait_for manager_ready
cli service install --project-dir "$project"
cli service install --project-dir "$project"
manager is-enabled --quiet anjian-hub.service

cli start --project-dir "$project" --no-open --background
original=$(read_pid)
cli service start || true
wait_for no_takeover
[[ "$(read_pid)" == "$original" ]]
cli stop

# Restart the isolated user manager to exercise automatic startup through default.target.
sudo systemctl restart "user@$uid.service"
wait_for manager_ready
wait_for service_ready
cli start --project-dir "$project" --artifact document/plan --no-open | jq -e '.reused and (.link | contains("/document/"))'

original=$(read_pid)
sudo kill -KILL "$original"
wait_for new_pid
cli service status | jq -e '.ActiveState == "active" and .UnitFileState == "enabled"'
cli service stop
[[ "$(state)" == inactive ]]
cli service start
wait_for service_ready
cli service uninstall
sudo test ! -e "$fixture/.config/systemd/user/anjian-hub.service"
sudo test -f "$project/.anjian/artifacts/document/plan/doc.xml"
sudo test -f "$fixture/.anjian/server/key"
cli service status | jq -e '.type == "service-not-installed"'
