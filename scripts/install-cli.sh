#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PREFIX=${RDEVTOOL_INSTALL_PREFIX:-"$HOME/.local"}
DRY_RUN=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --prefix)
            [ "$#" -ge 2 ] || {
                echo "missing value for --prefix" >&2
                exit 2
            }
            PREFIX=$2
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        *)
            echo "unsupported argument: $1" >&2
            exit 2
            ;;
    esac
done

cd "$ROOT_DIR"

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "refusing to install a stable CLI from a dirty worktree" >&2
    echo "commit or stash the source changes, then rerun this script" >&2
    exit 1
fi

COMMIT=$(git rev-parse --verify HEAD)
TARGET="$PREFIX/bin/rdevtool"

if [ "$DRY_RUN" -eq 1 ]; then
    echo "source : $ROOT_DIR"
    echo "commit : $COMMIT"
    echo "target : $TARGET"
    echo "build  : cargo build --locked --release --bin rdevtool"
    exit 0
fi

RDEVTOOL_BUILD_COMMIT="$COMMIT" \
RDEVTOOL_BUILD_DIRTY=false \
RDEVTOOL_INSTALL_KIND=installed \
cargo build --locked --release --bin rdevtool
mkdir -p "$PREFIX/bin"
TEMP_TARGET="$TARGET.tmp.$$"
trap 'rm -f "$TEMP_TARGET"' EXIT HUP INT TERM
install -m 0755 "$ROOT_DIR/target/release/rdevtool" "$TEMP_TARGET"
mv -f "$TEMP_TARGET" "$TARGET"
trap - EXIT HUP INT TERM

echo "installed rdevtool from $COMMIT"
echo "target: $TARGET"
case ":$PATH:" in
    *":$PREFIX/bin:"*) ;;
    *) echo "warning: $PREFIX/bin is not currently on PATH" >&2 ;;
esac
