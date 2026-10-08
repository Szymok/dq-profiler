import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const klienci = readFileSync("src/fixtures/klienci.csv");

async function upload(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.setInputFiles("#file", { name, mimeType: "text/csv", buffer });
}

/** Configuration used in the "completeness in SQL" post: id is the key, NIP is required only for companies. */
async function configureLikeThePost(page: Page): Promise<void> {
  await page.locator("#col-0-req").uncheck();
  await page.locator("#col-0-key").check();
  await page.locator("#col-2-req").uncheck();
  await page.locator("#col-7-req").uncheck();
  await page.locator("#col-3-cc").selectOption("typ");
  await page.locator("#col-3-cv").fill("firma");
}

test.describe("privacy: the file never leaves the browser", () => {
  test("no network request is made after the file is chosen, the report built and downloaded", async ({ page }) => {
    const requests: { method: string; url: string }[] = [];
    page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const initial = requests.length;

    // The page itself may only load its own static files.
    for (const r of requests) {
      expect(r.method).toBe("GET");
      expect(r.url).toMatch(/^http:\/\/localhost:4173\//);
    }

    await upload(page, "klienci.csv", klienci);
    await expect(page.getByRole("status")).toContainText("Wczytano 12 wierszy i 8 kolumn");
    await configureLikeThePost(page);
    await page.getByRole("button", { name: "Policz raport" }).click();
    await expect(page.locator("iframe.report")).toBeVisible();

    const [html] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Pobierz raport HTML" }).click()]);
    expect(html.suggestedFilename()).toBe("klienci-raport.html");
    const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Pobierz JSON" }).click()]);
    expect(json.suggestedFilename()).toBe("klienci-raport.json");

    // Local blob:/data: URLs are not network traffic; anything else would be.
    const afterUpload = requests.slice(initial).filter((r) => !/^(blob|data|about):/.test(r.url));
    expect(afterUpload).toEqual([]);
  });

  test("the Content-Security-Policy makes the browser refuse every outgoing connection", async ({ page }) => {
    await page.goto("/");
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("connect-src 'none'");

    // sendBeacon() returns true and WebSocket() does not throw even when the policy blocks them (the browser
    // queues the request and refuses it afterwards), so return values prove nothing. The proof is the
    // securitypolicyviolation event the browser fires for each blocked connection.
    const result = await page.evaluate(async () => {
      const violations: { directive: string; blockedURI: string }[] = [];
      document.addEventListener("securitypolicyviolation", (e) => violations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI }));

      const external = "http://dq-profiler-test.invalid/collect";
      const sameOrigin = `${location.origin}/probe`;
      const socketUrl = "ws://dq-profiler-test.invalid/socket";

      const fetchOutcomes: string[] = [];
      for (const url of [external, sameOrigin]) {
        try {
          await fetch(url, { method: "POST", body: "x" });
          fetchOutcomes.push("allowed");
        } catch {
          fetchOutcomes.push("blocked");
        }
      }
      navigator.sendBeacon("http://dq-profiler-test.invalid/beacon", "x");

      const socketClosed = await new Promise<boolean>((resolve) => {
        try {
          const ws = new WebSocket(socketUrl);
          ws.onopen = () => resolve(false);
          ws.onclose = () => resolve(true);
          ws.onerror = () => resolve(true);
          setTimeout(() => resolve(ws.readyState === WebSocket.CLOSED), 2000);
        } catch {
          resolve(true);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { fetchOutcomes, socketClosed, violations };
    });

    expect(result.fetchOutcomes).toEqual(["blocked", "blocked"]); // even the same origin: connect-src is 'none'
    expect(result.socketClosed).toBe(true);
    expect(result.violations.length).toBeGreaterThanOrEqual(4);
    expect(result.violations.every((v) => v.directive === "connect-src")).toBe(true);
    const blocked = result.violations.map((v) => v.blockedURI).join(" ");
    for (const part of ["dq-profiler-test.invalid/collect", "/probe", "dq-profiler-test.invalid/beacon", "dq-profiler-test.invalid/socket"]) {
      expect(blocked).toContain(part);
    }
  });
});

test.describe("behaviour in the browser", () => {
  test("reproduces the figures published in the SQL completeness post", async ({ page }) => {
    await page.goto("/");
    await upload(page, "klienci.csv", klienci);
    await expect(page.getByRole("status")).toContainText("Wczytano 12 wierszy");
    await configureLikeThePost(page);
    await page.getByRole("button", { name: "Policz raport" }).click();

    const report = page.frameLocator("iframe.report").locator("body");
    await expect(report).toContainText("Wynik łączny: 88.2%");
    await expect(report).toContainText("76.8%");
    await expect(report).toContainText("w pełni kompletnych rekordów: 41.7%");
    await expect(report).toContainText("trzech z sześciu wymiarów");
  });

  test("hostile column names and values are shown as text and never run", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const hostileHeader = `<img src=x onerror="window.__pwned=1">`;
    // The empty cell makes the hostile column show up in the report ("columns needing attention").
    const csv = `${hostileHeader},email\n<script>window.__pwned=2</script>,zly\n,c@d.pl\n"<b>x</b>",a@b.pl\n`;

    await page.goto("/");
    await upload(page, "zly.csv", Buffer.from(csv));
    await expect(page.getByRole("status")).toContainText("Wczytano 3 wierszy");
    await expect(page.locator("table.config th[scope=row]").first()).toHaveText(hostileHeader);
    await page.getByRole("button", { name: "Policz raport" }).click();

    const report = page.frameLocator("iframe.report");
    await expect(report.locator("body")).toContainText(hostileHeader);
    await expect(report.locator("img")).toHaveCount(0);
    await expect(page.locator("table.config img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialogs).toEqual([]);
  });

  test("rejects a file over the 25 MB limit with a clear message", async ({ page }) => {
    await page.goto("/");
    await upload(page, "za-duzy.csv", Buffer.alloc(26 * 1024 * 1024, "a"));
    await expect(page.getByRole("status")).toContainText("Limit to 25 MB");
    await expect(page.locator("#config-title")).toBeHidden();
  });

  test("explains an empty or non-CSV file instead of failing silently", async ({ page }) => {
    await page.goto("/");
    await upload(page, "pusty.csv", Buffer.from(""));
    await expect(page.getByRole("status")).toContainText("nie znaleziono nagłówka i danych");
  });

  test("lets the user change a wrongly detected separator", async ({ page }) => {
    await page.goto("/");
    await upload(page, "srednik.csv", Buffer.from("a;b;c\n1;2;3\n4;5;6\n"));
    await expect(page.getByRole("status")).toContainText("Wczytano 2 wierszy i 3 kolumn");
    await page.locator("#delimiter").selectOption(",");
    await expect(page.getByRole("status")).toContainText("Wczytano 2 wierszy i 1 kolumn");
  });
});
