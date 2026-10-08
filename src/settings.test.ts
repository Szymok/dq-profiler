import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import klienci from "./fixtures/klienci.csv?raw";
import { computeReport } from "./report";
import { buildConfig, initialSettings, localIsoDate, type ColumnSetting } from "./settings";

const today = "2026-10-08";

describe("initialSettings", () => {
  const settings = initialSettings(parseCsv(klienci), today);
  const get = (c: string) => settings.find((s) => s.column === c)!;

  it("requires every column and sets no key", () => {
    expect(settings).toHaveLength(8);
    expect(settings.every((s) => s.required && !s.key)).toBe(true);
  });

  it("suggests rules and remembers where the hint came from", () => {
    expect(get("email")).toMatchObject({ rule: "email", suggestedFrom: "name" });
    expect(get("nip")).toMatchObject({ rule: "nip", suggestedFrom: "name" });
    expect(get("nazwa")).toMatchObject({ rule: "none" });
    expect(get("nazwa").suggestedFrom).toBeUndefined();
  });
});

describe("buildConfig", () => {
  const base = (column: string, extra: Partial<ColumnSetting> = {}): ColumnSetting => ({ column, required: false, rule: "none", key: false, ...extra });

  it("collects required fields, rules and key columns", () => {
    const cfg = buildConfig(
      [base("id", { required: true, key: true }), base("email", { rule: "email" }), base("nazwa", { required: true })],
      today,
    );
    expect(cfg).toEqual({
      required: [{ column: "id" }, { column: "nazwa" }],
      rules: [{ column: "email", rule: { kind: "email" } }],
      keyColumns: ["id"],
      today,
    });
  });

  it("omits keyColumns when none is chosen", () => {
    expect(buildConfig([base("a", { required: true })], today)).not.toHaveProperty("keyColumns");
  });

  it("keeps a condition only when both its column and value are filled in", () => {
    const full = buildConfig([base("nip", { required: true, condition: { column: "typ", equals: "firma" } })], today);
    expect(full.required).toEqual([{ column: "nip", when: { column: "typ", equals: "firma" } }]);
    for (const condition of [{ column: "", equals: "firma" }, { column: "typ", equals: "  " }]) {
      expect(buildConfig([base("nip", { required: true, condition })], today).required).toEqual([{ column: "nip" }]);
    }
  });

  it("passes only the given range bounds and ignores NaN", () => {
    const cfg = buildConfig(
      [base("a", { rule: "number_range", min: 0 }), base("b", { rule: "number_range", min: Number.NaN, max: 10 })],
      today,
    );
    expect(cfg.rules).toEqual([
      { column: "a", rule: { kind: "number_range", min: 0 } },
      { column: "b", rule: { kind: "number_range", max: 10 } },
    ]);
  });

  it("reproduces the published figures when configured as in the post", () => {
    const csv = parseCsv(klienci);
    const settings = initialSettings(csv, today).map((s) => {
      if (s.column === "id") return { ...s, required: false, key: true };
      if (s.column === "typ" || s.column === "data_utworzenia") return { ...s, required: false };
      if (s.column === "nip") return { ...s, condition: { column: "typ", equals: "firma" } };
      return s;
    });
    const report = computeReport(csv, buildConfig(settings, today));
    expect(report.dimensions.find((d) => d.dimension === "completeness")?.scorePct).toBe(76.8);
    expect(report.completeRecordsPct).toBe(41.7);
  });
});

describe("localIsoDate", () => {
  it("formats the local calendar date with zero padding", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localIsoDate(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});
