// RFC4180-ish CSV parser — needed because UFC_full_data_silver_v2.csv has
// quoted fields with embedded commas and newlines (result_details can be a
// multi-line description). The old seed CSVs never had quotes, so the
// naive split(',') in replay-helpers.mjs was safe for them but silently
// corrupts this file (columns shift whenever a quoted field contains a
// comma or newline).
import { readFileSync } from "node:fs";

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      // skip; \n (handled next) ends the row
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsvObjects(filePath) {
  const text = readFileSync(filePath, "utf-8");
  const rows = parseCsvRows(text);
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => {
      const obj = {};
      header.forEach((h, idx) => (obj[h] = r[idx] ?? ""));
      return obj;
    });
}
