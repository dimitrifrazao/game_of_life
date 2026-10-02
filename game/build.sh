#!/usr/bin/env bash
#
# build.sh — canonical build entrypoint for the Game of Life WASM module.
#
# emcc/em++ is NOT on PATH by default, so we source the Emscripten environment
# first, then compile src/life.cpp into dist/game.js + dist/game.wasm as an ES6
# module the React/Vite front end can import.

set -euo pipefail

# Resolve this script's directory so the build works regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate the Emscripten toolchain (puts em++/emcc on PATH).
EMSDK_ENV="${EMSDK_ENV:-$HOME/emsdk/emsdk_env.sh}"
if [ ! -f "$EMSDK_ENV" ]; then
  echo "ERROR: Emscripten env script not found at $EMSDK_ENV" >&2
  echo "       Install emsdk or set EMSDK_ENV to its emsdk_env.sh path." >&2
  exit 1
fi
# emsdk_env.sh references unset vars; relax 'nounset' just for the source.
set +u
# shellcheck disable=SC1090
source "$EMSDK_ENV"
set -u

mkdir -p dist

echo "Building with: $(em++ --version | head -n 1)"

# GROWABLE_ARRAYBUFFERS=0 is required: with the default (1), emscripten backs the
# heap with a *resizable* ArrayBuffer where the browser supports it, and WebGL
# rejects views onto resizable buffers ("texImage2D: The provided ArrayBufferView
# value must not be resizable"). The front end uploads the cell buffer straight
# from WASM memory, so the heap must stay a plain ArrayBuffer.
em++ -std=c++17 -O3 src/life.cpp -o dist/game.js \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createLifeModule \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s GROWABLE_ARRAYBUFFERS=0 \
  -s EXPORTED_FUNCTIONS='["_life_init","_life_resize","_life_cells","_life_width","_life_height","_life_clear","_life_randomize","_life_randomize_ex","_life_step","_life_step_by","_life_mark_dying","_life_toggle","_life_get","_life_set","_life_seed","_life_set_wrap","_life_get_wrap","_life_set_algorithm","_life_get_algorithm","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8"]'

echo "Build complete:"
ls -lh dist/game.js dist/game.wasm
