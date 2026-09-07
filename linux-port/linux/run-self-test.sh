#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$SCRIPT_DIR/self_test.py" --package-root "$PACKAGE_ROOT" "$@"
