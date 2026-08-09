import { describe, expect, it } from "vitest";

import { parseTitleCsv } from "../../src/cli/csv.js";

describe("parseTitleCsv", () => {
  it("parses quoted titles and ignores extra columns", () => {
    expect(
      parseTitleCsv(
        '\uFEFFTitle,year,notes\n"Everything, Everywhere, All at Once",2022,"A favorite"\nArrival,2016,\n',
      ),
    ).toEqual(["Everything, Everywhere, All at Once", "Arrival"]);
  });

  it("rejects files without a title column", () => {
    expect(() => parseTitleCsv("name\nArrival\n")).toThrow(
      'must include a "title" column',
    );
  });

  it("rejects rows with empty titles", () => {
    expect(() => parseTitleCsv("title,year\n,2022\n")).toThrow(
      "row 2 has an empty title",
    );
  });

  it("rejects an empty file", () => {
    expect(() => parseTitleCsv("")).toThrow(
      'must include a "title" column',
    );
  });
});
