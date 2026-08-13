#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PREFIX=${RDEVTOOL_INSTALL_PREFIX:-"$HOME/.local"}
SKILL_DIR=${RDEVTOOL_SKILL_DIR:-"$HOME/.codex/skills/rdevtool"}
DRY_RUN=0
SKIP_SKILL=0

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
        --skill-dir)
            [ "$#" -ge 2 ] || {
                echo "missing value for --skill-dir" >&2
                exit 2
            }
            SKILL_DIR=$2
            shift 2
            ;;
        --skip-skill)
            SKIP_SKILL=1
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
SKILL_MANIFEST_SOURCE="$ROOT_DIR/skills/rdevtool/manifest.json"

if [ "$DRY_RUN" -eq 1 ]; then
    echo "source : $ROOT_DIR"
    echo "commit : $COMMIT"
    echo "target : $TARGET"
    echo "build  : cargo build --locked --release --bin rdevtool"
    if [ "$SKIP_SKILL" -eq 0 ]; then
        echo "skill  : $SKILL_DIR"
        echo "sync   : generated CLI references and manifest"
    fi
    exit 0
fi

RDEVTOOL_BUILD_COMMIT="$COMMIT" \
RDEVTOOL_BUILD_DIRTY=false \
RDEVTOOL_INSTALL_KIND=installed \
cargo build --locked --release --bin rdevtool
mkdir -p "$PREFIX/bin"
TEMP_TARGET="$TARGET.tmp.$$"
TEMP_GENERATED=""
TEMP_MANIFEST=""
cleanup() {
    rm -f "$TEMP_TARGET"
    [ -z "$TEMP_GENERATED" ] || rm -rf "$TEMP_GENERATED"
    [ -z "$TEMP_MANIFEST" ] || rm -f "$TEMP_MANIFEST"
}
trap cleanup EXIT HUP INT TERM
install -m 0755 "$ROOT_DIR/target/release/rdevtool" "$TEMP_TARGET"

if [ "$SKIP_SKILL" -eq 0 ] && [ -f "$SKILL_DIR/SKILL.md" ]; then
    [ -f "$SKILL_MANIFEST_SOURCE" ] || {
        echo "missing Skill manifest source: $SKILL_MANIFEST_SOURCE" >&2
        exit 1
    }
    mkdir -p "$SKILL_DIR/references"
    TEMP_GENERATED="$SKILL_DIR/references/generated.tmp.$$"
    TEMP_MANIFEST="$SKILL_DIR/manifest.json.tmp.$$"
    "$TEMP_TARGET" docs generate-cli --output-dir "$TEMP_GENERATED" >/dev/null
    install -m 0644 "$SKILL_MANIFEST_SOURCE" "$TEMP_MANIFEST"
fi

mv -f "$TEMP_TARGET" "$TARGET"

if [ -n "$TEMP_GENERATED" ]; then
    PREVIOUS_GENERATED="$SKILL_DIR/references/generated.previous.$$"
    if [ -d "$SKILL_DIR/references/generated" ]; then
        mv "$SKILL_DIR/references/generated" "$PREVIOUS_GENERATED"
    fi
    mv "$TEMP_GENERATED" "$SKILL_DIR/references/generated"
    mv "$TEMP_MANIFEST" "$SKILL_DIR/manifest.json"
    rm -rf "$PREVIOUS_GENERATED"
    TEMP_GENERATED=""
    TEMP_MANIFEST=""
fi
trap - EXIT HUP INT TERM

echo "installed rdevtool from $COMMIT"
echo "target: $TARGET"
if [ "$SKIP_SKILL" -eq 0 ]; then
    if [ -f "$SKILL_DIR/manifest.json" ]; then
        echo "skill contract: $SKILL_DIR/manifest.json"
    else
        echo "warning: rDevTool Skill not found at $SKILL_DIR; skipped Skill sync" >&2
    fi
fi
case ":$PATH:" in
    *":$PREFIX/bin:"*) ;;
    *) echo "warning: $PREFIX/bin is not currently on PATH" >&2 ;;
esac
