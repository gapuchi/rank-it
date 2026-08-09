import { parse } from "csv-parse/sync";

export function parseTitleCsv(contents: string): readonly string[] {
  let foundTitleColumn = false;

  const records = parse(contents, {
    bom: true,
    columns: (header: string[]) => {
      const columns = header.map((column) => column.trim().toLowerCase());
      foundTitleColumn = columns.includes("title");
      if (!foundTitleColumn) {
        throw new Error('CSV must include a "title" column');
      }
      return columns;
    },
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string | undefined>>;

  if (!foundTitleColumn) {
    throw new Error('CSV must include a "title" column');
  }

  return records.map((record, index) => {
    const title = record.title?.trim() ?? "";
    if (title.length === 0) {
      throw new Error(`CSV row ${index + 2} has an empty title`);
    }
    return title;
  });
}
