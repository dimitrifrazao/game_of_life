// =============================================================================
// worldFile.ts — save/load the world as a JSON file (".gol").
//
// File format (version 1):
//   {
//     "version": 1,
//     "world":    { "width": W, "height": H, "cells": [0,1,0,...] },  // optional
//     "settings": { ... }    // optional
//   }
// At least one of `world` / `settings` should be present (the user picks via
// checkboxes when saving). `cells` is row-major (index = row * width + col),
// one 0/1 per cell — only on/off state is stored, age resets to 1 on load.
//
// Uses the File System Access API (showSaveFilePicker / showOpenFilePicker) when
// available for native "name + directory" dialogs, with anchor-download /
// file-input fallbacks for browsers that lack it.
// =============================================================================

import type { LifeApi } from "../wasm/life";
import { DIM_MIN, DIM_MAX } from "../config";

/** File extension and on-disk type for saved worlds. */
export const WORLD_EXT = ".gol";
const MIME = "application/json";
const PICKER_TYPES = [
  {
    description: "Game of Life world",
    accept: { "application/json": [WORLD_EXT, ".json"] as string[] },
  },
];

export interface WorldData {
  width: number;
  height: number;
  cells: number[];
}

/** UI settings are stored as an opaque JSON object (App owns the shape). */
export type SettingsData = Record<string, unknown>;

export interface GolFile {
  version: number;
  world?: WorldData;
  settings?: SettingsData;
}

/** Options for saveWorld / serializeWorld. */
export interface SaveOptions {
  /** Include the current grid as `world` in the file. Default true. */
  includeWorld?: boolean;
  /** If provided, included as `settings` in the file. */
  settings?: SettingsData | null;
}

/** Read the current world (on/off state) from the core. */
function readWorld(life: LifeApi): WorldData {
  const width = life.width();
  const height = life.height();
  const view = life.cells(); // Uint32Array of ages, length width*height
  const cells = new Array<number>(view.length);
  for (let i = 0; i < view.length; i++) cells[i] = view[i] ? 1 : 0;
  return { width, height, cells };
}

/**
 * Serialize the current world to a JSON string. The `world` and `settings`
 * sections are each independently optional (caller picks). Throws if neither
 * is requested.
 */
export function serializeWorld(life: LifeApi, opts: SaveOptions = {}): string {
  const { includeWorld = true, settings = null } = opts;
  if (!includeWorld && !settings) {
    throw new Error("Nothing to save: include world data and/or settings.");
  }
  const file: GolFile = { version: 1 };
  if (includeWorld) file.world = readWorld(life);
  if (settings) file.settings = settings;
  return JSON.stringify(file);
}

/** Parse + validate a .gol JSON string (throws on invalid content). Either or
 * both of `world` / `settings` may be present. */
export function parseWorld(text: string): GolFile {
  const obj = JSON.parse(text) as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`Unsupported file version: ${String(obj.version)}`);
  }
  // Detect the world section. Prefer the nested `world` object; for
  // legacy/back-compat treat a flat layout (cells at the top level) as world.
  const flatLooksLikeWorld =
    obj.cells !== undefined &&
    obj.width !== undefined &&
    obj.height !== undefined;
  const rawWorld = (obj.world ?? (flatLooksLikeWorld ? obj : undefined)) as
    | Partial<WorldData>
    | undefined;

  let world: WorldData | undefined;
  if (rawWorld) {
    const { width, height, cells } = rawWorld;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      (width as number) < DIM_MIN ||
      (height as number) < DIM_MIN ||
      (width as number) > DIM_MAX ||
      (height as number) > DIM_MAX
    ) {
      throw new Error("Invalid width/height (must be integers in 1..1000)");
    }
    if (
      !Array.isArray(cells) ||
      cells.length !== (width as number) * (height as number)
    ) {
      throw new Error("cells array length does not match width * height");
    }
    world = {
      width: width as number,
      height: height as number,
      cells: cells as number[],
    };
  }

  const settings =
    obj.settings && typeof obj.settings === "object"
      ? (obj.settings as SettingsData)
      : undefined;

  if (!world && !settings) {
    throw new Error("File contains neither world data nor settings");
  }
  return { version: 1, world, settings };
}

/** Save a `.gol` file. Pick world/settings via `opts`. Returns false if cancelled. */
export async function saveWorld(
  life: LifeApi,
  opts: SaveOptions = {}
): Promise<boolean> {
  const json = serializeWorld(life, opts);
  const blob = new Blob([json], { type: MIME });

  const picker = (window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: `world${WORLD_EXT}`,
        types: PICKER_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return false;
      // fall through to anchor download on other errors
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `world${WORLD_EXT}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Prompt the user to pick a world file; returns its text, or null if cancelled. */
export async function pickWorldText(): Promise<string | null> {
  const picker = (window as unknown as {
    showOpenFilePicker?: (opts: unknown) => Promise<
      Array<{ getFile: () => Promise<File> }>
    >;
  }).showOpenFilePicker;

  if (picker) {
    try {
      const [handle] = await picker({ types: PICKER_TYPES, multiple: false });
      const file = await handle.getFile();
      return await file.text();
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return null;
      // fall through to file input on other errors
    }
  }

  return new Promise<string | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${WORLD_EXT},.json,application/json`;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsText(f);
    };
    input.click();
  });
}
