import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import klienci from "./fixtures/klienci.csv?raw";
import { esc, OFFER_URL, toHtml, toJson } from "./export";
import { computeReport } from "./report";

const today = "2026-10-08";
const report = computeReport(parseCsv(klienci), {
  required: [{ column: "email" }, { column: "nip", when: { column: "typ", equals: "firma" } }],
  rules: [{ column: "nip", rule: { kind: "nip" } }],
  today,
});

describe("esc", () => {
  it("escapes HTML metacharacters", () => {
    expect(esc(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  });
});

describe("toJson", () => {
  it("round-trips the report", () => {
    expect(JSON.parse(toJson(report))).toEqual(JSON.parse(JSON.stringify(report)));
  });
});

describe("toHtml", () => {
  const html = toHtml(report);

  it("is a self-contained page without scripts or external requests", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/\bsrc=/i);
    expect(html.match(/https?:\/\/[^"'\s<)]+/g)).toEqual([OFFER_URL]);
  });

  it("writes the status out in words, not only in colour", () => {
    expect(html).toMatch(/czerwony|żółty|zielony/);
  });

  it("states the limits and links to the audit", () => {
    expect(html).toContain("trzech z sześciu wymiarów");
    expect(html).toContain(OFFER_URL);
  });

  it("escapes column names and values that come from the file", () => {
    const hostile = parseCsv('id,"<script>alert(1)</script>"\n1,"<b>x</b>"');
    const r = computeReport(hostile, {
      required: [{ column: "<script>alert(1)</script>" }],
      rules: [{ column: "<script>alert(1)</script>", rule: { kind: "email" } }],
      today,
    });
    const out = toHtml(r, { title: "<i>tytuł</i>" });
    expect(out).not.toContain("<script>alert");
    expect(out).not.toContain("<b>x</b>");
    expect(out).not.toContain("<i>tytuł</i>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("can leave examples of invalid values out", () => {
    expect(toHtml(report)).toContain("Przykłady:");
    expect(toHtml(report, { includeExamples: false })).not.toContain("Przykłady:");
  });

  it("handles a report with nothing measured", () => {
    const empty = toHtml(computeReport(parseCsv("a,b"), { required: [], rules: [], today }));
    expect(empty).toContain("nie zmierzono");
    expect(empty).toContain("Nie wybrano reguł.");
  });
});
