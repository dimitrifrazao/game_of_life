// =============================================================================
// test_life.cpp — unit tests for the Game of Life C++ core (life.cpp).
//
// Compiled natively (not WASM) via `make test` from game/.
// Zero external dependencies — just C++17, clang++, and stdio.
//
// The test binary links against life.cpp by including it (the extern "C" API is
// available directly). The LIFE_NATIVE_TEST / LIFE_TEST guard in life.cpp is NOT
// used here; instead this file is compiled as a standalone translation unit that
// declares the API via extern "C" forward declarations, and life.cpp is compiled
// separately and linked.
// =============================================================================

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

// ---------- Minimal test framework -------------------------------------------

static int g_tests_run = 0;
static int g_tests_passed = 0;
static int g_tests_failed = 0;
static const char* g_current_test = "";

#define TEST(name)                     \
  do {                                 \
    g_current_test = #name;            \
    g_tests_run++;                     \
    name();                            \
    g_tests_passed++;                  \
  } while (0)

#define ASSERT(cond)                                                          \
  do {                                                                        \
    if (!(cond)) {                                                            \
      std::printf("  FAIL [%s] %s:%d: %s\n", g_current_test, __FILE__,       \
                  __LINE__, #cond);                                           \
      g_tests_failed++;                                                       \
      g_tests_passed--; /* will be re-incremented by TEST macro, cancel it */ \
      return;                                                                 \
    }                                                                         \
  } while (0)

#define ASSERT_EQ(a, b) ASSERT((a) == (b))

// ---------- Forward declarations of the C API --------------------------------

extern "C" {
void life_init(void);
void life_resize(int width, int height);
uint8_t* life_cells(void);
int life_width(void);
int life_height(void);
void life_clear(void);
void life_randomize(void);
void life_randomize_ex(float density, int symmetry, int noise);
void life_step(void);
void life_step_by(int gens);
void life_toggle(int row, int col);
uint32_t life_get(int row, int col);
void life_set(int row, int col, uint8_t v);
void life_seed(uint32_t s);
void life_set_wrap(int enabled);
int life_get_wrap(void);
void life_set_algorithm(int algo);
int life_get_algorithm(void);
}

// ---------- Helper utilities -------------------------------------------------

static void reset(int w = 100, int h = 100) {
  life_set_algorithm(0);
  life_set_wrap(0);
  life_resize(w, h);
}

// ---------- Tests: Conway's rules --------------------------------------------

static void test_block_still_life() {
  reset(10, 10);
  life_set(2, 2, 1); life_set(2, 3, 1);
  life_set(3, 2, 1); life_set(3, 3, 1);
  life_step();
  ASSERT(life_get(2, 2) && life_get(2, 3) &&
         life_get(3, 2) && life_get(3, 3));
  // No other cells should be alive.
  int count = 0;
  for (int r = 0; r < 10; ++r)
    for (int c = 0; c < 10; ++c) count += life_get(r, c) ? 1 : 0;
  ASSERT_EQ(count, 4);
}

static void test_blinker_oscillator() {
  reset(10, 10);
  life_set(5, 4, 1); life_set(5, 5, 1); life_set(5, 6, 1);
  life_step();
  ASSERT(life_get(4, 5) && life_get(5, 5) && life_get(6, 5));
  ASSERT(!life_get(5, 4) && !life_get(5, 6));
  life_step();
  ASSERT(life_get(5, 4) && life_get(5, 5) && life_get(5, 6));
  ASSERT(!life_get(4, 5) && !life_get(6, 5));
}

static void test_underpopulation() {
  reset(10, 10);
  life_set(5, 5, 1); // lone cell, 0 neighbors
  life_step();
  ASSERT_EQ(life_get(5, 5), 0u);
}

static void test_overpopulation() {
  reset(10, 10);
  // center cell with 4 neighbors
  life_set(5, 5, 1);
  life_set(4, 5, 1); life_set(6, 5, 1);
  life_set(5, 4, 1); life_set(5, 6, 1);
  life_step();
  ASSERT_EQ(life_get(5, 5), 0u); // dies
}

static void test_reproduction() {
  reset(10, 10);
  // dead cell at (5,5) with exactly 3 live neighbors
  life_set(4, 5, 1); life_set(5, 4, 1); life_set(5, 6, 1);
  life_step();
  ASSERT(life_get(5, 5) > 0); // born
}

// ---------- Tests: Edge behavior ---------------------------------------------

static void test_dead_borders() {
  reset(10, 10);
  life_set_wrap(0);
  // glider near top-left corner, heading NW — should clip (cells die at edge)
  life_set(1, 1, 1); life_set(1, 2, 1); life_set(1, 3, 1);
  life_set(0, 3, 1); life_set(1, 3, 1);
  for (int i = 0; i < 20; ++i) life_step();
  // After hitting the edge everything dies or stabilizes — shouldn't wrap.
  ASSERT_EQ(life_get(9, 9), 0u);
}

static void test_toroidal_wrap() {
  reset(10, 10);
  life_set_wrap(1);
  // Horizontal blinker straddling cols 9, 0, 1 at row 5.
  life_set(5, 9, 1); life_set(5, 0, 1); life_set(5, 1, 1);
  life_step();
  // Should become vertical at col 0 (wrapping).
  ASSERT(life_get(4, 0) && life_get(5, 0) && life_get(6, 0));
  ASSERT(!life_get(5, 9) && !life_get(5, 1));
}

// ---------- Tests: Age tracking ----------------------------------------------

static void test_age_increment() {
  reset(10, 10);
  life_set(2, 2, 1); life_set(2, 3, 1);
  life_set(3, 2, 1); life_set(3, 3, 1);
  ASSERT_EQ(life_get(2, 2), 1u);
  life_step();
  ASSERT_EQ(life_get(2, 2), 2u);
  life_step();
  ASSERT_EQ(life_get(2, 2), 3u);
}

static void test_age_reset_on_retoggle() {
  reset(10, 10);
  life_set(2, 2, 1); life_set(2, 3, 1);
  life_set(3, 2, 1); life_set(3, 3, 1);
  life_step(); life_step(); // age = 3
  life_toggle(2, 2); // off
  ASSERT_EQ(life_get(2, 2), 0u);
  life_toggle(2, 2); // back on
  ASSERT_EQ(life_get(2, 2), 1u); // reset
}

static void test_newborn_starts_at_1() {
  reset(10, 10);
  life_set(4, 5, 1); life_set(5, 4, 1); life_set(5, 6, 1);
  life_step();
  ASSERT_EQ(life_get(5, 5), 1u); // newborn = age 1
}

// ---------- Tests: Hashlife --------------------------------------------------

static void test_hashlife_glider() {
  life_set_algorithm(1); // hashlife
  life_resize(60, 60);
  life_clear();
  // Standard glider away from edges.
  life_set(10, 11, 1); life_set(11, 12, 1);
  life_set(12, 10, 1); life_set(12, 11, 1); life_set(12, 12, 1);
  for (int i = 0; i < 4; ++i) life_step();
  // Shifted by (+1,+1) after 4 gens.
  ASSERT(life_get(11, 12) && life_get(12, 13) &&
         life_get(13, 11) && life_get(13, 12) && life_get(13, 13));
}

static void test_hashlife_matches_naive_interior() {
  const int W = 60, H = 60, steps = 12, margin = steps + 1;
  life_resize(W, H);
  life_set_wrap(0);
  for (int seed = 1; seed <= 3; ++seed) {
    life_seed(static_cast<uint32_t>(seed));
    life_randomize();
    std::vector<uint32_t> initial(
        reinterpret_cast<uint32_t*>(life_cells()),
        reinterpret_cast<uint32_t*>(life_cells()) + W * H);

    // Run naive.
    life_set_algorithm(0);
    std::memcpy(life_cells(), initial.data(), initial.size() * 4);
    life_set_algorithm(0); // marks dirty on switch back from hl
    for (int i = 0; i < steps; ++i) life_step();
    std::vector<uint32_t> naive(
        reinterpret_cast<uint32_t*>(life_cells()),
        reinterpret_cast<uint32_t*>(life_cells()) + W * H);

    // Run hashlife.
    life_set_algorithm(1);
    std::memcpy(life_cells(), initial.data(), initial.size() * 4);
    life_set_algorithm(1); // dirty after memcpy
    for (int i = 0; i < steps; ++i) life_step();

    auto* hl = reinterpret_cast<uint32_t*>(life_cells());
    for (int r = margin; r < H - margin; ++r)
      for (int c = margin; c < W - margin; ++c)
        ASSERT_EQ((naive[r * W + c] != 0), (hl[r * W + c] != 0));
  }
}

static void test_hashlife_fast_forward() {
  const int W = 64, H = 64, N = 16, margin = N + 1;
  life_resize(W, H);
  life_set_wrap(0);
  life_seed(4242);
  life_randomize();
  std::vector<uint32_t> initial(
      reinterpret_cast<uint32_t*>(life_cells()),
      reinterpret_cast<uint32_t*>(life_cells()) + W * H);

  // N single steps.
  life_set_algorithm(1);
  std::memcpy(life_cells(), initial.data(), initial.size() * 4);
  life_set_algorithm(1); // re-set to dirty the cache after memcpy
  for (int i = 0; i < N; ++i) life_step();
  std::vector<uint32_t> singles(
      reinterpret_cast<uint32_t*>(life_cells()),
      reinterpret_cast<uint32_t*>(life_cells()) + W * H);

  // One fast-forward of N.
  std::memcpy(life_cells(), initial.data(), initial.size() * 4);
  life_set_algorithm(1); // dirty again
  life_step_by(N);
  auto* jumped = reinterpret_cast<uint32_t*>(life_cells());
  for (int r = margin; r < H - margin; ++r)
    for (int c = margin; c < W - margin; ++c)
      ASSERT_EQ((singles[r * W + c] != 0), (jumped[r * W + c] != 0));
}

// ---------- Tests: Randomize -------------------------------------------------

static void test_randomize_reproducible() {
  reset(50, 50);
  life_seed(777);
  life_randomize();
  std::vector<uint32_t> snap1(
      reinterpret_cast<uint32_t*>(life_cells()),
      reinterpret_cast<uint32_t*>(life_cells()) + 50 * 50);
  life_seed(777);
  life_randomize();
  auto* buf = reinterpret_cast<uint32_t*>(life_cells());
  for (int i = 0; i < 50 * 50; ++i)
    ASSERT_EQ(snap1[i], buf[i]);
}

static void test_symmetry_mirror_both() {
  reset(50, 40);
  life_seed(7);
  life_randomize_ex(0.5f, 3 /*SYM_MIRROR_BOTH*/, 0);
  for (int r = 0; r < 40; ++r)
    for (int c = 0; c < 50; ++c) {
      ASSERT_EQ((life_get(r, c) != 0), (life_get(r, 49 - c) != 0));
      ASSERT_EQ((life_get(r, c) != 0), (life_get(39 - r, c) != 0));
    }
}

static void test_noise_determinism() {
  reset(30, 30);
  life_seed(42);
  life_randomize_ex(0.4f, 0, 2 /*NOISE_FRACTAL*/);
  std::vector<uint32_t> snap(
      reinterpret_cast<uint32_t*>(life_cells()),
      reinterpret_cast<uint32_t*>(life_cells()) + 30 * 30);
  life_seed(42);
  life_randomize_ex(0.4f, 0, 2);
  auto* buf = reinterpret_cast<uint32_t*>(life_cells());
  for (int i = 0; i < 30 * 30; ++i)
    ASSERT_EQ(snap[i], buf[i]);
}

// ---------- Tests: Resize ----------------------------------------------------

static void test_resize_clamps() {
  life_resize(0, 5000);
  ASSERT_EQ(life_width(), 1);
  ASSERT_EQ(life_height(), 1000);
}

static void test_resize_clears() {
  reset(10, 10);
  life_set(5, 5, 1);
  life_resize(20, 20);
  ASSERT_EQ(life_get(5, 5), 0u);
}

static void test_pointer_stable_across_resize() {
  uint8_t* p1 = life_cells();
  life_resize(100, 100);
  uint8_t* p2 = life_cells();
  ASSERT_EQ(p1, p2);
}

// ---------- Tests: Bounds checks ---------------------------------------------

static void test_out_of_range_get() {
  reset(10, 10);
  ASSERT_EQ(life_get(-1, 0), 0u);
  ASSERT_EQ(life_get(0, 10), 0u);
  ASSERT_EQ(life_get(10, 0), 0u);
}

static void test_toggle_out_of_range_no_crash() {
  reset(10, 10);
  life_toggle(-1, 0);
  life_toggle(0, 10);
  // No crash = pass.
}

// ---------- Main -------------------------------------------------------------

int main() {
  std::printf("Running unit tests for life.cpp...\n\n");

  TEST(test_block_still_life);
  TEST(test_blinker_oscillator);
  TEST(test_underpopulation);
  TEST(test_overpopulation);
  TEST(test_reproduction);

  TEST(test_dead_borders);
  TEST(test_toroidal_wrap);

  TEST(test_age_increment);
  TEST(test_age_reset_on_retoggle);
  TEST(test_newborn_starts_at_1);

  TEST(test_hashlife_glider);
  TEST(test_hashlife_matches_naive_interior);
  TEST(test_hashlife_fast_forward);

  TEST(test_randomize_reproducible);
  TEST(test_symmetry_mirror_both);
  TEST(test_noise_determinism);

  TEST(test_resize_clamps);
  TEST(test_resize_clears);
  TEST(test_pointer_stable_across_resize);

  TEST(test_out_of_range_get);
  TEST(test_toggle_out_of_range_no_crash);

  std::printf("\n%d tests run, %d passed, %d failed.\n",
              g_tests_run, g_tests_passed, g_tests_failed);
  return g_tests_failed > 0 ? 1 : 0;
}
