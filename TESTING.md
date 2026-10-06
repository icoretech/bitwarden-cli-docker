# Compatibility checks

Publishing requires a successful test against the stable Vaultwarden image pinned in `.github/workflows/build.yml`. Renovate proposes updates to both the CLI and that server image. The CLI release remains tracked in `Dockerfile`; a successful image build alone does not establish server compatibility.

Run the fast entrypoint checks with:

```sh
shellcheck entrypoint.sh tests/entrypoint_test.sh
sh tests/entrypoint_test.sh
actionlint .github/workflows/build.yml
```

Run the real compatibility check with Docker, Node.js 26, and OpenSSL:

```sh
docker build -t bitwarden-cli-contract:local .
CLI_IMAGE=bitwarden-cli-contract:local \
  VAULTWARDEN_IMAGE=vaultwarden/server:1.37.4-alpine \
  node tests/vaultwarden_test.mjs
```

Use the machine's native image architecture for local acceptance. The command above builds it by default; CI runs the same check on native Linux amd64 with Ubuntu 24.04. An amd64 image emulated on an arm64 workstation can spend the managed server's 60-second readiness budget in CLI login and startup. Diagnose such a timeout with a native image and the recorded last HTTP/status result; do not increase the timeout or add whole-test retries to accept an incompatible client.

The test creates a dedicated Docker network, a fresh Vaultwarden database, and two CLI containers with separate state. The clients share the server's network namespace and use its loopback HTTPS endpoint. A temporary certificate is explicitly trusted through `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE`; certificate verification stays enabled. All published ports bind to host loopback with dynamically allocated port numbers. Account credentials, encryption keys, and the TLS key are generated for each run; no existing vault, account, or host credential is used. Containers, their volumes, the network, and temporary certificate files are removed on completion, including test failures. Interruptions that forcibly kill the test process can require manual removal of resources bearing the printed `bw.contract` ownership label and the matching temporary directory.

The checks cover fresh username/password login, lock and unlock, encrypted item creation, forced sync, decrypted item retrieval, and the actual no-argument entrypoint starting `bw serve`. The HTTP item read also supplies a Kubernetes service Host header to cover service-name compatibility. The existing shell test separately covers argument passthrough. Fixture registration uses Vaultwarden's account API; the CLI itself performs all login, encryption, sync, and item-read operations under test.

Vaultwarden 1.37.4 includes the `/api/accounts/key-management/user-key-id` route required by CLI 2026.9.0+. CLI 2026.9.1 passed the full compatibility test against Vaultwarden 1.37.4 on October 6, 2026. The older pairing of CLI 2026.9.0 and Vaultwarden 1.37.3 fails login with `KeyIdBackfillError`; see [the upstream report](https://github.com/dani-garcia/vaultwarden/issues/7750) and [the server fix](https://github.com/dani-garcia/vaultwarden/pull/7693). The fixture registers accounts through the current verification-token flow; Vaultwarden 1.37.4 removed the legacy `POST /identity/accounts/register` endpoint.
