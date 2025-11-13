#!/usr/bin/env sh
set -eu

# If arguments are provided, run bw with them (passthrough mode)
if [ "$#" -gt 0 ]; then
  exec bw "$@"
fi

# Server mode

if [ -z "${BW_HOST:-}" ]; then
  echo "BW_HOST is required" >&2
  exit 2
fi

# Point CLI to the desired server (US/EU/self-hosted)
bw config server "${BW_HOST}"

# Login/unlock
if [ -n "${BW_CLIENTID:-}" ] && [ -n "${BW_CLIENTSECRET:-}" ]; then
  echo "Using API key to log in"
  # bw reads BW_CLIENTID and BW_CLIENTSECRET from env
  bw login --apikey --raw >/dev/null 2>&1 || true
  if [ -n "${BW_PASSWORD:-}" ]; then
    export BW_SESSION="$(bw unlock --passwordenv BW_PASSWORD --raw)"
  fi
else
  if [ -z "${BW_USER:-}" ] || [ -z "${BW_PASSWORD:-}" ]; then
    echo "BW_USER and BW_PASSWORD are required when not using API key" >&2
    exit 2
  fi
  echo "Using username/password to log in"
  export BW_SESSION="$(bw login "${BW_USER}" --passwordenv BW_PASSWORD --raw)"
fi

# Ensure session is valid if possible
bw unlock --check >/dev/null 2>&1 || true

echo 'Running `bw serve` on 0.0.0.0:8087'
exec bw serve --hostname 0.0.0.0
