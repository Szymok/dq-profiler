import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import klienci from "./fixtures/klienci.csv?raw";
import { applyRule, suggestRule } from "./rules";
import { isValidEmail, isValidNip, isValidPhonePl, isValidPostalCodePl } from "./validators";

const ctx = { today: "2026-10-08" };
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

describe("isValidNip", () => {
  it("accepts a number with a correct checksum, with or without separators and prefix", () => {
    expect(isValidNip("5260250995")).toBe(true);
    expect(isValidNip("526-025-09-95")).toBe(true);
    expect(isValidNip("PL 5260250995")).toBe(true);
  });

  it("rejects a wrong checksum, wrong length and non-digits", () => {
    expect(isValidNip("5260250996")).toBe(false);
    expect(isValidNip("526025099")).toBe(false);
    expect(isValidNip("52602509955")).toBe(false);
    expect(isValidNip("ABC0250995")).toBe(false);
  });

  it("rejects every number whose weighted sum gives remainder 10", () => {
    let base = "";
    for (let n = 0; n < 1000 && !base; n++) {
      const candidate = `1${String(n).padStart(3, "0")}00000`;
      const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * Number(candidate[i]), 0);
      if (sum % 11 === 10) base = candidate;
    }
    expect(base).not.toBe("");
    for (let d = 0; d <= 9; d++) expect(isValidNip(base + d)).toBe(false);
  });
});

describe("other validators", () => {
  it("e-mail", () => {
    expect(isValidEmail("jan.k@example.com")).toBe(true);
    for (const v of ["n/d", "jan@", "@example.com", "jan example@x.pl", "jan@example"]) expect(isValidEmail(v)).toBe(false);
  });

  it("postal code", () => {
    expect(isValidPostalCodePl("00-001")).toBe(true);
    for (const v of ["00001", "0-0001", "00-0001", "ab-cde"]) expect(isValidPostalCodePl(v)).toBe(false);
  });

  it("phone", () => {
    for (const v of ["221234567", "+48 600 100 200", "0048600100200", "22 123 45 67", "22-123-45-67"]) {
      expect(isValidPhonePl(v)).toBe(true);
    }
    for (const v of ["12345", "+49 600 100 200", "600 100 20x"]) expect(isValidPhonePl(v)).toBe(false);
  });
});

describe("applyRule", () => {
  it("skips missing values and reports invalid examples", () => {
    const r = applyRule(["a@b.pl", "n/d", "", undefined, "zly", "zly", "c@d.com"], { kind: "email" }, ctx);
    expect(r).toEqual({ kind: "email", checked: 4, invalid: 2, validPct: 50, examples: ["zly"] });
  });

  it("reports 100% when nothing is checked", () => {
    expect(applyRule(["", "-"], { kind: "email" }, ctx).validPct).toBe(100);
  });

  it("flags future and impossible dates", () => {
    const r = applyRule(["2026-10-08", "2026-10-09", "2025-02-30", "31.12.2027", "01.01.2020"], { kind: "date_not_future" }, ctx);
    expect(r.checked).toBe(5);
    expect(r.invalid).toBe(3);
    expect(r.examples).toEqual(["2026-10-09", "2025-02-30", "31.12.2027"]);
  });

  it("checks numeric ranges with comma decimals and open ends", () => {
    const rule = { kind: "number_range", min: 0, max: 120 } as const;
    expect(applyRule(["0", "45,5", "120", "121", "-1", "abc"], rule, ctx).invalid).toBe(3);
    expect(applyRule(["-5", "1000"], { kind: "number_range", min: 0 }, ctx).invalid).toBe(1);
  });

  it("limits examples to five distinct values", () => {
    const bad = Array.from({ length: 9 }, (_, i) => `x${i}`);
    expect(applyRule(bad, { kind: "email" }, ctx).examples).toHaveLength(5);
  });
});

describe("validity on the sample from the SQL completeness post", () => {
  const table = parseCsv(klienci);
  const column = (name: string) => table.rows.map((r) => r[table.headers.indexOf(name)]);

  it("shows that filled e-mails and phones are well formed", () => {
    expect(applyRule(column("email"), { kind: "email" }, ctx)).toMatchObject({ checked: 9, invalid: 0, validPct: 100 });
    expect(applyRule(column("telefon"), { kind: "phone_pl" }, ctx)).toMatchObject({ checked: 8, invalid: 0 });
  });

  it("finds that all four synthetic NIPs fail the checksum", () => {
    expect(applyRule(column("nip"), { kind: "nip" }, ctx)).toMatchObject({ checked: 4, invalid: 4, validPct: 0 });
  });

  it("finds no future creation dates", () => {
    expect(applyRule(column("data_utworzenia"), { kind: "date_not_future" }, ctx).invalid).toBe(0);
  });
});

describe("suggestRule", () => {
  it("prefers the header name", () => {
    expect(suggestRule("E-mail", [], ctx)).toEqual({ kind: "email", source: "name" });
    expect(suggestRule("nip", [], ctx)).toEqual({ kind: "nip", source: "name" });
    expect(suggestRule("kod_pocztowy", [], ctx)).toEqual({ kind: "postal_code_pl", source: "name" });
    expect(suggestRule("telefon", [], ctx)).toEqual({ kind: "phone_pl", source: "name" });
    expect(suggestRule("data_utworzenia", [], ctx)).toEqual({ kind: "date_not_future", source: "name" });
  });

  it("falls back to the content when the name says nothing", () => {
    expect(suggestRule("kolumna_7", ["a@b.pl", "c@d.pl", "e@f.pl", "zly", "g@h.pl"], ctx)).toEqual({ kind: "email", source: "content" });
    expect(suggestRule("x", ["5260250995", "5260250995"], ctx)).toEqual({ kind: "nip", source: "content" });
  });

  it("suggests nothing when neither matches", () => {
    expect(suggestRule("opis", ["abc", "def"], ctx)).toBeUndefined();
    expect(suggestRule("opis", [], ctx)).toBeUndefined();
  });
});
