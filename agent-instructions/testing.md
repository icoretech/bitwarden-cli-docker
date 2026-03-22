# Testing & Verification

## Overview

Use this file when validating changes in this repository.

## Commands

- `docker build -t bitwarden-cli-docker:local .`
- `shellcheck entrypoint.sh`
- `actionlint .github/workflows/build.yml`
- `docker run --rm -v "$PWD:/usr/src/app" -w /usr/src/app \`
  `renovate/renovate:latest renovate-config-validator`

## Expectations

- Validate both image buildability and workflow syntax for automation changes
- Keep verification focused on the tracked release flow and runtime wrapper
- Prefer operator-facing README updates when runtime expectations change
