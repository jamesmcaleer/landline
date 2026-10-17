#!/usr/bin/env sh
# Downloads the pinned Droid CLI into backend/bin/droid. The SDK (0.9.1) only
# accepts CLI 0.212.1; newer CLIs fail the protocol check when SDK MCP tools
# are attached. Run via `npm run fetch-droid -w backend` or automatically on install.
set -eu
VERSION="${DROID_VERSION:-0.212.1}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"
OUT="$DIR/droid"
if [ -x "$OUT" ] && [ "$("$OUT" --version 2>/dev/null | head -1)" = "$VERSION" ]; then
  exit 0
fi
case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) echo "unsupported OS" >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac
mkdir -p "$DIR"
echo "Downloading droid $VERSION for $OS/$ARCH into $OUT"
curl -fsSL "https://downloads.factory.ai/factory-cli/releases/$VERSION/$OS/$ARCH/droid" -o "$OUT.tmp"
chmod +x "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
