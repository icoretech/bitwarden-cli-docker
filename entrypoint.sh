#!/usr/bin/env sh
set -eu

# If arguments are provided, run bw with them (passthrough mode)
# This keeps the image usable as a plain CLI.
if [ "$#" -gt 0 ]; then
  exec bw "$@"
fi

# --- Server mode (for bw serve) ---

if [ -z "${BW_HOST:-}" ]; then
  echo "BW_HOST is required" >&2
  exit 2
fi

# Point CLI to the desired server (US/EU/self-hosted)
bw config server "${BW_HOST}"

login_with_apikey() {
  echo "Using API key to log in"
  # bw reads BW_CLIENTID and BW_CLIENTSECRET from env
  bw login --apikey --raw >/dev/null 2>&1
}

login_with_user() {
  if [ -z "${BW_USER:-}" ] || [ -z "${BW_PASSWORD:-}" ]; then
    echo "BW_USER and BW_PASSWORD are required when not using API key" >&2
    exit 2
  fi
  echo "Using username/password to log in"
  BW_SESSION="$(bw login "${BW_USER}" --passwordenv BW_PASSWORD --raw)"
  export BW_SESSION
}

unlock_with_password() {
  if [ -z "${BW_PASSWORD:-}" ]; then
    echo "BW_PASSWORD is required to unlock vault" >&2
    return 1
  fi
  BW_SESSION="$(bw unlock --passwordenv BW_PASSWORD --raw)"
  export BW_SESSION
}

# Initial login + unlock so the vault starts in an unlocked state.
if [ -n "${BW_CLIENTID:-}" ] && [ -n "${BW_CLIENTSECRET:-}" ]; then
  login_with_apikey
  # Use password to derive a session so CLI/server can operate without prompts.
  unlock_with_password || {
    echo "Initial unlock failed; Bitwarden vault remains locked." >&2
  }
else
  login_with_user
fi

# Background watchdog: keep the vault unlocked even when Bitwarden/Vaultwarden
# applies short auto-lock timeouts (no \"never\" option).
keep_unlocked() {
  # We intentionally ignore transient errors here; ESO will surface issues
  # and the pod can be restarted by Kubernetes if needed.
  while true; do
    if ! bw unlock --check >/dev/null 2>&1; then
      echo "Vault appears locked; attempting re-unlock..." >&2
      if [ -n "${BW_CLIENTID:-}" ] && [ -n "${BW_CLIENTSECRET:-}" ]; then
        bw login --apikey --raw >/dev/null 2>&1 || true
      fi
      unlock_with_password || true
    fi
    sleep "${BW_UNLOCK_INTERVAL:-300}"
  done
}

# After initial login/unlock, we don't want set -e to kill the container
# because of a transient failure inside keep_unlocked.
set +e
keep_unlocked &

echo 'Running `bw serve` on 0.0.0.0:8087'
exec bw serve --hostname 0.0.0.0
