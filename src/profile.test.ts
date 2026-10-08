import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import klienci from "./fixtures/klienci.csv?raw";
import { inferType, isMissing, profileTable, toIsoDate } from "./profile";

describe("isMissing", () => {
  it("treats empty, whitespace and placeholders as missing", () => {
    for (const v of ["", " ", "-", "--", "---", "n/d", "N/A", "brak", "Brak", "NULL", undefined]) {
      expect(isMissing(v)).toBe(true);
    }
  });

  it("keeps real values", () => {
    for (const v of ["0", "Warszawa", "a-b", "nd", "none"]) expect(isMissing(v)).toBe(false);
  });
});

describe("toIsoDate", () => {
  it("normalises supported formats", () => {
    expect(toIsoDate("2025-01-31")).toBe("2025-01-31");
    expect(toIsoDate("31.01.2025")).toBe("2025-01-31");
    expect(toIsoDate("31/01/2025")).toBe("2025-01-31");
  });

  it("rejects impossible dates and other text", () => {
    expect(toIsoDate("2025-02-30")).toBeUndefined();
    expect(toIsoDate("31.13.2025")).toBeUndefined();
    expect(toIsoDate("jutro")).toBeUndefined();
  });
});

describe("inferType", () => {
  it("detects integers, numbers, dates and booleans", () => {
    expect(inferType(["1", "20", "-3"])).toBe("integer");
    expect(inferType(["1", "2,5", "3.75"])).toBe("number");
    expect(inferType(["2025-01-01", "02.03.2025"])).toBe("date");
    expect(inferType(["tak", "nie", "tak"])).toBe("boolean");
  });

  it("keeps values with leading zeros as text", () => {
    expect(inferType(["00123", "00456"])).toBe("text");
  });

  it("tolerates a small share of outliers, not a large one", () => {
    const mostlyInts = Array.from({ length: 19 }, (_, i) => String(i + 1)).concat("x");
    expect(inferType(mostlyInts)).toBe("integer");
    expect(inferType(["1", "2", "x", "y"])).toBe("text");
  });

  it("returns empty for no values", () => {
    expect(inferType([])).toBe("empty");
  });
});

describe("profileTable on the sample from the SQL completeness post", () => {
  const profile = profileTable(parseCsv(klienci));
  const col = (name: string) => profile.columns.find((c) => c.name === name)!;

  it("reads 12 rows and 8 columns", () => {
    expect(profile.rows).toBe(12);
    expect(profile.columns).toHaveLength(8);
  });

  it("matches the completeness figures published in the post", () => {
    expect(col("nip").completenessPct).toBe(33.3);
    expect(col("email").completenessPct).toBe(75);
    expect(col("telefon").completenessPct).toBe(66.7);
    expect(col("miasto").completenessPct).toBe(83.3);
    expect(col("nazwa").completenessPct).toBe(100);
  });

  it("counts missing values", () => {
    expect(col("nip").missing).toBe(8);
    expect(col("telefon").missing).toBe(4);
  });

  it("infers types and ranges", () => {
    expect(col("id")).toMatchObject({ type: "integer", min: "1", max: "12" });
    expect(col("data_utworzenia")).toMatchObject({ type: "date", min: "2025-01-10", max: "2025-09-18" });
    expect(col("typ").distinct).toBe(2);
  });

  it("finds no duplicate rows", () => {
    expect(profile.duplicateRows).toBe(0);
  });
});

describe("profileTable edge cases", () => {
  it("counts duplicate rows after the first occurrence", () => {
    expect(profileTable(parseCsv("a,b\n1,x\n1,x\n2,y\n1,x")).duplicateRows).toBe(2);
  });

  it("treats short rows as missing cells", () => {
    const p = profileTable(parseCsv("a,b\n1\n2,3"));
    expect(p.columns[1]).toMatchObject({ missing: 1, completenessPct: 50 });
  });

  it("handles a table without rows", () => {
    const p = profileTable(parseCsv("a,b"));
    expect(p.rows).toBe(0);
    expect(p.columns.map((c) => [c.completenessPct, c.type])).toEqual([[100, "empty"], [100, "empty"]]);
  });
});
