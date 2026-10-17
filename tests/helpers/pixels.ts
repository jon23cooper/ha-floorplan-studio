import type { Page } from "@playwright/test";

// Pixel reads without page.screenshot. On the CI runner Page.captureScreenshot fails at random ("Unable to capture screenshot"; frame-25d
// in 0.30.1, shade-25d in 0.32.0), so a test that only wants a colour must not depend on it. The SVG is serialised with the stylesheet
// embedded, drawn by Chromium's own SVG rasteriser onto a canvas at the page's device scale, and read there. It is still the real CSS
// on a real raster (finding 10), not a string match. Deliberate artifact screenshots stay on page.screenshot.

export interface SvgRead {
  /** CSS selector of the <svg>, looked up inside `host`'s shadow root when `host` is given. */
  svg: string;
  /** CSS selector of the shadow host (the card). Its stylesheets, data-* attributes and inline style are carried onto the clone. */
  host?: string;
  /** Extra CSS to embed (a page that styles the svg with a <style> in the document, not in a shadow root). */
  css?: string;
  /** Points are viewport (client) coordinates when true, else css px from the svg's top-left. */
  client?: boolean;
  /** Side of the square read around each point, in device px, for `readSvg`. 1 is the single pixel; 6 is the mean of 36. Default 1. */
  patch?: number;
}

/** Raw RGB triples of a square patch, row by row. */
export type Patch = number[];

/** The raw RGB of a square of `n` device px around each point, the svg drawn over white like a screenshot of a default page. */
export function readPatches(page: Page, o: SvgRead, pts: number[][], n: number): Promise<Patch[]> {
  return page.evaluate(async ([o, pts, n]) => {
    const root: ParentNode = o.host ? document.querySelector(o.host)!.shadowRoot! : document;
    const live = root.querySelector(o.svg) as SVGSVGElement;
    const r = live.getBoundingClientRect(), w = r.width, h = r.height;
    const dpr = window.devicePixelRatio;
    const svg = live.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.style.cssText += `;width:${w}px;height:${h}px;display:block`;
    svg.setAttribute("width", String(w)); svg.setAttribute("height", String(h));
    let css = o.css ?? "";
    if (o.host) {
      const sr = root as ShadowRoot, host = sr.host as HTMLElement;
      for (const a of Array.from(host.attributes)) if (a.name.startsWith("data-")) svg.setAttribute(a.name, a.value);
      svg.style.cssText += `;${host.style.cssText}`;
      const sheets = [...Array.from(sr.adoptedStyleSheets), ...Array.from(sr.styleSheets)];
      css += sheets.flatMap((s) => Array.from(s.cssRules)).map((x) => x.cssText).join("\n");
    }
    const st = document.createElementNS("http://www.w3.org/2000/svg", "style"); st.textContent = css; svg.insertBefore(st, svg.firstChild);
    const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`; await img.decode();
    const cv = document.createElement("canvas"); cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext("2d", { willReadFrequently: true })!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    const side = n as number, from = Math.floor(side / 2);
    return (pts as number[][]).map(([x, y]) => {
      const px = Math.round((x - (o.client ? r.left : 0)) * dpr) - from, py = Math.round((y - (o.client ? r.top : 0)) * dpr) - from;
      const d = g.getImageData(px, py, side, side).data, out: number[] = [];
      for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i + 1], d[i + 2]);
      return out;
    });
  }, [o, pts, n] as const);
}

/** The colour (r, g, b, 0..255) of each point; with `patch` above 1, the mean of the square around it. */
export async function readSvg(page: Page, o: SvgRead, pts: number[][]): Promise<number[][]> {
  const mean = (p: Patch) => [0, 1, 2].map((k) => { let s = 0; for (let i = k; i < p.length; i += 3) s += p[i]; return s / (p.length / 3); });
  return (await readPatches(page, o, pts, o.patch ?? 1)).map(mean);
}

/** How many pixels of two equal patches differ by more than `tol` levels in any channel. */
export function differing(a: Patch, b: Patch, tol = 4): number {
  let c = 0;
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol) c++;
  return c;
}
