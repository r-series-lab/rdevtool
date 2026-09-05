#!/bin/sh
set -eu

SKILL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_DIR=${RDEVTOOL_SOURCE_DIR:-}
if [ -z "$SOURCE_DIR" ]; then
  SOURCE_DIR=$(CDPATH= cd -- "$SKILL_DIR/../.." && pwd)
fi
OUTPUT_DIR=${1:-"$SKILL_DIR/references/generated"}
TEMP_OUTPUT="$OUTPUT_DIR.tmp.$$"
PREVIOUS_OUTPUT="$OUTPUT_DIR.previous.$$"

cleanup() {
  rm -rf "$TEMP_OUTPUT" "$PREVIOUS_OUTPUT"
}
trap cleanup EXIT HUP INT TERM

cargo run \
  --quiet \
  --manifest-path "$SOURCE_DIR/Cargo.toml" \
  -- \
  docs generate-cli \
  --output-dir "$TEMP_OUTPUT"

if [ -d "$OUTPUT_DIR" ]; then
  mv "$OUTPUT_DIR" "$PREVIOUS_OUTPUT"
fi
mv "$TEMP_OUTPUT" "$OUTPUT_DIR"
rm -rf "$PREVIOUS_OUTPUT"
trap - EXIT HUP INT TERM
