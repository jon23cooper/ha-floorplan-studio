/** The card's websocket calls to the integration, kept out of the card file. */
import { CARD_VERSION } from "./version";

export interface Conn {
  sendMessagePromise<T>(msg: Record<string, unknown>): Promise<T>;
  subscribeEvents?(cb: () => void, eventType: string): Promise<() => void>;
  subscribeMessage?(cb: () => void, msg: Record<string, unknown>): Promise<() => void>;
  addEventListener?(name: string, cb: () => void): void;
  removeEventListener?(name: string, cb: () => void): void;
}

export const INSTALL_HINT = "No layout: install the Floorplan Studio integration or set layout_url";
export const NOTHING_SAVED = "No plan saved yet. Open Floorplan Studio in the sidebar to draw one.";
export const STALE_PAGE = "Floorplan Studio was updated. Reload this page.";

/** One load in flight per connection: a dashboard of cards asks once, not once per card. Dropped when it settles, so a
 * later card, or a reload after a save, asks again. Callers get the same reply object: copy it before use. */
const inflight = new WeakMap<object, Promise<{ layout: unknown }>>();
export function loadShared(conn: Conn): Promise<{ layout: unknown }> {
  const open = inflight.get(conn);
  if (open) return open;
  const p = conn.sendMessagePromise<{ layout: unknown }>({ type: "floorplan_studio/load" });
  inflight.set(conn, p);
  const done = () => { if (inflight.get(conn) === p) inflight.delete(conn); };
  p.then(done, done);
  return p;
}

/** What to tell the user when the load failed. HA's error is `{ code, message }`; the integration's own words say what
 * is wrong. Only "unknown command" means the integration is missing, and only then is the install hint true. */
export function loadErrorText(e: unknown): string {
  const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown };
  if (code === "unknown_command") return INSTALL_HINT;
  return `Could not load the plan: ${message || "no answer"}`;
}

/** True when the integration on the server is not the build this page runs: a cached card after an update. A dev build
 * has nothing to compare, and any failure says nothing (an old integration has no such command). */
export async function pageIsStale(conn: Conn): Promise<boolean> {
  if (CARD_VERSION === "dev") return false;
  try {
    const r = await conn.sendMessagePromise<{ version?: unknown }>({ type: "floorplan_studio/version" });
    return typeof r?.version === "string" && r.version !== "" && r.version !== CARD_VERSION;
  } catch {
    return false;
  }
}
