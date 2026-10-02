// =============================================================================
// patterns.ts — built-in stamp catalog (still lifes, oscillators, spaceships).
//
// Patterns are stored as RLE bodies (sourced from LifeWiki, conwaylife.com) and
// parsed into a StampData { width, height, cells } at use time. A stamp is just
// a tiny world, so it shares the same row-major 0/1 cell layout as the rest of
// the app. Patterns can be rotated by 0/90/180/270 degrees.
// =============================================================================

export interface StampData {
  width: number;
  height: number;
  cells: Uint8Array; // row-major, 0/1
}

interface PatternDef {
  name: string;
  w: number;
  h: number;
  rle: string; // RLE body only (tokens b/o/$/!, run-length encoded)
}

/** Stamp categories (index = dropdown order). */
export const STAMP_STILL = 0;
export const STAMP_OSC = 1;
export const STAMP_SHIP = 2;
export const STAMP_METHUSELAH = 3;
export const STAMP_TYPE_LABELS = ["Still life", "Oscillators", "Spaceships", "Methuselahs"];

// --- Catalog (10 per type), RLE bodies from conwaylife.com -------------------

const STILL_LIFES: PatternDef[] = [
  { name: "Block", w: 2, h: 2, rle: "2o$2o!" },
  { name: "Tub", w: 3, h: 3, rle: "bob$obo$bo!" },
  { name: "Boat", w: 3, h: 3, rle: "2ob$obo$bo!" },
  { name: "Ship", w: 3, h: 3, rle: "2ob$obo$b2o!" },
  { name: "Beehive", w: 4, h: 3, rle: "b2ob$o2bo$b2o!" },
  { name: "Barge", w: 4, h: 4, rle: "bo2b$obob$bobo$2bo!" },
  { name: "Long boat", w: 4, h: 4, rle: "bo2b$obob$bobo$2b2o!" },
  { name: "Loaf", w: 4, h: 4, rle: "b2ob$o2bo$bobo$2bo!" },
  { name: "Eater 1", w: 4, h: 4, rle: "2o2b$obob$2bob$2b2o!" },
  { name: "Pond", w: 4, h: 4, rle: "b2ob$o2bo$o2bo$b2o!" },
];

const OSCILLATORS: PatternDef[] = [
  { name: "Blinker", w: 3, h: 1, rle: "3o!" },
  { name: "Toad", w: 4, h: 2, rle: "b3o$3o!" },
  { name: "Beacon", w: 4, h: 4, rle: "2o2b$o3b$3bo$2b2o!" },
  { name: "Clock", w: 4, h: 4, rle: "2bob$obob$bobo$bo!" },
  { name: "Figure eight", w: 6, h: 6, rle: "2o4b$2obo2b$4bob$bo4b$2bob2o$4b2o!" },
  {
    name: "Octagon 2",
    w: 8,
    h: 8,
    rle: "3b2o3b$2bo2bo2b$bo4bob$o6bo$o6bo$bo4bob$2bo2bo2b$3b2o!",
  },
  {
    name: "Pentadecathlon",
    w: 10,
    h: 3,
    rle: "2bo4bo2b$2ob4ob2o$2bo4bo!",
  },
  { name: "Tumbler", w: 9, h: 5, rle: "bo5bob$obo3bobo$o2bobo2bo$2bo3bo2b$2b2ob2o!" },
  {
    name: "Pulsar",
    w: 13,
    h: 13,
    rle: "2b3o3b3o2b2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2b2$2b3o3b3o2b$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!",
  },
  {
    name: "Pinwheel",
    w: 12,
    h: 12,
    rle: "6b2o4b$6b2o4b2$4b4o4b$2obo4bo3b$2obo2bobo3b$3bo3b2ob2o$3bobo2bob2o$4b4o4b2$4b2o6b$4b2o!",
  },
];

const SPACESHIPS: PatternDef[] = [
  { name: "Glider", w: 3, h: 3, rle: "bob$2bo$3o!" },
  { name: "LWSS", w: 5, h: 4, rle: "bo2bo$o4b$o3bo$4o!" },
  { name: "MWSS", w: 6, h: 5, rle: "3bo2b$bo3bo$o5b$o4bo$5o!" },
  { name: "HWSS", w: 7, h: 5, rle: "3b2o2b$bo4bo$o6b$o5bo$6o!" },
  {
    name: "Loafer",
    w: 9,
    h: 9,
    rle: "b2o2bob2o$o2bo2b2o$bobo$2bo$8bo$6b3o$5bo$6bo$7b2o!",
  },
  {
    name: "Copperhead",
    w: 8,
    h: 12,
    rle: "b2o2b2o$3b2o$3b2o$obo2bobo$o6bo2$o6bo$b2o2b2o$2b4o2$3b2o$3b2o!",
  },
  {
    name: "Dart",
    w: 15,
    h: 10,
    rle: "7bo7b$6bobo6b$5bo3bo5b$6b3o6b2$4b2o3b2o4b$2bo3bobo3bo2b$b2o3bobo3b2ob$o5bobo5bo$bob2obobob2obo!",
  },
  {
    name: "Crab",
    w: 13,
    h: 12,
    rle: "8b2o3b$7b2o4b$9bo3b$11b2o$10bo2b2$9bo2bo$b2o5b2o3b$2o5bo5b$2bo4bobo3b$4b2o2bo4b$4b2o!",
  },
  {
    name: "Weekender",
    w: 16,
    h: 11,
    rle: "bo12bob$bo12bob$obo10bobo$bo12bob$bo12bob$2bo3b4o3bo2b$6b4o6b$2b4o4b4o2b2$4bo6bo4b$5b2o2b2o!",
  },
  {
    name: "Schick engine",
    w: 20,
    h: 11,
    rle: "bo2bo15b$o19b$o3bo15b$4o9b2o5b$6b3o5b2o4b$6b2ob2o6b3o$6b3o5b2o4b$4o9b2o5b$o3bo15b$o19b$bo2bo!",
  },
];

const METHUSELAHS: PatternDef[] = [
  { name: "R-pentomino", w: 3, h: 3, rle: "b2o$2ob$bo!" },
  { name: "B-heptomino", w: 4, h: 3, rle: "bo2b$3ob$b2o!" },
  { name: "Pi-heptomino", w: 3, h: 2, rle: "3o$obo!" },
  { name: "Thunderbird", w: 3, h: 4, rle: "3o2$bob$bob!" },
  { name: "Acorn", w: 7, h: 3, rle: "bo5b$3bo3b$2o2b3o!" },
  { name: "Diehard", w: 8, h: 3, rle: "6bob$2o6b$bo2b3o!" },
  { name: "Rabbits", w: 7, h: 3, rle: "o3b2ob$2ob2bob$bo!" },
  { name: "Bunnies", w: 8, h: 4, rle: "o5bob$2bo3bob$2bo2bob$bobo!" },
  { name: "Lidka", w: 6, h: 5, rle: "4b2o$4b2o2$obo3b$obo!" },
  { name: "Herschel", w: 4, h: 4, rle: "ob2b$3ob$o3b$bob!" },
];

const CATALOG: PatternDef[][] = [STILL_LIFES, OSCILLATORS, SPACESHIPS, METHUSELAHS];

/** Names for the patterns of a given type (for the dropdown). */
export function stampNames(type: number): string[] {
  return (CATALOG[type] ?? STILL_LIFES).map((p) => p.name);
}

/** Parse an RLE body into a 0/1 cell array of the given dimensions. */
function parseRleBody(body: string, w: number, h: number): Uint8Array {
  const cells = new Uint8Array(w * h);
  let x = 0;
  let y = 0;
  let count = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch >= "0" && ch <= "9") {
      count = count * 10 + (ch.charCodeAt(0) - 48);
    } else if (ch === "o" || ch === "b") {
      const n = count || 1;
      if (ch === "o") {
        for (let k = 0; k < n; k++) {
          if (x < w && y < h) cells[y * w + x] = 1;
          x++;
        }
      } else {
        x += n;
      }
      count = 0;
    } else if (ch === "$") {
      y += count || 1;
      x = 0;
      count = 0;
    } else if (ch === "!") {
      break;
    }
    // ignore whitespace / newlines / anything else
  }
  return cells;
}

/** Rotate a stamp 90 degrees clockwise. */
function rotate90(s: StampData): StampData {
  const nw = s.height;
  const nh = s.width;
  const cells = new Uint8Array(nw * nh);
  for (let r = 0; r < s.height; r++) {
    for (let c = 0; c < s.width; c++) {
      if (s.cells[r * s.width + c]) {
        const nr = c;
        const nc = s.height - 1 - r;
        cells[nr * nw + nc] = 1;
      }
    }
  }
  return { width: nw, height: nh, cells };
}

/**
 * Get a stamp's data for the given type/pattern index, rotated by `degrees`
 * (0, 90, 180, or 270 — clockwise).
 */
export function getStampData(
  type: number,
  index: number,
  degrees: number
): StampData {
  const list = CATALOG[type] ?? STILL_LIFES;
  const def = list[index] ?? list[0];
  let s: StampData = {
    width: def.w,
    height: def.h,
    cells: parseRleBody(def.rle, def.w, def.h),
  };
  const turns = (((Math.round(degrees / 90) % 4) + 4) % 4);
  for (let i = 0; i < turns; i++) s = rotate90(s);
  return s;
}
