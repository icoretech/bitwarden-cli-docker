# Release Workflow

## Overview

Use this file when changing upstream version tracking or publish automation.

## Rules

- `BW_VERSION` in `Dockerfile` is the single tracked source of the bundled CLI
  version
- Renovate is responsible for proposing upstream Bitwarden CLI bumps
- Pull requests should build the image without publishing
- Pushes to `main` publish the image tag that matches `BW_VERSION`

## Avoid

- Do not reintroduce keepalive commits or cron-driven "stay active" workflows
- Do not add out-of-repo state such as S3 revision markers for version tracking
- Do not bypass the tracked `BW_VERSION` by auto-resolving latest tags inside
  the workflow
