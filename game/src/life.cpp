// life.cpp — Conway's Game of Life core logic compiled to WebAssembly.
//
// Grid: resizable at runtime, from 1x1 up to MAX_DIM x MAX_DIM (1000x1000).
// Default is 100x100. Cells are stored as a 32-bit AGE per cell:
//   age == 0      -> dead/off
//   age >= 1      -> alive/on, value is the number of generations the cell has
//                    been continuously alive (capped at MAX_AGE = 1,000,000).
// A newborn cell starts at age 1; each generation a surviving cell's age += 1.
// Turning a cell off then on again resets its age to 1. Layout is row-major with
// stride = current width (index = row * g_width + col).
//
// Two stepping ALGORITHMS are available, selectable at runtime via
// life_set_algorithm():
//   0 = BRUTE FORCE — scan every cell each generation (default). Supports
//       toroidal wraparound (life_set_wrap).
//   1 = HASHLIFE    — Gosper's hashed quadtree with a memoized 1-generation
//       successor. Operates on an (effectively) infinite plane, so it does NOT
//       wrap; results match brute force with wraparound OFF. Cells that leave
//       the visible WxH window are clipped (dead borders), matching the bounded
//       brute-force behavior.
//
// The age buffer (g_front) is the single source of truth for state and
// rendering. Age is maintained at the buffer level, so it works identically for
// both algorithms.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <deque>
#include <random>
#include <unordered_map>

namespace {

constexpr int MAX_DIM = 1000;
constexpr int MIN_DIM = 1;
constexpr int MAX_CELLS = MAX_DIM * MAX_DIM;       // 1,000,000
constexpr uint32_t MAX_AGE = 1000000u;             // cap a cell's age at 1e6

// Bit 31 is the "dying" flag: set by life_mark_dying() to indicate a cell is
// alive now but will die next generation. The age is in the lower 31 bits.
constexpr uint32_t DYING_BIT = 0x80000000u;
constexpr uint32_t AGE_MASK  = 0x7FFFFFFFu;

enum Algorithm { ALGO_BRUTE = 0, ALGO_HASHLIFE = 1 };

// Current grid dimensions (default 50x50).
int g_width = 50;
int g_height = 50;

// Max-sized age buffers. `g_front` is the stable, publicly visible buffer whose
// address is returned by life_cells(). `g_back` is scratch for stepping.
uint32_t g_front[MAX_CELLS];
uint32_t g_back[MAX_CELLS];

// PRNG used by life_randomize(). Seeded deterministically by default so test
// runs are reproducible; life_seed() lets callers pick an explicit seed.
std::mt19937 g_rng{0xC0FFEEu};

// When true, the grid is toroidal (brute force only). Defaults to ON.
bool g_wrap = true;

// Selected stepping algorithm. Defaults to brute force.
int g_algorithm = ALGO_BRUTE;

inline int clamp_dim(int v) {
    if (v < MIN_DIM) return MIN_DIM;
    if (v > MAX_DIM) return MAX_DIM;
    return v;
}

inline bool in_bounds(int row, int col) {
    return row >= 0 && row < g_height && col >= 0 && col < g_width;
}

inline int idx(int row, int col) {
    return row * g_width + col;
}

inline int cell_count() {
    return g_width * g_height;
}

// Apply the next-generation age update for one cell, given whether it is alive
// next gen and its current age. Shared by both algorithms.
inline uint32_t next_age(bool alive_next, uint32_t cur_age) {
    if (!alive_next) return 0u;
    if (cur_age == 0u) return 1u;                  // newborn
    return cur_age < MAX_AGE ? cur_age + 1u : MAX_AGE;
}

// =============================================================================
// Brute-force engine
// =============================================================================

// Count live neighbors of (row, col). With wraparound disabled, out-of-grid
// neighbors count as dead; with it enabled, coordinates wrap (toroidal).
inline int live_neighbors(const uint32_t* cells, int row, int col) {
    int count = 0;
    for (int dr = -1; dr <= 1; ++dr) {
        for (int dc = -1; dc <= 1; ++dc) {
            if (dr == 0 && dc == 0) continue;
            int nr = row + dr;
            int nc = col + dc;
            if (g_wrap) {
                nr = (nr + g_height) % g_height;
                nc = (nc + g_width) % g_width;
                if ((cells[idx(nr, nc)] & AGE_MASK) != 0u) ++count;
            } else if (in_bounds(nr, nc) && (cells[idx(nr, nc)] & AGE_MASK) != 0u) {
                ++count;
            }
        }
    }
    return count;
}

void brute_step() {
    for (int row = 0; row < g_height; ++row) {
        for (int col = 0; col < g_width; ++col) {
            uint32_t raw = g_front[idx(row, col)];
            uint32_t age = raw & AGE_MASK;  // strip the dying bit before stepping
            int n = live_neighbors(g_front, row, col);
            bool alive_next = age != 0u ? (n == 2 || n == 3) : (n == 3);
            g_back[idx(row, col)] = next_age(alive_next, age);
        }
    }
    std::memcpy(g_front, g_back,
                static_cast<size_t>(cell_count()) * sizeof(uint32_t));
}

// =============================================================================
// Hashlife engine (Gosper's hashed quadtree, 1-generation memoized successor)
// =============================================================================
namespace hl {

struct Node {
    Node* nw;
    Node* ne;
    Node* sw;
    Node* se;
    int level;          // 0 = leaf (1x1); side length = 2^level
    uint64_t pop;       // live population
    Node* result;       // memoized successor (center advanced 1 gen), level-1
};

// Leaf singletons live outside the pool so clearing the cache keeps them valid.
Node ON_LEAF{nullptr, nullptr, nullptr, nullptr, 0, 1, nullptr};
Node OFF_LEAF{nullptr, nullptr, nullptr, nullptr, 0, 0, nullptr};

using Key = std::array<Node*, 4>;
struct KeyHash {
    size_t operator()(const Key& k) const {
        size_t h = 1469598103934665603ull;  // FNV-ish mix of the 4 pointers
        for (Node* p : k) {
            h ^= reinterpret_cast<size_t>(p);
            h *= 1099511628211ull;
        }
        return h;
    }
};

// Key for the memoized successor: a node plus the speed exponent j (advance
// 2^j generations).
struct SKey {
    Node* n;
    int j;
    bool operator==(const SKey& o) const { return n == o.n && j == o.j; }
};
struct SKeyHash {
    size_t operator()(const SKey& k) const {
        return (reinterpret_cast<size_t>(k.n) >> 4) * 1099511628211ull +
               static_cast<size_t>(k.j);
    }
};

std::deque<Node> g_pool;                                   // owns interior nodes
std::unordered_map<Key, Node*, KeyHash> g_canon;           // canonicalization
std::unordered_map<int, Node*> g_empty;                    // empty node per level
std::unordered_map<SKey, Node*, SKeyHash> g_succ;          // memoized successors

// Cap on distinct nodes before we drop the cache to bound memory (~tens of MB).
constexpr size_t HL_NODE_LIMIT = 1500000;

// Persistent universe (Option A): the quadtree root survives across steps so we
// don't rebuild it every generation. (g_root_ox, g_root_oy) is the world
// coordinate of the root's top-left cell (the visible grid lives at world
// [0,g_width) x [0,g_height)). g_dirty forces a rebuild from the age buffer on
// the next step (set after any mutation: draw, clear, randomize, resize, or an
// algorithm switch). The universe is an infinite plane: cells that leave the
// visible window keep evolving off-screen and do NOT wrap. Offsets are 64-bit so
// large fast-forward supersteps (which expand the root a lot) don't overflow.
Node* g_root = nullptr;
long long g_root_ox = 0;
long long g_root_oy = 0;
bool g_dirty = true;

inline void mark_dirty() { g_dirty = true; }

void hl_reset() {
    g_canon.clear();
    g_pool.clear();
    g_empty.clear();
    g_succ.clear();
    g_root = nullptr;
    g_dirty = true;
}

inline Node* leaf(int alive) { return alive ? &ON_LEAF : &OFF_LEAF; }

// Canonical interior node from four equal-level children.
Node* join(Node* nw, Node* ne, Node* sw, Node* se) {
    Key key{nw, ne, sw, se};
    auto it = g_canon.find(key);
    if (it != g_canon.end()) return it->second;
    g_pool.push_back(Node{nw, ne, sw, se, nw->level + 1,
                          nw->pop + ne->pop + sw->pop + se->pop, nullptr});
    Node* n = &g_pool.back();
    g_canon.emplace(key, n);
    return n;
}

Node* empty_tree(int level) {
    if (level == 0) return &OFF_LEAF;
    auto it = g_empty.find(level);
    if (it != g_empty.end()) return it->second;
    Node* e = empty_tree(level - 1);
    Node* n = join(e, e, e, e);
    g_empty[level] = n;
    return n;
}

// Build a node of the given level covering grid coords [x0, x0+2^level) ×
// [y0, y0+2^level) from the current age buffer (alive = age > 0).
Node* build(int level, long x0, long y0) {
    // Whole region lies past the right/bottom edge of the grid -> empty.
    if (x0 >= g_width || y0 >= g_height) return empty_tree(level);
    if (level == 0) {
        bool alive = x0 >= 0 && y0 >= 0 && x0 < g_width && y0 < g_height &&
                     g_front[y0 * g_width + x0] != 0u;
        return leaf(alive ? 1 : 0);
    }
    long half = 1L << (level - 1);
    return join(build(level - 1, x0, y0),
                build(level - 1, x0 + half, y0),
                build(level - 1, x0, y0 + half),
                build(level - 1, x0 + half, y0 + half));
}

// One cell (0/1) of a level-2 (4x4) node at local (x, y), x,y in [0,4).
inline int cell2(Node* m, int x, int y) {
    Node* q = (x < 2) ? ((y < 2) ? m->nw : m->sw) : ((y < 2) ? m->ne : m->se);
    int lx = x & 1, ly = y & 1;
    Node* lf = lx ? (ly ? q->se : q->ne) : (ly ? q->sw : q->nw);
    return static_cast<int>(lf->pop);
}

// Base case: advance the center 2x2 of a 4x4 node by exactly one generation.
Node* life_base(Node* m) {
    int g[4][4];
    for (int y = 0; y < 4; ++y)
        for (int x = 0; x < 4; ++x) g[y][x] = cell2(m, x, y);

    auto rule = [&](int x, int y) -> int {
        int n = 0;
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                if (dx == 0 && dy == 0) continue;
                int nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < 4 && ny >= 0 && ny < 4) n += g[ny][nx];
            }
        int a = g[y][x];
        return ((a && (n == 2 || n == 3)) || (!a && n == 3)) ? 1 : 0;
    };

    return join(leaf(rule(1, 1)), leaf(rule(2, 1)),
                leaf(rule(1, 2)), leaf(rule(2, 2)));
}

// Successor: the center 2^(k-1) region of `m` advanced exactly 2^j generations
// (result is level k-1). Requires m->level (=k) >= 2 and 0 <= j <= k-2.
// Memoized per (node, j). With j = k-2 it advances at full Hashlife speed
// (2^(k-2) generations in one cached lookup); with j < k-2 it advances 2^j by
// recursing at the lower speed and combining the centers (no extra stepping).
Node* successor(Node* m, int j) {
    if (m->pop == 0) return empty_tree(m->level - 1);  // empty stays empty
    if (m->level == 2) return life_base(m);            // base: 2^0 = 1 gen
    if (j < 0) j = 0;
    if (j > m->level - 2) j = m->level - 2;

    SKey key{m, j};
    auto it = g_succ.find(key);
    if (it != g_succ.end()) return it->second;

    Node* A = m->nw;
    Node* B = m->ne;
    Node* C = m->sw;
    Node* D = m->se;
    // 3x3 grid of half-overlapping sub-squares (each level k-1 of m).
    Node* n00 = A;
    Node* n01 = join(A->ne, B->nw, A->se, B->sw);
    Node* n02 = B;
    Node* n10 = join(A->sw, A->se, C->nw, C->ne);
    Node* n11 = join(A->se, B->sw, C->ne, D->nw);
    Node* n12 = join(B->sw, B->se, D->nw, D->ne);
    Node* n20 = C;
    Node* n21 = join(C->ne, D->nw, C->se, D->sw);
    Node* n22 = D;

    Node* res;
    if (j == m->level - 2) {
        // Full speed: advance the 9 sub-squares by 2^(j-1), then advance the
        // four assembled quadrants by another 2^(j-1) -> total 2^j.
        Node* r00 = successor(n00, j - 1);
        Node* r01 = successor(n01, j - 1);
        Node* r02 = successor(n02, j - 1);
        Node* r10 = successor(n10, j - 1);
        Node* r11 = successor(n11, j - 1);
        Node* r12 = successor(n12, j - 1);
        Node* r20 = successor(n20, j - 1);
        Node* r21 = successor(n21, j - 1);
        Node* r22 = successor(n22, j - 1);
        Node* rnw = successor(join(r00, r01, r10, r11), j - 1);
        Node* rne = successor(join(r01, r02, r11, r12), j - 1);
        Node* rsw = successor(join(r10, r11, r20, r21), j - 1);
        Node* rse = successor(join(r11, r12, r21, r22), j - 1);
        res = join(rnw, rne, rsw, rse);
    } else {
        // Reduced speed: advance the 9 sub-squares by 2^j, then just take the
        // overlapping centers (no further stepping) -> total 2^j.
        Node* r00 = successor(n00, j);
        Node* r01 = successor(n01, j);
        Node* r02 = successor(n02, j);
        Node* r10 = successor(n10, j);
        Node* r11 = successor(n11, j);
        Node* r12 = successor(n12, j);
        Node* r20 = successor(n20, j);
        Node* r21 = successor(n21, j);
        Node* r22 = successor(n22, j);
        Node* rnw = join(r00->se, r01->sw, r10->ne, r11->nw);
        Node* rne = join(r01->se, r02->sw, r11->ne, r12->nw);
        Node* rsw = join(r10->se, r11->sw, r20->ne, r21->nw);
        Node* rse = join(r11->se, r12->sw, r21->ne, r22->nw);
        res = join(rnw, rne, rsw, rse);
    }
    g_succ.emplace(key, res);
    return res;
}

// True if `m` (level >= 3) has an empty border ring of width 2^(level-2), i.e.
// all population sits in the central region — safe to take the successor.
bool is_padded(Node* m) {
    if (m->level < 3) return false;
    return m->nw->pop == m->nw->se->se->pop &&
           m->ne->pop == m->ne->sw->sw->pop &&
           m->sw->pop == m->sw->ne->ne->pop &&
           m->se->pop == m->se->nw->nw->pop;
}

// Wrap `m` in a larger node so it sits centered with an empty border.
Node* expand(Node* m) {
    Node* e = empty_tree(m->level - 1);
    return join(join(e, e, e, m->nw),
                join(e, e, m->ne, e),
                join(e, m->sw, e, e),
                join(m->se, e, e, e));
}

// Read one cell (0/1) at local (x, y) within node `n` (x,y in [0, 2^level)).
uint8_t get_cell(Node* n, long long x, long long y) {
    while (n->level > 0) {
        long long half = 1LL << (n->level - 1);
        if (x < half) {
            if (y < half) {
                n = n->nw;
            } else {
                n = n->sw;
                y -= half;
            }
        } else {
            x -= half;
            if (y < half) {
                n = n->ne;
            } else {
                n = n->se;
                y -= half;
            }
        }
    }
    return static_cast<uint8_t>(n->pop);
}

// Advance the visible grid by `gens` generations using Hashlife, updating ages.
// Option A: the root persists across steps (rebuilt only when the buffer was
// mutated). The universe is an infinite plane — cells that leave the visible
// window keep evolving off-screen and never wrap.
//
// Fast-forward: `gens` is decomposed into powers of two; for each set bit s we
// take one superstep of 2^s generations via successor(root, s). Because each
// node's 2^s-generation future is memoized and shared, advancing by huge `gens`
// on repetitive/structured patterns is near-instant (this is Hashlife's real
// advantage — every intermediate generation is computed exactly, just not
// rendered).
void advance(int gens) {
    if (gens <= 0) return;

    // Drop the cache if it grew too large; this also forces a rebuild.
    if (g_pool.size() > HL_NODE_LIMIT) hl_reset();

    // (Re)build the persistent root from the age buffer only when needed.
    if (g_dirty || g_root == nullptr) {
        int K = 2;
        while ((1L << K) < g_width || (1L << K) < g_height) ++K;
        g_root = build(K, 0, 0);
        g_root_ox = 0;
        g_root_oy = 0;
        g_dirty = false;
    }

    // One power-of-two superstep per set bit of `gens`.
    for (int s = 0; s <= 30; ++s) {
        if (((gens >> s) & 1) == 0) continue;
        // Pad so the root can step 2^s gens (level >= s+2) with an empty border.
        while (g_root->level < s + 2 || !is_padded(g_root)) {
            long long shift = 1LL << (g_root->level - 1);
            g_root = expand(g_root);
            g_root_ox -= shift;
            g_root_oy -= shift;
        }
        long long rshift = 1LL << (g_root->level - 2);
        Node* res = successor(g_root, s);        // center advanced 2^s gens
        g_root = res;                            // level = root.level - 1
        g_root_ox += rshift;                     // world coords of res top-left
        g_root_oy += rshift;
    }

    // Read the visible window [0,w) x [0,h) back into the age buffer. Survivors'
    // ages advance by `gens` (an approximation when gens > 1, since intermediate
    // generations are not materialized); cells newly alive get age 1.
    long long rsize = 1LL << g_root->level;
    for (int r = 0; r < g_height; ++r) {
        for (int c = 0; c < g_width; ++c) {
            long long lx = c - g_root_ox, ly = r - g_root_oy;
            uint8_t alive = (lx >= 0 && ly >= 0 && lx < rsize && ly < rsize)
                                ? get_cell(g_root, lx, ly)
                                : 0;
            uint32_t cur = g_front[r * g_width + c];
            uint32_t next;
            if (!alive) {
                next = 0u;
            } else if (cur == 0u) {
                next = 1u;
            } else {
                uint64_t a = static_cast<uint64_t>(cur) + static_cast<uint64_t>(gens);
                next = a < MAX_AGE ? static_cast<uint32_t>(a) : MAX_AGE;
            }
            g_back[r * g_width + c] = next;
        }
    }
    std::memcpy(g_front, g_back,
                static_cast<size_t>(cell_count()) * sizeof(uint32_t));
}

}  // namespace hl

// =============================================================================
// World generation: density, symmetry, and noise fields for life_randomize_ex.
// =============================================================================
namespace gen {

enum Symmetry {
    SYM_NONE = 0,
    SYM_MIRROR_X = 1,   // left-right mirror
    SYM_MIRROR_Y = 2,   // top-bottom mirror
    SYM_MIRROR_BOTH = 3,  // both mirrors (D2)
    SYM_ROT2 = 4,       // 180° rotation (C2)
    SYM_ROT4 = 5,       // 90° rotation (C4; best on square grids)
    SYM_FULL = 6        // 8-fold dihedral (D4; best on square grids)
};

enum Noise {
    NOISE_NONE = 0,     // white noise (independent per cell)
    NOISE_VALUE = 1,    // smooth value noise (blobs)
    NOISE_FRACTAL = 2,  // fractal Brownian motion (organic detail)
    NOISE_CELLULAR = 3  // Worley/cellular (clustered cells)
};

// Number of noise features across the larger grid axis (blob scale).
constexpr float NOISE_FEATURES = 12.0f;

inline uint32_t hashu(uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352dU;
    x ^= x >> 15;
    x *= 0x846ca68bU;
    x ^= x >> 16;
    return x;
}

inline uint32_t hash2(int xi, int yi, uint32_t seed) {
    return hashu(static_cast<uint32_t>(xi) * 73856093u ^
                 static_cast<uint32_t>(yi) * 19349663u ^ seed * 2654435761u);
}

inline float rand01(int xi, int yi, uint32_t seed) {
    return (hash2(xi, yi, seed) & 0xFFFFFFu) / static_cast<float>(0x1000000);
}

inline float smoothf(float t) { return t * t * (3.0f - 2.0f * t); }
inline float lerpf(float a, float b, float t) { return a + (b - a) * t; }

float value_noise(float x, float y, uint32_t seed) {
    int x0 = static_cast<int>(std::floor(x));
    int y0 = static_cast<int>(std::floor(y));
    float fx = x - x0, fy = y - y0;
    float v00 = rand01(x0, y0, seed), v10 = rand01(x0 + 1, y0, seed);
    float v01 = rand01(x0, y0 + 1, seed), v11 = rand01(x0 + 1, y0 + 1, seed);
    float sx = smoothf(fx), sy = smoothf(fy);
    return lerpf(lerpf(v00, v10, sx), lerpf(v01, v11, sx), sy);
}

float fbm(float x, float y, uint32_t seed) {
    float total = 0.0f, amp = 0.5f, freq = 1.0f, norm = 0.0f;
    for (int o = 0; o < 4; ++o) {
        total += amp * value_noise(x * freq, y * freq, seed + o * 131u);
        norm += amp;
        freq *= 2.0f;
        amp *= 0.5f;
    }
    return total / norm;
}

float worley_f1(float x, float y, uint32_t seed) {
    int xi = static_cast<int>(std::floor(x));
    int yi = static_cast<int>(std::floor(y));
    float best = 1e9f;
    for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
            int cx = xi + dx, cy = yi + dy;
            float px = cx + rand01(cx, cy, seed);
            float py = cy + rand01(cx, cy, seed + 97u);
            float ddx = px - x, ddy = py - y;
            float d = std::sqrt(ddx * ddx + ddy * ddy);
            if (d < best) best = d;
        }
    }
    return best;  // typically ~0..1.2
}

// Map (row,col) to its canonical orbit representative under the symmetry group
// (the lexicographically smallest in-grid transform). Cells sharing a
// representative get the same value, which enforces the symmetry exactly.
void representative(int r, int c, int sym, int& rr, int& cc) {
    const int W = g_width, H = g_height;
    int br = r, bc = c;
    auto consider = [&](int tr, int tc) {
        if (tr < 0 || tr >= H || tc < 0 || tc >= W) return;
        if (tr < br || (tr == br && tc < bc)) {
            br = tr;
            bc = tc;
        }
    };
    switch (sym) {
        case SYM_MIRROR_X:
            consider(r, W - 1 - c);
            break;
        case SYM_MIRROR_Y:
            consider(H - 1 - r, c);
            break;
        case SYM_MIRROR_BOTH:
            consider(r, W - 1 - c);
            consider(H - 1 - r, c);
            consider(H - 1 - r, W - 1 - c);
            break;
        case SYM_ROT2:
            consider(H - 1 - r, W - 1 - c);
            break;
        case SYM_ROT4:
            consider(c, H - 1 - r);
            consider(H - 1 - r, W - 1 - c);
            consider(W - 1 - c, r);
            break;
        case SYM_FULL:
            consider(r, W - 1 - c);
            consider(H - 1 - r, c);
            consider(H - 1 - r, W - 1 - c);
            consider(c, H - 1 - r);
            consider(W - 1 - c, r);
            consider(c, r);
            consider(W - 1 - c, H - 1 - r);
            break;
        default:
            break;  // SYM_NONE
    }
    rr = br;
    cc = bc;
}

// Decide whether the cell at its representative coords is alive, given density,
// the noise field, and the per-run seed.
bool alive_at(int r, int c, float density, int noise, uint32_t seed) {
    if (density <= 0.0f) return false;
    if (density >= 1.0f) return true;
    const float scale = NOISE_FEATURES / static_cast<float>(std::max(g_width, g_height));
    switch (noise) {
        case NOISE_VALUE:
            return value_noise(c * scale, r * scale, seed) > (1.0f - density);
        case NOISE_FRACTAL:
            return fbm(c * scale, r * scale, seed) > (1.0f - density);
        case NOISE_CELLULAR:
            return worley_f1(c * scale, r * scale, seed) < density;
        case NOISE_NONE:
        default:
            return rand01(c, r, seed) < density;  // exact fraction = density
    }
}

}  // namespace gen

}  // namespace

extern "C" {

// Clear all state (zeroes the full max buffer so no stale ages linger if the
// grid later grows). Also drops the Hashlife cache.
void life_init(void) {
    std::memset(g_front, 0, sizeof(g_front));
    std::memset(g_back, 0, sizeof(g_back));
    hl::hl_reset();
}

// Resize the world. Width/height are clamped to [1, 1000]. The grid is cleared
// on resize. The life_cells() pointer is unchanged (buffers are max-sized).
void life_resize(int width, int height) {
    g_width = clamp_dim(width);
    g_height = clamp_dim(height);
    life_init();
}

// Pointer to the stable cell buffer (uint32 age per cell, row-major).
uint8_t* life_cells(void) {
    return reinterpret_cast<uint8_t*>(g_front);
}

int life_width(void) { return g_width; }
int life_height(void) { return g_height; }

// Set all cells to dead (age 0).
void life_clear(void) {
    std::memset(g_front, 0, static_cast<size_t>(cell_count()) * sizeof(uint32_t));
    hl::mark_dirty();
}

// Fill the grid with a random world. `density` is the live-cell probability
// (0..1). `symmetry` imposes a symmetry group (see gen::Symmetry). `noise`
// selects the spatial field (see gen::Noise; 0 = white noise). Reproducible:
// each call draws a fresh run-seed from the PRNG, so re-seeding (life_seed)
// then randomizing reproduces the same world.
void life_randomize_ex(float density, int symmetry, int noise) {
    life_clear();
    if (density < 0.0f) density = 0.0f;
    if (density > 1.0f) density = 1.0f;
    const uint32_t run_seed = static_cast<uint32_t>(g_rng());
    for (int r = 0; r < g_height; ++r) {
        for (int c = 0; c < g_width; ++c) {
            int rr, cc;
            gen::representative(r, c, symmetry, rr, cc);
            g_front[idx(r, c)] = gen::alive_at(rr, cc, density, noise, run_seed)
                                     ? 1u
                                     : 0u;
        }
    }
    hl::mark_dirty();
}

// Clear, then turn on each cell with probability 0.5 (white noise, no symmetry).
void life_randomize(void) {
    life_randomize_ex(0.5f, 0, 0);
}

// Advance the grid by `gens` generations using the selected algorithm.
// Hashlife uses memoized power-of-two supersteps (fast-forward); brute force
// runs `gens` sequential scans.
void life_step_by(int gens) {
    if (gens <= 0) gens = 1;
    if (g_algorithm == ALGO_HASHLIFE) {
        hl::advance(gens);
    } else {
        for (int i = 0; i < gens; ++i) brute_step();
    }
}

// Advance exactly one generation using the selected algorithm.
void life_step(void) { life_step_by(1); }

// Mark cells that are alive now but will die next generation by setting bit 31
// (DYING_BIT) in their age value. Call this AFTER life_step/life_step_by if you
// want to visualize dying cells. The flag is stripped at the start of the next
// step, so it's purely a display hint. Cost: one O(W*H) neighbor-count pass.
void life_mark_dying(void) {
    const int n_cells = cell_count();
    for (int row = 0; row < g_height; ++row) {
        for (int col = 0; col < g_width; ++col) {
            uint32_t raw = g_front[idx(row, col)];
            uint32_t age = raw & AGE_MASK;
            if (age == 0u) continue; // dead cells can't "die"
            int n = live_neighbors(g_front, row, col);
            if (n < 2 || n > 3) {
                g_front[idx(row, col)] = age | DYING_BIT;
            }
        }
    }
    (void)n_cells; // suppress unused warning
}

// Flip a single cell (on => age 1, off => age 0). Out-of-range is a no-op.
void life_toggle(int row, int col) {
    if (!in_bounds(row, col)) return;
    uint32_t& cell = g_front[idx(row, col)];
    cell = cell ? 0u : 1u;
    hl::mark_dirty();
}

// Read a single cell's age (0 = dead). Out-of-range returns 0.
uint32_t life_get(int row, int col) {
    if (!in_bounds(row, col)) return 0u;
    return g_front[idx(row, col)];
}

// Set a single cell. Non-zero turns it on at age 1; zero turns it off.
void life_set(int row, int col, uint8_t v) {
    if (!in_bounds(row, col)) return;
    g_front[idx(row, col)] = v ? 1u : 0u;
    hl::mark_dirty();
}

// Seed the PRNG for reproducible randomize().
void life_seed(uint32_t s) { g_rng.seed(s); }

// Enable (non-zero) or disable (0) toroidal wraparound (brute force only).
void life_set_wrap(int enabled) { g_wrap = enabled != 0; }
int life_get_wrap(void) { return g_wrap ? 1 : 0; }

// Select the stepping algorithm: 0 = brute force, 1 = hashlife.
void life_set_algorithm(int algo) {
    g_algorithm = (algo == ALGO_HASHLIFE) ? ALGO_HASHLIFE : ALGO_BRUTE;
    // Switching to hashlife must rebuild the persistent root from the current
    // buffer on the next step.
    if (g_algorithm == ALGO_HASHLIFE) hl::mark_dirty();
}
int life_get_algorithm(void) { return g_algorithm; }

}  // extern "C"

#ifdef LIFE_NATIVE_TEST
// Tiny native self-check (NOT compiled into the WASM build).
#include <cstdio>
#include <vector>

namespace {

// Run `steps` generations with the given algorithm starting from `initial`,
// returning the resulting buffer. Assumes grid already sized to match initial.
std::vector<uint32_t> run(int algo, const std::vector<uint32_t>& initial,
                          int steps) {
    life_set_algorithm(algo);  // marks hashlife dirty so it rebuilds from buffer
    std::memcpy(g_front, initial.data(), initial.size() * sizeof(uint32_t));
    hl::mark_dirty();
    for (int i = 0; i < steps; ++i) life_step();
    return std::vector<uint32_t>(g_front, g_front + initial.size());
}

}  // namespace

int main() {
    int failures = 0;
    life_set_wrap(0);

    // --- Brute-force sanity: blinker oscillator -----------------------------
    life_set_algorithm(ALGO_BRUTE);
    life_resize(100, 100);
    life_set(50, 49, 1);
    life_set(50, 50, 1);
    life_set(50, 51, 1);
    life_step();
    if (!(life_get(49, 50) && life_get(50, 50) && life_get(51, 50))) {
        std::printf("FAIL: blinker did not become vertical\n");
        ++failures;
    }

    // --- Hashlife: glider should translate by (1,1) every 4 generations -----
    life_set_algorithm(ALGO_HASHLIFE);
    life_resize(60, 60);
    life_clear();
    // Standard glider away from the edges so it stays on-screen for the test.
    life_set(10, 11, 1);
    life_set(11, 12, 1);
    life_set(12, 10, 1);
    life_set(12, 11, 1);
    life_set(12, 12, 1);
    for (int i = 0; i < 4; ++i) life_step();
    // After 4 gens the glider is the same shape shifted by (+1,+1).
    if (!(life_get(11, 12) && life_get(12, 13) && life_get(13, 11) &&
          life_get(13, 12) && life_get(13, 13))) {
        std::printf("FAIL: hashlife glider did not translate correctly\n");
        ++failures;
    }

    // --- Hashlife matches brute force in the INTERIOR (beyond edge effects) --
    // Brute force (wrap off) treats outside-grid as dead; hashlife evolves the
    // infinite plane. Their results can only differ within `steps` cells of a
    // border, so cells farther in must match exactly (including ages).
    {
        const int W = 60, H = 60, steps = 12, margin = steps + 1;
        life_resize(W, H);
        for (int seed = 1; seed <= 4; ++seed) {
            life_seed(static_cast<uint32_t>(seed));
            life_randomize();
            std::vector<uint32_t> initial(g_front, g_front + W * H);
            std::vector<uint32_t> a = run(ALGO_BRUTE, initial, steps);
            std::vector<uint32_t> b = run(ALGO_HASHLIFE, initial, steps);
            bool ok = true;
            for (int r = margin; r < H - margin && ok; ++r)
                for (int c = margin; c < W - margin; ++c)
                    if (a[r * W + c] != b[r * W + c]) ok = false;
            if (!ok) {
                std::printf("FAIL: hashlife interior != brute force (seed %d)\n",
                            seed);
                ++failures;
            }
        }
    }

    // --- Age tracking still works under hashlife (2x2 block still life) -----
    life_set_algorithm(ALGO_HASHLIFE);
    life_resize(20, 20);
    life_clear();
    life_set(5, 5, 1);
    life_set(5, 6, 1);
    life_set(6, 5, 1);
    life_set(6, 6, 1);
    life_step();
    life_step();
    if (life_get(5, 5) != 3u) {
        std::printf("FAIL: hashlife age tracking wrong (got %u, want 3)\n",
                    life_get(5, 5));
        ++failures;
    }

    // --- Fast-forward: one N-gen superstep == N single steps (interior) -----
    // Compare hashlife advancing N at once against hashlife stepping N times,
    // on the same random seed. Edge cells differ only within N of a border.
    {
        const int W = 64, H = 64, N = 16, margin = N + 1;
        life_resize(W, H);
        life_seed(4242);
        life_randomize();
        std::vector<uint32_t> initial(g_front, g_front + W * H);

        life_set_algorithm(ALGO_HASHLIFE);
        std::memcpy(g_front, initial.data(), initial.size() * sizeof(uint32_t));
        hl::mark_dirty();
        for (int i = 0; i < N; ++i) life_step();   // N single steps
        std::vector<uint32_t> single(g_front, g_front + W * H);

        std::memcpy(g_front, initial.data(), initial.size() * sizeof(uint32_t));
        hl::mark_dirty();
        life_step_by(N);                           // one fast-forward of N
        std::vector<uint32_t> jumped(g_front, g_front + W * H);

        bool ok = true;
        for (int r = margin; r < H - margin && ok; ++r)
            for (int c = margin; c < W - margin; ++c)
                // Compare alive/dead state (ages differ: single steps track per
                // generation, the jump approximates by +N).
                if ((single[r * W + c] != 0) != (jumped[r * W + c] != 0))
                    ok = false;
        if (!ok) {
            std::printf("FAIL: fast-forward state != N single steps\n");
            ++failures;
        }
    }

    // --- Symmetry: D2 randomize is mirror-symmetric in X and Y -------------
    {
        const int W = 50, H = 40;
        life_resize(W, H);
        life_seed(7);
        life_randomize_ex(0.5f, /*SYM_MIRROR_BOTH*/ 3, /*NOISE_NONE*/ 0);
        bool ok = true;
        for (int r = 0; r < H && ok; ++r)
            for (int c = 0; c < W; ++c) {
                if ((life_get(r, c) != 0) != (life_get(r, W - 1 - c) != 0) ||
                    (life_get(r, c) != 0) != (life_get(H - 1 - r, c) != 0)) {
                    ok = false;
                    break;
                }
            }
        if (!ok) {
            std::printf("FAIL: D2 randomize is not mirror-symmetric\n");
            ++failures;
        }
    }

    if (failures == 0) {
        std::printf("ALL TESTS PASSED\n");
        return 0;
    }
    std::printf("%d TEST(S) FAILED\n", failures);
    return 1;
}
#endif  // LIFE_NATIVE_TEST
