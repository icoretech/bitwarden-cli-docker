# Repository Guidelines

Docker image wrapper around the official Bitwarden CLI, with Renovate-tracked
upstream version bumps and GHCR publishing on `main`.

## Quick Reference

- `docker build -t bitwarden-cli-docker:local .`: local image build
- `shellcheck entrypoint.sh`: shell lint
- `actionlint .github/workflows/build.yml`: workflow lint
- `docker run --rm -v "$PWD:/usr/src/app" -w /usr/src/app \`
  `renovate/renovate:latest renovate-config-validator`: validate Renovate
  config

## Detailed Instructions

- [Architecture & Layout](agent-instructions/architecture.md)
- [Runtime Behavior](agent-instructions/runtime.md)
- [Testing & Verification](agent-instructions/testing.md)
- [Release Workflow](agent-instructions/release-workflow.md)
