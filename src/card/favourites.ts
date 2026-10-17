import { pieceDevice } from "../core";
import type { Furniture, Layout, ThingRef } from "../core";

// S34.1, spec F1: the card's `favourites` key, read from untrusted YAML. A person or a model wrote it, so the reader
// never throws and never trusts a shape. It returns the clean list and says whether anything was dropped, so the card
// can warn once.

/** Most favourites a card keeps; the rest are dropped. */
export const MAX_FAVOURITES = 24;

/** `domain.object_id`: lower case letters, digits and `_`, one dot. Linear, no nested quantifier. */
const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export interface FavouritesRead {
  ids: string[];
  /** Something was in the way (not a list, an item that is not an entity id, a repeat, or too many). */
  warn: boolean;
}

// `favourites` wins over `favorites`; a key that is null or undefined counts as absent.
function rawList(config: unknown): { value: unknown; warn: boolean } {
  try {
    if (config === null || typeof config !== "object") return { value: undefined, warn: false };
    const c = config as { favourites?: unknown; favorites?: unknown };
    const a = c.favourites;
    if (a !== undefined && a !== null) return { value: a, warn: false };
    return { value: c.favorites, warn: false };
  } catch {
    return { value: undefined, warn: true };
  }
}

export function favouritesOf(config: unknown): FavouritesRead {
  const { value, warn: readWarn } = rawList(config);
  if (readWarn) return { ids: [], warn: true };
  if (value === undefined || value === null) return { ids: [], warn: false };
  if (!Array.isArray(value)) return { ids: [], warn: true };
  const ids: string[] = [];
  const seen = new Set<string>();
  let warn = false;
  // A 10,000-item list is cut at the cap: stop at the first item past it (and say so) rather than read them all.
  for (let i = 0; i < value.length; i++) {
    if (ids.length >= MAX_FAVOURITES) { warn = true; break; }
    let id: string | null = null;
    try {
      const item: unknown = value[i];
      if (typeof item === "string") { const t = item.trim(); if (ENTITY_ID.test(t)) id = t; }
    } catch { /* a proxy that throws is junk */ }
    if (id === null || seen.has(id)) { warn = true; continue; }
    seen.add(id);
    ids.push(id);
  }
  return { ids, warn };
}

// S34.2, spec F4: which favourites are on the plan.

/** A favourite found on a floor the card shows: the floor's layout key and where the thing sits on it. */
export interface FavouriteRef { entity: string; floor: string; ref: ThingRef }

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const entityOf = (x: unknown): string => (isRecord(x) && typeof x.entity === "string" ? x.entity : "");

/**
 * Where each favourite is drawn, in the list's order: a device's `entity`, or a linked piece's (`pieceDevice`). The
 * first in layout order wins (floors in key order, a floor's devices before its pieces). `floors` are the layout keys
 * the card shows; an entity only on another floor, or not on the plan, is dropped without a word. The layout is
 * untrusted: a row that is not an object, a floor that is not a floor or a list that is not a list is skipped.
 */
export function favouriteRefs(layout: Layout, ids: readonly string[], floors: readonly string[]): FavouriteRef[] {
  const found = new Map<string, FavouriteRef>();
  try {
    const all: unknown = layout?.floors;
    if (!isRecord(all) || !Array.isArray(ids) || !Array.isArray(floors)) return [];
    const wanted = new Set<string>(ids.filter((i): i is string => typeof i === "string"));
    const shown = new Set<string>(floors.filter((k): k is string => typeof k === "string"));
    for (const key of Object.keys(all)) {
      const f = all[key];
      if (!shown.has(key) || !isRecord(f)) continue;
      const take = (entity: string, ref: ThingRef): void => {
        if (entity && wanted.has(entity) && !found.has(entity)) found.set(entity, { entity, floor: key, ref });
      };
      if (Array.isArray(f.devices)) f.devices.forEach((d: unknown, index) => take(entityOf(d), { what: "device", index }));
      if (Array.isArray(f.furniture)) {
        f.furniture.forEach((m: unknown, index) => {
          if (isRecord(m)) take(pieceDevice(m as unknown as Furniture)?.entity ?? "", { what: "piece", index });
        });
      }
    }
  } catch {
    return [];
  }
  const out: FavouriteRef[] = [];
  for (const id of ids) { const r = typeof id === "string" ? found.get(id) : undefined; if (r && !out.includes(r)) out.push(r); }
  return out;
}
