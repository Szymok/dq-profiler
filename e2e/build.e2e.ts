import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Static checks on the built app (dist/). They guard the promise that the app page carries no analytics and
 * talks to nobody, independently of how it is hosted. Skipped when testing a deployed copy.
 */
test.skip(!!process.env.E2E_BASE_URL, "dist/ is only available when the suite builds the app itself");

const DIST = "dist";
// Hosts the app is allowed to mention (as plain links, never as something it loads or contacts).
const ALLOWED_HOSTS = ["skszymon.eu", "github.com"];
// XML namespace identifiers (e.g. in an SVG favicon) look like URLs but are never fetched. Listed exactly, not by host.
const XML_NAMESPACES = new Set(["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"]);
const FORBIDDEN = /umami|recorder\.js|script\.js|google-analytics|googletagmanager|gtag|plausible|matomo|hotjar|clarity\.ms|sentry/i;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

const html = readFileSync(join(DIST, "index.html"), "utf8");
const assets = files(DIST).filter((f) => /\.(js|css|html|svg)$/.test(f));

test("the built page declares a strict CSP and asks not to be indexed", () => {
  expect(html).toContain("connect-src &#39;none&#39;");
  expect(html).toContain("default-src &#39;none&#39;");
  expect(html).toMatch(/<meta name="robots" content="noindex"/);
});

test("every built script is named *.min.js so hosts that re-minify .js files leave it untouched", () => {
  const scripts = files(DIST).filter((f) => f.endsWith(".js"));
  expect(scripts.length).toBeGreaterThan(0);
  for (const file of scripts) expect(file, file).toMatch(/\.min\.js$/);
});

test("the built page loads only its own relative script and stylesheet", () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toMatch(/src="\.\/assets\/[^"]+\.js"/);
  const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  for (const tag of styles) expect(tag).toMatch(/href="\.\/assets\/[^"]+\.css"/);
  expect(html).not.toMatch(/<iframe/i);
});

test("no analytics, session recording or tracking code is present in any built file", () => {
  for (const file of assets) expect(readFileSync(file, "utf8"), file).not.toMatch(FORBIDDEN);
});

test("the only absolute URLs in the build point to the allowed hosts", () => {
  const found = new Set<string>();
  for (const file of assets) {
    for (const m of readFileSync(file, "utf8").matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) found.add(m[0]);
  }
  for (const url of found) {
    if (XML_NAMESPACES.has(url)) continue;
    const host = new URL(url).hostname;
    // Exact hosts only: a subdomain such as umami.skszymon.eu must not slip through as "the same site".
    expect(ALLOWED_HOSTS.includes(host), url).toBe(true);
  }
});

test("every built file uses LF line endings, so the same commit gives the same bytes on any machine", () => {
  for (const file of assets) expect(readFileSync(file, "utf8"), file).not.toContain("\r");
});

test("the footer and the back link point to the author's site, the audit and the source code", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("link", { name: "← skszymon.eu" })).toHaveAttribute("href", "https://skszymon.eu/");
  await expect(page.getByRole("link", { name: /audyt jakości danych/ })).toHaveAttribute("href", "https://skszymon.eu/audyt-data-quality/");
  await expect(page.getByRole("link", { name: /Kod źródłowy/ })).toHaveAttribute("href", "https://github.com/Szymok/dq-profiler");
});
