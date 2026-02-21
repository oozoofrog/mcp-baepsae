#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLED_DIR="$PROJECT_ROOT/bundled"
NATIVE_BUILD="$PROJECT_ROOT/native/.build/release/baepsae-native"

echo "Building baepsae-native (release)..."
if ! npm run build:native --prefix "$PROJECT_ROOT"; then
  echo ""
  echo "Error: Swift build failed."
  echo "Ensure Swift toolchain is installed:"
  echo "  - macOS: Install Xcode or run 'xcode-select --install'"
  echo "  - See https://www.swift.org/install/ for other platforms"
  exit 1
fi

if [ ! -f "$NATIVE_BUILD" ]; then
  echo "Error: baepsae-native binary not found at $NATIVE_BUILD"
  exit 1
fi

mkdir -p "$BUNDLED_DIR"
cp "$NATIVE_BUILD" "$BUNDLED_DIR/baepsae-native"
chmod +x "$BUNDLED_DIR/baepsae-native"

echo "Verifying bundled binary..."
if ! "$BUNDLED_DIR/baepsae-native" --version; then
  echo "Error: bundled binary failed verification (--version check failed)"
  exit 1
fi

echo "Bundled: $BUNDLED_DIR/baepsae-native"
ls -lh "$BUNDLED_DIR/baepsae-native"
