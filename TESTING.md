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
  VAULTWARDEN_IMAGE=vaultwarden/server:1.37.3-alpine \
  node tests/vaultwarden_test.mjs
```

The test creates a dedicated Docker network, a fresh Vaultwarden database, and two CLI containers with separate state. The clients share the server's network namespace and use its loopback HTTPS endpoint. A temporary certificate is explicitly trusted through `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE`; certificate verification stays enabled. All published ports bind to host loopback with dynamically allocated port numbers. Account credentials, encryption keys, and the TLS key are generated for each run; no existing vault, account, or host credential is used. Containers, their volumes, the network, and temporary certificate files are removed on completion, including test failures. Interruptions that forcibly kill the test process can require manual removal of resources bearing the printed `bw.contract` ownership label and the matching temporary directory.

The checks cover fresh username/password login, lock and unlock, encrypted item creation, forced sync, decrypted item retrieval, and the actual no-argument entrypoint starting `bw serve`. The HTTP item read also supplies a Kubernetes service Host header to cover service-name compatibility. The existing shell test separately covers argument passthrough. Fixture registration uses Vaultwarden's account API; the CLI itself performs all login, encryption, sync, and item-read operations under test.

CLI 2026.8.0 is retained while Vaultwarden stable is 1.37.3. CLI 2026.9.0 fails fresh login with `KeyIdBackfillError` because the server lacks `/api/accounts/key-management/user-key-id`; see [the upstream report](https://github.com/dani-garcia/vaultwarden/issues/7750) and [the server fix](https://github.com/dani-garcia/vaultwarden/pull/7693). To verify the regression detector, run the same test with the 2026.9.0 image: it must exit nonzero during login. Do not turn that failure into an allowed CI result or publish an incompatible candidate. Lift the CLI pin after a released server passes the same test.
