#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
exec python3 "$SCRIPT_DIR/self_test.py" --package-root "$PACKAGE_ROOT" "$@"
