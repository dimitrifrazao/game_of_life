// =============================================================================
// glRenderer.ts — WebGL setup, texture upload, and draw for a resizable grid.
//
// Texture-based approach: the cell buffer is uploaded as a (cols x rows)
// LUMINANCE UNSIGNED_BYTE texture with NEAREST filtering, then a quad is drawn.
//
// The canvas itself is square (CSS aspect-ratio 1/1). The grid may be
// non-square (e.g. 200x100), and cells must stay SQUARE (locked aspect). So the
// grid is drawn as a centered sub-rectangle: the larger axis (in cells) fills
// the canvas, and the smaller axis leaves a letterbox gap. The gap is shown in
// GAP_COLOR (the clear color), per spec (black).
//
// The fragment shader (shaders.ts) maps cell value to color and draws grid
// lines + hover highlight, all driven by config.ts uniforms.
// =============================================================================

import {
  GRID_COLS,
  GRID_ROWS,
  OFF_COLOR,
  START_COLOR,
  END_COLOR,
  COLOR_LERP_DEFAULT,
  LERP_SPACE_DEFAULT,
  GRID_LINE_COLOR,
  GRID_LINE_WIDTH,
  HOVER_BORDER_COLOR,
  HOVER_BORDER_WIDTH,
  GAP_COLOR,
  type Rgb,
} from "../config";
import { VERTEX_SHADER, FRAGMENT_SHADER } from "./shaders";

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    throw new Error(`Program link error: ${info}`);
  }
  return program;
}

/**
 * Layout of the grid within the square canvas, expressed as fractions (0..1).
 * (offX, offY) is the top-left of the grid; (fracW, fracH) is its size. When
 * cols == rows the grid fills the canvas; otherwise the short axis is centered
 * with a gap on both sides.
 */
export interface GridLayout {
  cols: number;
  rows: number;
  offX: number;
  offY: number;
  fracW: number;
  fracH: number;
}

function computeLayout(cols: number, rows: number): GridLayout {
  const maxDim = Math.max(cols, rows);
  const fracW = cols / maxDim;
  const fracH = rows / maxDim;
  return {
    cols,
    rows,
    fracW,
    fracH,
    offX: (1 - fracW) / 2,
    offY: (1 - fracH) / 2,
  };
}

export class GridRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private vbo: WebGLBuffer;
  private hover: [number, number] = [-1, -1];

  private cols = GRID_COLS;
  private rows = GRID_ROWS;
  private layout: GridLayout = computeLayout(GRID_COLS, GRID_ROWS);

  // Uniform locations
  private uCells: WebGLUniformLocation | null;
  private uGrid: WebGLUniformLocation | null;
  private uViewOrigin: WebGLUniformLocation | null;
  private uViewSize: WebGLUniformLocation | null;
  private uOffColor: WebGLUniformLocation | null;
  private uStartColor: WebGLUniformLocation | null;
  private uEndColor: WebGLUniformLocation | null;
  private uColorLerp: WebGLUniformLocation | null;
  private uLerpSpace: WebGLUniformLocation | null;
  private uDyingColor: WebGLUniformLocation | null;
  private uShowDying: WebGLUniformLocation | null;
  private uGridLineColor: WebGLUniformLocation | null;
  private uGridLineWidth: WebGLUniformLocation | null;
  private uCellOverGrid: WebGLUniformLocation | null;
  private uShowGrid: WebGLUniformLocation | null;
  private uHoverColor: WebGLUniformLocation | null;
  private uHoverWidth: WebGLUniformLocation | null;
  private uHover: WebGLUniformLocation | null;
  private uStampTex: WebGLUniformLocation | null;
  private uStampSize: WebGLUniformLocation | null;
  private uStampOrigin: WebGLUniformLocation | null;
  private uStampActive: WebGLUniformLocation | null;
  private uStampWrap: WebGLUniformLocation | null;
  private uStampColor: WebGLUniformLocation | null;
  private stampTexture: WebGLTexture;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    // Needed for fwidth() in the fragment shader (constant-thickness grid lines).
    gl.getExtension("OES_standard_derivatives");

    this.program = createProgram(gl);
    gl.useProgram(this.program);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Failed to create vertex buffer");
    this.vbo = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    const stride = 4 * 4;
    const aPosition = gl.getAttribLocation(this.program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, stride, 0);

    const aTexCoord = gl.getAttribLocation(this.program, "aTexCoord");
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, stride, 2 * 4);

    // Cell texture (cols x rows LUMINANCE).
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create texture");
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Data row 0 should be displayed at the TOP of the canvas (matching the
    // mouse->cell row math, which counts rows from the top). WebGL's texture
    // origin is bottom-left, so flip Y on upload.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    // Cache uniform locations.
    this.uCells = gl.getUniformLocation(this.program, "uCells");
    this.uGrid = gl.getUniformLocation(this.program, "uGrid");
    this.uViewOrigin = gl.getUniformLocation(this.program, "uViewOrigin");
    this.uViewSize = gl.getUniformLocation(this.program, "uViewSize");
    this.uOffColor = gl.getUniformLocation(this.program, "uOffColor");
    this.uStartColor = gl.getUniformLocation(this.program, "uStartColor");
    this.uEndColor = gl.getUniformLocation(this.program, "uEndColor");
    this.uColorLerp = gl.getUniformLocation(this.program, "uColorLerp");
    this.uLerpSpace = gl.getUniformLocation(this.program, "uLerpSpace");
    this.uDyingColor = gl.getUniformLocation(this.program, "uDyingColor");
    this.uShowDying = gl.getUniformLocation(this.program, "uShowDying");
    this.uGridLineColor = gl.getUniformLocation(this.program, "uGridLineColor");
    this.uGridLineWidth = gl.getUniformLocation(this.program, "uGridLineWidth");
    this.uCellOverGrid = gl.getUniformLocation(this.program, "uCellOverGrid");
    this.uShowGrid = gl.getUniformLocation(this.program, "uShowGrid");
    this.uHoverColor = gl.getUniformLocation(this.program, "uHoverColor");
    this.uHoverWidth = gl.getUniformLocation(this.program, "uHoverWidth");
    this.uHover = gl.getUniformLocation(this.program, "uHover");
    this.uStampTex = gl.getUniformLocation(this.program, "uStampTex");
    this.uStampSize = gl.getUniformLocation(this.program, "uStampSize");
    this.uStampOrigin = gl.getUniformLocation(this.program, "uStampOrigin");
    this.uStampActive = gl.getUniformLocation(this.program, "uStampActive");
    this.uStampWrap = gl.getUniformLocation(this.program, "uStampWrap");
    this.uStampColor = gl.getUniformLocation(this.program, "uStampColor");

    // Static (config-driven) uniforms.
    gl.uniform1i(this.uCells, 0);
    gl.uniform3f(this.uOffColor, OFF_COLOR[0], OFF_COLOR[1], OFF_COLOR[2]);
    gl.uniform3f(this.uStartColor, START_COLOR[0], START_COLOR[1], START_COLOR[2]);
    gl.uniform3f(this.uEndColor, END_COLOR[0], END_COLOR[1], END_COLOR[2]);
    gl.uniform1f(this.uColorLerp, COLOR_LERP_DEFAULT);
    gl.uniform1f(this.uLerpSpace, LERP_SPACE_DEFAULT);
    gl.uniform3f(this.uDyingColor, 1.0, 1.0, 0.0); // default yellow
    gl.uniform1f(this.uShowDying, 0); // off by default
    gl.uniform3f(
      this.uGridLineColor,
      GRID_LINE_COLOR[0],
      GRID_LINE_COLOR[1],
      GRID_LINE_COLOR[2]
    );
    gl.uniform1f(this.uGridLineWidth, GRID_LINE_WIDTH);
    gl.uniform1f(this.uCellOverGrid, 0);
    gl.uniform1f(this.uShowGrid, 1);
    gl.uniform3f(
      this.uHoverColor,
      HOVER_BORDER_COLOR[0],
      HOVER_BORDER_COLOR[1],
      HOVER_BORDER_COLOR[2]
    );
    gl.uniform1f(this.uHoverWidth, HOVER_BORDER_WIDTH);
    gl.uniform2f(this.uHover, -1, -1);

    // Stamp preview texture (texture unit 1) + uniforms.
    const stampTex = gl.createTexture();
    if (!stampTex) throw new Error("Failed to create stamp texture");
    this.stampTexture = stampTex;
    gl.bindTexture(gl.TEXTURE_2D, stampTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uStampTex, 1);
    gl.uniform2f(this.uStampSize, 1, 1);
    gl.uniform2f(this.uStampOrigin, 0, 0);
    gl.uniform1f(this.uStampActive, 0);
    gl.uniform1f(this.uStampWrap, 0);
    gl.uniform3f(this.uStampColor, 1.0, 0.0, 0.0);

    // Initialize grid-dependent state (uGrid uniform + quad geometry).
    this.applyDimensions();
  }

  /** Current grid layout (fractions within the square canvas). */
  getLayout(): GridLayout {
    return this.layout;
  }

  /**
   * Set the grid dimensions. Recomputes the centered, square-celled layout and
   * the quad geometry. Caller should follow with uploadCells() + draw().
   */
  setDimensions(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.hover = [-1, -1];
    this.applyDimensions();
  }

  /**
   * Set the viewport (camera): top-left in cell coords + size in cells. The
   * shader uses this to map vUv -> cell coords, so all rendering features
   * (cells, grid lines, hover, stamp preview) automatically follow.
   *
   * `viewY` is in top-origin data-row coordinates (viewY=0 means data row 0 at
   * the top of the canvas). The cells texture is uploaded with UNPACK_FLIP_Y,
   * so the shader's `gridPos.y` is bottom-origin in data terms; we convert here
   * once so callers can stay in the natural top-origin convention.
   */
  setView(viewX: number, viewY: number, viewW: number, viewH: number): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    const flippedY = this.rows - viewY - viewH;
    gl.uniform2f(this.uViewOrigin, viewX, flippedY);
    gl.uniform2f(this.uViewSize, viewW, viewH);
  }

  /** Update uGrid and rebuild the centered sub-rectangle quad. */
  private applyDimensions(): void {
    const gl = this.gl;
    this.layout = computeLayout(this.cols, this.rows);
    gl.useProgram(this.program);
    gl.uniform2f(this.uGrid, this.cols, this.rows);
    // Reset the viewport to the full world (zoom 1, no pan).
    gl.uniform2f(this.uViewOrigin, 0, 0);
    gl.uniform2f(this.uViewSize, this.cols, this.rows);

    const { offX, offY, fracW, fracH } = this.layout;
    // Canvas fraction -> clip space. x: f*2-1. y (from top): 1 - f*2.
    const xl = offX * 2 - 1;
    const xr = (offX + fracW) * 2 - 1;
    const yTop = 1 - offY * 2;
    const yBot = 1 - (offY + fracH) * 2;

    // UV: v=0 at the bottom edge, v=1 at the top edge (texture is uploaded with
    // UNPACK_FLIP_Y so data row 0 lands at the top).
    const verts = new Float32Array([
      // x,  y,    u, v
      xl, yBot, 0, 0,
      xr, yBot, 1, 0,
      xl, yTop, 0, 1,
      xl, yTop, 0, 1,
      xr, yBot, 1, 0,
      xr, yTop, 1, 1,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  }

  /**
   * Upload the latest cell buffer into the texture at the current size. The
   * buffer is one uint32 age per cell; we view it as RGBA8 bytes (4 bytes per
   * cell, little-endian) and decode the age in the fragment shader.
   */
  uploadCells(cells: Uint32Array): void {
    const gl = this.gl;
    const bytes = new Uint8Array(
      cells.buffer,
      cells.byteOffset,
      this.cols * this.rows * 4
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // data row 0 displayed at top
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.cols,
      this.rows,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes
    );
  }

  /**
   * Upload a stamp pattern (row-major 0/1) into the stamp texture. Uploaded
   * top-origin (no Y flip); the shader converts world rows to top-origin.
   */
  uploadStamp(cells: Uint8Array, width: number, height: number): void {
    const gl = this.gl;
    // Expand 0/1 to 0/255 so the LUMINANCE texel reads as ~1.0 when live.
    const lum = new Uint8Array(width * height);
    for (let i = 0; i < lum.length; i++) lum[i] = cells[i] ? 255 : 0;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.stampTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.LUMINANCE,
      width,
      height,
      0,
      gl.LUMINANCE,
      gl.UNSIGNED_BYTE,
      lum
    );
    gl.useProgram(this.program);
    gl.uniform2f(this.uStampSize, width, height);
  }

  /** Set the stamp's top-left position in world coords (col, row). */
  setStampOrigin(col: number, row: number): void {
    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.uStampOrigin, col, row);
  }

  /** Show or hide the stamp preview. */
  setStampActive(active: boolean): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uStampActive, active ? 1 : 0);
  }

  /** Whether the stamp wraps around the grid edges. */
  setStampWrap(wrap: boolean): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uStampWrap, wrap ? 1 : 0);
  }

  /** Stamp preview color. */
  setStampColor(c: Rgb): void {
    this.gl.useProgram(this.program);
    this.gl.uniform3f(this.uStampColor, c[0], c[1], c[2]);
  }

  /** Update the empty-cell color. */
  setOffColor(c: Rgb): void {
    this.gl.useProgram(this.program);
    this.gl.uniform3f(this.uOffColor, c[0], c[1], c[2]);
  }

  /** Update the live-cell start color (age 1). */
  setStartColor(c: Rgb): void {
    this.gl.useProgram(this.program);
    this.gl.uniform3f(this.uStartColor, c[0], c[1], c[2]);
  }

  /** Update the live-cell end color (aged). */
  setEndColor(c: Rgb): void {
    this.gl.useProgram(this.program);
    this.gl.uniform3f(this.uEndColor, c[0], c[1], c[2]);
  }

  /** Set the number of generations to lerp from start to end color (>= 1). */
  setColorLerp(generations: number): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uColorLerp, Math.max(1, generations));
  }

  /** Set the color interpolation space (0 = sRGB, 1 = linear, 2 = OKLab). */
  setLerpSpace(space: number): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uLerpSpace, space);
  }

  /** Set the dying-cell color. */
  setDyingColor(c: Rgb): void {
    this.gl.useProgram(this.program);
    this.gl.uniform3f(this.uDyingColor, c[0], c[1], c[2]);
  }

  /** Toggle whether dying cells are shown in the dying color. */
  setShowDying(enabled: boolean): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uShowDying, enabled ? 1 : 0);
  }

  /** Toggle whether live cells render over (hide) the grid lines within them. */
  setCellOverGrid(enabled: boolean): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uCellOverGrid, enabled ? 1 : 0);
  }

  /** Update the grid line color. */
  setGridLineColor(c: Rgb): void {
    this.gl.useProgram(this.program);
    this.gl.uniform3f(this.uGridLineColor, c[0], c[1], c[2]);
  }

  /** Toggle whether grid lines are drawn at all. */
  setShowGrid(enabled: boolean): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uShowGrid, enabled ? 1 : 0);
  }

  /** Set hovered cell (col, row) in top-origin coords; pass (-1,-1) to clear. */
  setHover(col: number, row: number): void {
    if (col < 0 || row < 0) {
      this.hover = [-1, -1];
      return;
    }
    // Shader cell.y is bottom-origin (Y is flipped on texture upload), while
    // row is counted from the top. Convert so the highlighted cell matches.
    this.hover = [col, this.rows - 1 - row];
  }

  /** Resize the drawing buffer and viewport (caller passes device pixels). */
  resize(pixelWidth: number, pixelHeight: number): void {
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
  }

  draw(): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.stampTexture);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform2f(this.uHover, this.hover[0], this.hover[1]);
    // Clear with the gap color so the letterbox area (when the grid is
    // non-square) shows through around the centered grid.
    gl.clearColor(GAP_COLOR[0], GAP_COLOR[1], GAP_COLOR[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
