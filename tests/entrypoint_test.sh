#!/usr/bin/env sh
set -eu

repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
entrypoint=${ENTRYPOINT:-"$repo_dir/entrypoint.sh"}
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/bitwarden-cli-entrypoint.XXXXXX")
managed_pid=
timer_pid=

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

kill_descendants() {
  parent_pid=$1

  pgrep -P "$parent_pid" 2>/dev/null |
    while IFS= read -r child_pid; do
      kill_descendants "$child_pid"
      kill "$child_pid" 2>/dev/null || true
    done
}

stop_timeout() {
  if [ -n "$timer_pid" ]; then
    kill "$timer_pid" 2>/dev/null || true
    wait "$timer_pid" 2>/dev/null || true
    timer_pid=
  fi
}

stop_managed_entrypoint() {
  if [ -n "$managed_pid" ]; then
    kill_descendants "$managed_pid"
    kill "$managed_pid" 2>/dev/null || true
    wait "$managed_pid" 2>/dev/null || true
    managed_pid=
  fi
}

cleanup() {
  stop_timeout
  stop_managed_entrypoint
  rm -rf "$tmp_dir"
}

trap cleanup 0
trap 'cleanup; exit 130' HUP INT TERM

mkdir -p "$tmp_dir/bin"
cat > "$tmp_dir/bin/bw" <<'EOF'
#!/usr/bin/env sh
set -eu

if [ "${BW_TEST_MODE:-}" = "passthrough" ]; then
  : > "$BW_TEST_LOG"
  for argument do
    printf '%s\n' "$argument" >> "$BW_TEST_LOG"
  done
  exit 0
fi

case "${1:-}" in
  serve)
    : > "$BW_TEST_LOG"
    for argument do
      printf '%s\n' "$argument" >> "$BW_TEST_LOG"
    done
    printf 'ready\n' > "$BW_TEST_READY"
    while :; do
      sleep 60
    done
    ;;
  login | unlock)
    printf 'test-session\n'
    ;;
esac
EOF
chmod +x "$tmp_dir/bin/bw"

assert_args() {
  scenario=$1
  expected=$2
  actual=$3

  if ! cmp -s "$expected" "$actual"; then
    printf 'FAIL: %s arguments differed\n' "$scenario" >&2
    diff -u "$expected" "$actual" >&2 || true
    exit 1
  fi
}

printf '%s\n' '--version' '--raw' > "$tmp_dir/passthrough.expected"
PATH="$tmp_dir/bin:$PATH" \
  BW_TEST_MODE=passthrough \
  BW_TEST_LOG="$tmp_dir/passthrough.actual" \
  "$entrypoint" --version --raw
assert_args 'explicit passthrough' "$tmp_dir/passthrough.expected" "$tmp_dir/passthrough.actual"
printf '%s\n' 'PASS: explicit arguments pass through unchanged'

printf '%s\n' 'serve' '--hostname' 'all' > "$tmp_dir/managed.expected"
mkfifo "$tmp_dir/managed.ready"
PATH="$tmp_dir/bin:$PATH" \
  BW_HOST=https://example.test \
  BW_CLIENTID=test-client \
  BW_CLIENTSECRET=test-secret \
  BW_PASSWORD=test-password \
  BW_UNLOCK_INTERVAL=60 \
  BW_TEST_LOG="$tmp_dir/managed.actual" \
  BW_TEST_READY="$tmp_dir/managed.ready" \
  "$entrypoint" > "$tmp_dir/managed.stdout" 2> "$tmp_dir/managed.stderr" &
managed_pid=$!

(
  sleep 5
  kill_descendants "$managed_pid"
  kill "$managed_pid" 2>/dev/null || true
  : > "$tmp_dir/managed.timeout"
) &
timer_pid=$!

if ! IFS= read -r ready < "$tmp_dir/managed.ready"; then
  fail 'managed mode did not reach bw serve'
fi
stop_timeout

if [ -n "${BW_TEST_READY_HOLD:-}" ]; then
  while [ ! -e "$BW_TEST_READY_HOLD" ]; do
    sleep 1
  done
fi

if [ -f "$tmp_dir/managed.timeout" ] || [ "$ready" != 'ready' ]; then
  fail 'managed mode timed out before bw serve'
fi

assert_args 'managed server' "$tmp_dir/managed.expected" "$tmp_dir/managed.actual"
stop_managed_entrypoint
printf '%s\n' 'PASS: no-argument managed mode uses bw serve --hostname all'
