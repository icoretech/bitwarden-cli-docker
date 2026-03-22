# 🔐 Bitwarden CLI Docker Image

This repository hosts an automated build system for creating 🐳 Docker images of the [Bitwarden CLI](https://help.bitwarden.com/article/cli/).
The built AMD64 Docker images are published to GHCR with semantic tagging. amd64-only.

## 📖 Overview

The tracked Bitwarden CLI version lives in `Dockerfile` as `BW_VERSION`.
Renovate watches upstream Bitwarden CLI releases (tags like `cli-v2026.2.0`),
opens a PR when that tracked version changes, and merging that PR publishes the
matching GHCR image tag.

## 💡 Usage

Pull the image:

```bash
docker pull ghcr.io/icoretech/bitwarden-cli-docker:<tag>
```

Replace `<tag>` with a Bitwarden CLI version (for example, `2026.2.0`).

You can find available tags on the [GitHub Packages page](https://github.com/icoretech/bitwarden-cli-docker/pkgs/container/bitwarden-cli-docker).

This image runs the `bw` binary as a non-root user (`uid 1000`) with `HOME` set to `/bw`. The entrypoint transparently proxies arguments to `bw`.

For interactive CLI usage it is reasonable to persist `/bw` between runs. For
long-lived `bw serve` automation, especially across CLI upgrades, a clean or
ephemeral `/bw` is safer because stale CLI state can wedge login or startup.

```bash
# Persist CLI config/session between runs
mkdir -p ./bw

docker run --rm -it \
  -e BW_HOST=https://vault.bitwarden.com \
  -e BW_USER=user@example.com \
  -e BW_PASSWORD='your-master-password' \
  -v $PWD/bw:/bw \
  ghcr.io/icoretech/bitwarden-cli-docker:2026.2.0
```

## 📄 License

The Docker images and the code in this repository are released under [MIT License](LICENSE).

Please note that the Bitwarden project has its own license and terms, which you should review if you plan to use, distribute, or modify the software.
