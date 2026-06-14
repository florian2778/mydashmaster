#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

if [ ! -f "$PROJECT_ROOT/compose.yaml" ]; then
    echo "ERROR: compose.yaml not found in $PROJECT_ROOT"
    exit 1
fi

if [ ! -d "$PROJECT_ROOT/.git" ]; then
    echo "ERROR: Git repository not found in $PROJECT_ROOT"
    exit 1
fi

git fetch --tags

VERSION="$(git describe --tags --always)"
REVISION="$(git rev-parse --short HEAD)"

echo "========================================"
echo "Deploying Dashmaster"
echo "Version : $VERSION"
echo "Revision: $REVISION"
echo "Directory: $PROJECT_ROOT"
echo "========================================"

"$SCRIPT_DIR/write-version.sh"

docker compose up -d --build

echo ""
echo "Deployment completed"
echo "Running version: $VERSION-$REVISION"
