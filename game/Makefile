# Makefile for the Conway's Game of Life WASM module.
#
# build.sh is the canonical entrypoint: it sources the Emscripten env
# (~/emsdk/emsdk_env.sh) before invoking em++. The default target delegates to
# it so `make` and `./build.sh` are equivalent.

SRC       := src/life.cpp
TEST_SRC  := test/test_life.cpp
DIST      := dist
OUT_JS    := $(DIST)/game.js
OUT_WASM  := $(DIST)/game.wasm

# Native builds (do NOT touch the WASM artifacts).
TEST_BIN  := $(DIST)/test_life
LEGACY_BIN:= $(DIST)/life_test
CXX       ?= clang++
CXXFLAGS  := -std=c++17 -O2

.PHONY: all build test test-legacy clean

all: build

# Canonical WASM build via build.sh (sources the emsdk env).
build:
	./build.sh

# Run the unit test suite (test/test_life.cpp linked against src/life.cpp).
test:
	mkdir -p $(DIST)
	$(CXX) $(CXXFLAGS) $(SRC) $(TEST_SRC) -o $(TEST_BIN)
	$(TEST_BIN)

# Legacy inline test (the old #ifdef LIFE_NATIVE_TEST block in life.cpp).
test-legacy:
	mkdir -p $(DIST)
	$(CXX) $(CXXFLAGS) -DLIFE_NATIVE_TEST $(SRC) -o $(LEGACY_BIN)
	$(LEGACY_BIN)

clean:
	rm -f $(OUT_JS) $(OUT_WASM) $(TEST_BIN) $(LEGACY_BIN)
