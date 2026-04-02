# Local build and run
#
# Build (choose Bitwarden CLI version via BW_VERSION):
#   docker build -t bitwarden-cli-docker:local --build-arg BW_VERSION=2026.2.0 .
#
# Run (interactive):
#   docker run --rm -it --name bw bitwarden-cli-docker:local --version
#   docker run --rm -it --name bw bitwarden-cli-docker:local login --apikey

# Downloader stage: fetch and verify Bitwarden CLI binary
FROM --platform=$BUILDPLATFORM alpine:3.22 AS downloader

# renovate: datasource=github-releases depName=bitwarden/clients extractVersion=^cli-v(?<version>.+)$
ARG BW_VERSION=2026.3.0
ARG TARGETARCH

RUN apk update --no-cache \
 && apk add --no-cache curl jq unzip ca-certificates \
 && VERSION="${BW_VERSION}" \
 && case "${TARGETARCH}" in \
      amd64) ASSET_ARCH="" ;; \
      arm64) ASSET_ARCH="-arm64" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && ASSET_NAME="bw-oss-linux${ASSET_ARCH}-${VERSION}.zip" \
 && if [ -z "$VERSION" ]; then echo "BW_VERSION build-arg is required" >&2; exit 1; fi \
 && curl -sLo /tmp/bw.zip "https://github.com/bitwarden/clients/releases/download/cli-v${VERSION}/${ASSET_NAME}" \
 && echo $( \
    curl -sL "https://api.github.com/repos/bitwarden/clients/releases/tags/cli-v${VERSION}" | jq -r ".assets[] | select(.name == \"${ASSET_NAME}\") .digest" | cut -f2 -d: \
  ) /tmp/bw.zip > /tmp/sum.txt \
 && sha256sum -sc /tmp/sum.txt \
 && unzip -d /tmp /tmp/bw.zip \
 && chmod +x /tmp/bw

# Runtime stage
FROM debian:stable-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates wget \
 && rm -rf /var/lib/apt/lists/*

COPY --from=downloader /tmp/bw /usr/local/bin/bw

# Non-root execution setup
USER 1000
WORKDIR /bw
ENV HOME=/bw

# Entrypoint wraps the CLI so `docker run ... <args>` becomes `bw <args>`
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
