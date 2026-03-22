# Runtime Behavior

## Overview

Use this file when changing container startup behavior or `/bw` state handling.

## Entrypoint Rules

- Passing explicit arguments should remain a direct passthrough to `bw`
- No-argument startup is the managed `bw serve` path
- `bw serve` mode requires `BW_HOST` and either API-key or user/password login
- Keep runtime behavior non-root with `HOME=/bw`

## State Handling

- Persisted `/bw` is acceptable for interactive CLI use
- Long-lived `bw serve` automation is safer with a clean or ephemeral `/bw`
  across upgrades
- Do not add runtime logging that exposes secrets or session material
