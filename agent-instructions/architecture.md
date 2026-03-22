# Architecture & Layout

## Overview

Use this file when deciding where image, runtime, or automation changes belong.

## Project Structure

- `Dockerfile`: tracked Bitwarden CLI version and image build logic
- `entrypoint.sh`: runtime wrapper for passthrough CLI mode and `bw serve`
- `.github/workflows/build.yml`: PR build plus `main` publish flow
- `renovate.json`: upstream version-tracking rules for `BW_VERSION`
- `README.md`: operator-facing usage and runtime guidance

## Placement Rules

- Put Bitwarden CLI version tracking in `Dockerfile`
- Keep runtime behavior in `entrypoint.sh`
- Keep publish automation in GitHub Actions, not ad hoc shell scripts
- Document operator-facing changes in `README.md`
