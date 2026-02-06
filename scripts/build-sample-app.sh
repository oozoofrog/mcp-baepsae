#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SAMPLE_APP_DIR="$PROJECT_ROOT/test-fixtures/SampleApp"
BUILD_DIR="$SAMPLE_APP_DIR/build"

if [ ! -d "$SAMPLE_APP_DIR/SampleApp.xcodeproj" ]; then
  echo "Error: SampleApp.xcodeproj not found at $SAMPLE_APP_DIR"
  exit 1
fi

echo "Building SampleApp for iOS Simulator..."

xcodebuild \
  -project "$SAMPLE_APP_DIR/SampleApp.xcodeproj" \
  -scheme SampleApp \
  -sdk iphonesimulator \
  -configuration Debug \
  -derivedDataPath "$SAMPLE_APP_DIR/DerivedData" \
  SYMROOT="$BUILD_DIR" \
  -quiet

APP_PATH="$BUILD_DIR/Debug-iphonesimulator/SampleApp.app"

if [ -d "$APP_PATH" ]; then
  echo "Build successful: $APP_PATH"
else
  echo "Error: SampleApp.app not found after build"
  exit 1
fi
