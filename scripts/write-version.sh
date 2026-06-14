#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

VERSION="$(git describe --tags --abbrev=0 2>/dev/null || echo "dev")"
REVISION="$(git rev-parse --short HEAD)"
DISPLAY_VERSION="${VERSION}-${REVISION}"

mkdir -p src/generated

cat > src/generated/version.json <<EOF
{
  "version": "${VERSION}",
  "revision": "${REVISION}",
  "displayVersion": "${DISPLAY_VERSION}"
}
EOF

echo "Generated version.json: ${DISPLAY_VERSION}"
