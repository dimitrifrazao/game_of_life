// =============================================================================
// shaders.ts — GLSL vertex + fragment shader sources for the texture-based grid.
//
// A single grid quad is drawn. The cell buffer is one uint32 AGE per cell,
// uploaded as an RGBA8 texture (4 bytes = the little-endian age). The fragment
// shader decodes the age, then:
//   age == 0           -> uOffColor (empty cell)
//   age >= 1           -> color lerped from uStartColor (age 1) to uEndColor
//                         over uColorLerp generations (clamped).
//
// Grid lines: width is a FRACTION OF A CELL (so they scale with cell size), and
// they are drawn with ANTI-ALIASED coverage using screen-space derivatives
// (fwidth) so every line has a uniform visual thickness — no thick/thin lines
// from cells spanning a non-integer number of device pixels.
//
// uCellOverGrid: when > 0.5, live cells paint over the grid lines (so live
// regions look solid); when 0, grid lines are drawn over everything.
// =============================================================================

export const VERTEX_SHADER = /* glsl */ `
attribute vec2 aPosition;   // clip-space quad corners
attribute vec2 aTexCoord;   // 0..1 across the grid
varying vec2 vUv;
void main() {
  vUv = aTexCoord;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec2 vUv;

uniform sampler2D uCells;        // (cols x rows) RGBA8, each texel a uint32 age
uniform vec2 uGrid;              // (cols, rows) — full world dims (texture size)
uniform vec2 uViewOrigin;        // viewport top-left in cell coords
uniform vec2 uViewSize;          // viewport size in cells (cols/zoom, rows/zoom)

uniform vec3 uOffColor;          // empty (dead) cell color
uniform vec3 uStartColor;        // live cell color at age 1
uniform vec3 uEndColor;          // live cell color at age >= uColorLerp
uniform float uColorLerp;        // generations to lerp start -> end (>= 1)
uniform float uLerpSpace;        // 0=sRGB 1=linear 2=OKLab 3=HSL short 4=HSL long
uniform vec3 uDyingColor;        // color for cells that will die next generation
uniform float uShowDying;        // 1 = show dying color, 0 = ignore

uniform vec3 uGridLineColor;     // grid line color
uniform float uGridLineWidth;    // grid line thickness as a fraction of a cell
uniform float uCellOverGrid;     // 1 = live cells render over grid lines
uniform float uShowGrid;         // 1 = draw grid lines, 0 = hide them

uniform vec3 uHoverColor;        // hovered cell border color
uniform float uHoverWidth;       // hovered border thickness as a fraction of a cell
uniform vec2 uHover;             // hovered (col, row); (-1,-1) when none

uniform sampler2D uStampTex;     // stamp pattern (LUMINANCE), top-origin rows
uniform vec2 uStampSize;         // stamp (width, height) in cells
uniform vec2 uStampOrigin;       // stamp top-left in world coords (col, row)
uniform float uStampActive;      // 1 = show stamp preview
uniform float uStampWrap;        // 1 = wrap stamp around grid edges
uniform vec3 uStampColor;        // stamp preview color

// Decode a little-endian uint32 age from an RGBA texel (components are 0..1).
float decodeAge(vec4 t) {
  return t.r * 255.0
       + t.g * 255.0 * 256.0
       + t.b * 255.0 * 65536.0
       + t.a * 255.0 * 16777216.0;
}

// --- Color space conversions (per-component, branchless) --------------------

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(0.04045, c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);                       // clamp out-of-gamut before pow
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}

// Linear sRGB -> OKLab (Björn Ottosson).
vec3 linearToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  float l_ = pow(max(l, 0.0), 1.0 / 3.0);
  float m_ = pow(max(m, 0.0), 1.0 / 3.0);
  float s_ = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  );
}

// OKLab -> linear sRGB.
vec3 oklabToLinear(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

// sRGB <-> HSL (gamma space, hue/sat/lightness all in 0..1).
vec3 rgbToHsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float h = 0.0;
  float s = 0.0;
  float d = mx - mn;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else                h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0 / 2.0) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s <= 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0 / 3.0),
              hue2rgb(p, q, h),
              hue2rgb(p, q, h - 1.0 / 3.0));
}

// Interpolate two sRGB colors in HSL. longWay picks the opposite hue direction
// around the wheel (rainbow sweep) instead of the shortest path.
vec3 lerpHsl(vec3 a, vec3 b, float t, bool longWay) {
  vec3 ha = rgbToHsl(a);
  vec3 hb = rgbToHsl(b);
  float dh = hb.x - ha.x;
  dh = dh - floor(dh + 0.5);           // shortest signed delta in (-0.5, 0.5]
  if (longWay) dh = dh > 0.0 ? dh - 1.0 : dh + 1.0;
  float h = fract(ha.x + t * dh);
  float s = mix(ha.y, hb.y, t);
  float l = mix(ha.z, hb.z, t);
  return hslToRgb(vec3(h, s, l));
}

// Interpolate two sRGB colors by t in the selected space; returns sRGB.
vec3 lerpColor(vec3 a, vec3 b, float t, float space) {
  if (space < 0.5) {
    // sRGB (gamma space) — naive channel-wise lerp.
    return mix(a, b, t);
  } else if (space < 1.5) {
    // Linear-light RGB.
    return linearToSrgb(mix(srgbToLinear(a), srgbToLinear(b), t));
  } else if (space < 2.5) {
    // OKLab (perceptual).
    vec3 oa = linearToOklab(srgbToLinear(a));
    vec3 ob = linearToOklab(srgbToLinear(b));
    return linearToSrgb(oklabToLinear(mix(oa, ob, t)));
  } else if (space < 3.5) {
    // HSL hue lerp, shortest path around the wheel.
    return lerpHsl(a, b, t, false);
  } else {
    // HSL hue lerp, long way around the wheel (rainbow).
    return lerpHsl(a, b, t, true);
  }
}

// Anti-aliased coverage (0..1) of a line band of half-width hw (in cell units),
// given the per-axis distance to the nearest cell edge and the per-axis
// cell-units-per-pixel (aa). smoothstep over ~1 pixel keeps every line the same
// visual width regardless of sub-pixel alignment.
float lineCoverage(vec2 distToEdge, vec2 aa, float hw) {
  vec2 cov = vec2(1.0) - smoothstep(vec2(hw), vec2(hw) + aa, distToEdge);
  return max(cov.x, cov.y);
}

void main() {
  // Viewport transform: vUv (0..1 across the canvas grid sub-rect) maps into a
  // window of the world starting at uViewOrigin and spanning uViewSize cells.
  // At default (origin=(0,0), size=(cols,rows)) this matches the un-zoomed view.
  vec2 gridPos = uViewOrigin + vUv * uViewSize;
  vec2 cell = floor(gridPos);          // integer cell (col, row) in world coords
  vec2 f = fract(gridPos);             // 0..1 position within the cell

  // Sample the cell at its center to avoid NEAREST edge ambiguity.
  vec2 sampleUv = (cell + 0.5) / uGrid;
  vec4 texel = texture2D(uCells, sampleUv);
  // The age is a little-endian uint32 in RGBA. Bit 31 (the dying flag) is the
  // MSB of the alpha byte, so texel.a >= 128/255 when the dying bit is set.
  float dying = step(128.0 / 255.0, texel.a);
  // Decode the age from the lower 31 bits: mask out bit 7 of the alpha channel.
  float alphaMasked = texel.a - dying * (128.0 / 255.0);
  float age = texel.r * 255.0
            + texel.g * 255.0 * 256.0
            + texel.b * 255.0 * 65536.0
            + alphaMasked * 255.0 * 16777216.0;
  bool alive = age >= 0.5;

  vec3 color;
  if (!alive) {
    color = uOffColor;
  } else if (dying > 0.5 && uShowDying > 0.5) {
    color = uDyingColor;
  } else {
    float denom = max(uColorLerp - 1.0, 1.0);
    float t = clamp((age - 1.0) / denom, 0.0, 1.0);
    color = lerpColor(uStartColor, uEndColor, t, uLerpSpace);
  }

  vec2 distToEdge = min(f, 1.0 - f);   // 0 at a cell boundary, 0.5 at center
  vec2 aa = fwidth(gridPos);           // cell units covered by one device pixel

  // Grid lines — when enabled, and unless a live cell paints over them.
  if (uShowGrid > 0.5 && !(alive && uCellOverGrid > 0.5)) {
    float line = lineCoverage(distToEdge, aa, uGridLineWidth * 0.5);
    color = mix(color, uGridLineColor, line);
  }

  // Stamp preview overlay (front-end only; does not change game state). Convert
  // the shader's bottom-origin cell.y to a top-origin world row to match the
  // stamp's top-left anchor.
  if (uStampActive > 0.5) {
    float worldCol = cell.x;
    float worldRow = uGrid.y - 1.0 - cell.y;
    float sx = worldCol - uStampOrigin.x;
    float sy = worldRow - uStampOrigin.y;
    if (uStampWrap > 0.5) {
      sx = mod(sx, uGrid.x);
      sy = mod(sy, uGrid.y);
    }
    if (sx >= 0.0 && sx < uStampSize.x && sy >= 0.0 && sy < uStampSize.y) {
      vec2 stampUv = (floor(vec2(sx, sy)) + 0.5) / uStampSize;
      if (texture2D(uStampTex, stampUv).r > 0.5) {
        color = mix(color, uStampColor, 0.7);
      }
    }
  }

  // Hover highlight (always drawn on top).
  if (uHover.x >= 0.0 && uHover.y >= 0.0 &&
      abs(cell.x - uHover.x) < 0.5 && abs(cell.y - uHover.y) < 0.5) {
    float h = lineCoverage(distToEdge, aa, uHoverWidth * 0.5);
    color = mix(color, uHoverColor, h);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
