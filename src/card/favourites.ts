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
