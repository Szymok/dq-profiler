import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import klienci from "./fixtures/klienci.csv?raw";
import { computeReport, defaultConfig, statusFor, type ReportConfig } from "./report";

const today = "2026-10-08";

const klienciConfig: ReportConfig = {
  required: [
    { column: "nazwa" },
    { column: "email" },
    { column: "telefon" },
    { column: "miasto" },
    { column: "nip", when: { column: "typ", equals: "firma" } },
  ],
  rules: [
    { column: "email", rule: { kind: "email" } },
    { column: "telefon", rule: { kind: "phone_pl" } },
    { column: "nip", rule: { kind: "nip" } },
    { column: "data_utworzenia", rule: { kind: "date_not_future" } },
  ],
  keyColumns: ["id"],
  today,
};

describe("statusFor", () => {
  it("uses the Scorecard thresholds at the boundaries", () => {
    expect(statusFor(100)).toBe("green");
    expect(statusFor(95)).toBe("green");
    expect(statusFor(94.9)).toBe("yellow");
    expect(statusFor(85)).toBe("yellow");
    expect(statusFor(84.9)).toBe("red");
    expect(statusFor(0)).toBe("red");
  });
});

describe("computeReport on the sample from the SQL completeness post", () => {
  const report = computeReport(parseCsv(klienci), klienciConfig);
  const dim = (name: string) => report.dimensions.find((d) => d.dimension === name)!;

  it("reproduces the figures published in the post (76.8% fields, 41.7% records)", () => {
    expect(dim("completeness").scorePct).toBe(76.8);
    expect(dim("completeness").status).toBe("red");
    expect(report.completeRecordsPct).toBe(41.7);
  });

  it("measures NIP completeness among companies only", () => {
    const nip = report.fields.find((f) => f.column === "nip")!;
    expect(nip).toMatchObject({ applicable: 8, filled: 4, completenessPct: 50, condition: "typ = firma" });
  });

  it("measures uniqueness by key and validity across rules", () => {
    expect(dim("uniqueness").scorePct).toBe(100);
    expect(dim("validity")).toMatchObject({ scorePct: 87.9, status: "yellow" });
  });

  it("averages the measured dimensions", () => {
    expect(report.overallPct).toBe(88.2);
    expect(report.overallStatus).toBe("yellow");
  });

  it("lists the worst columns first, once per column, with the reason", () => {
    expect(report.worstColumns[0]).toEqual({ column: "nip", scorePct: 0, reason: "ważność: NIP (suma kontrolna)" });
    const names = report.worstColumns.map((c) => c.column);
    expect(new Set(names).size).toBe(names.length);
    expect(report.worstColumns.length).toBeLessThanOrEqual(10);
    const scores = report.worstColumns.map((c) => c.scorePct);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it("has no warnings", () => {
    expect(report.warnings).toEqual([]);
  });
});

describe("computeReport edge cases", () => {
  it("compares whole rows when no key is given", () => {
    const csv = parseCsv("a,b\n1,x\n1,x\n2,y\n3,z");
    const r = computeReport(csv, { required: [], rules: [], today });
    expect(r.dimensions.find((d) => d.dimension === "uniqueness")?.scorePct).toBe(75);
  });

  it("skips rows with a missing key part and says so", () => {
    const csv = parseCsv("id,x\n1,a\n1,b\n,c\n2,d");
    const r = computeReport(csv, { required: [], rules: [], keyColumns: ["id"], today });
    const u = r.dimensions.find((d) => d.dimension === "uniqueness")!;
    expect(u.scorePct).toBe(66.7);
    expect(u.detail).toContain("pominięto");
  });

  it("marks dimensions as not measured instead of reporting 100%", () => {
    const r = computeReport(parseCsv("a\n1"), { required: [], rules: [], today });
    const byName = Object.fromEntries(r.dimensions.map((d) => [d.dimension, d]));
    expect(byName.completeness).toMatchObject({ scorePct: null, status: null });
    expect(byName.validity).toMatchObject({ scorePct: null, status: null });
    expect(r.overallPct).toBe(100);
  });

  it("returns no overall score when nothing could be measured", () => {
    const r = computeReport(parseCsv("a,b"), { required: [], rules: [], today });
    expect(r.overallPct).toBeNull();
    expect(r.overallStatus).toBeNull();
  });

  it("warns about unknown columns and carries on", () => {
    const csv = parseCsv("a\n1\n2");
    const r = computeReport(csv, {
      required: [{ column: "a" }, { column: "nie_ma" }, { column: "a", when: { column: "tez_nie_ma", equals: "x" } }],
      rules: [{ column: "brak", rule: { kind: "email" } }],
      keyColumns: ["zly"],
      today,
    });
    expect(r.warnings).toHaveLength(4);
    expect(r.dimensions.find((d) => d.dimension === "completeness")?.scorePct).toBe(100);
  });

  it("compares the condition value ignoring case and spaces", () => {
    const csv = parseCsv("typ,nip\nFirma ,\nosoba,");
    const r = computeReport(csv, { required: [{ column: "nip", when: { column: "typ", equals: "firma" } }], rules: [], today });
    expect(r.fields[0]).toMatchObject({ applicable: 1, filled: 0 });
  });
});

describe("defaultConfig", () => {
  it("requires every column and suggests rules from names and content", () => {
    const cfg = defaultConfig(parseCsv(klienci), today);
    expect(cfg.required.map((f) => f.column)).toEqual(["id", "nazwa", "typ", "nip", "email", "telefon", "miasto", "data_utworzenia"]);
    expect(cfg.rules.map((r) => [r.column, r.rule.kind])).toEqual([
      ["nip", "nip"],
      ["email", "email"],
      ["telefon", "phone_pl"],
      ["data_utworzenia", "date_not_future"],
    ]);
  });
});
