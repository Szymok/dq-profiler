import { describe, expect, it } from "vitest";
import { decodeBytes, detectDelimiter, parseCsv } from "./csv";

describe("detectDelimiter", () => {
  it("detects comma, semicolon, tab and pipe", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
  });

  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('nazwa;opis\n"Alfa, Beta";x')).toBe(";");
  });

  it("falls back to comma for a single column", () => {
    expect(detectDelimiter("a\nb\nc")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    const r = parseCsv("id,nazwa\n1,Alfa\n2,Beta");
    expect(r.headers).toEqual(["id", "nazwa"]);
    expect(r.rows).toEqual([["1", "Alfa"], ["2", "Beta"]]);
  });

  it("handles CRLF, CR and a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a,b\r1,2\r").rows).toEqual([["1", "2"]]);
  });

  it("strips a BOM", () => {
    expect(parseCsv("﻿id,nazwa\n1,Alfa").headers).toEqual(["id", "nazwa"]);
  });

  it("handles quoted fields with delimiters, newlines and escaped quotes", () => {
    const r = parseCsv('id,opis\n1,"Alfa, Sp. z o.o."\n2,"linia1\nlinia2"\n3,"on powiedział ""tak"""');
    expect(r.rows).toEqual([
      ["1", "Alfa, Sp. z o.o."],
      ["2", "linia1\nlinia2"],
      ["3", 'on powiedział "tak"'],
    ]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv("a,b,c\n1,,3\n,,").rows).toEqual([["1", "", "3"], ["", "", ""]]);
  });

  it("drops trailing blank rows but keeps ragged rows as they are", () => {
    const r = parseCsv("a,b\n1\n2,3,4\n\n\n");
    expect(r.rows).toEqual([["1"], ["2", "3", "4"]]);
  });

  it("returns empty structures for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], delimiter: "," });
  });

  it("respects an explicit delimiter", () => {
    expect(parseCsv("a;b\n1;2", ";").rows).toEqual([["1", "2"]]);
  });
});

describe("decodeBytes", () => {
  it("decodes valid UTF-8", () => {
    const bytes = new TextEncoder().encode("Łódź");
    expect(decodeBytes(bytes)).toEqual({ text: "Łódź", encoding: "utf-8" });
  });

  it("falls back to Windows-1250 for invalid UTF-8", () => {
    // "Łódź" in Windows-1250: Ł=0xA3, ó=0xF3, d, ź=0x9F
    const bytes = new Uint8Array([0xa3, 0xf3, 0x64, 0x9f]);
    expect(decodeBytes(bytes)).toEqual({ text: "Łódź", encoding: "windows-1250" });
  });
});
