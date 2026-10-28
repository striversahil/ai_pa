/**
 * CSV helpers for browser downloads.
 *
 * `csvCell` quotes separators/quotes/newlines and neutralises spreadsheet
 * formula injection for TEXT cells. Numbers stay numeric (no tab prefix) so
 * Excel/Sheets can still sum currency/count columns.
 */

export type CsvValue = string | number | null | undefined;

export function csvCell(value: CsvValue): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const raw = value == null ? "" : String(value);
  // A cell starting with = + - @ (after optional whitespace) executes on open
  // in Excel/Sheets — prefix a tab to keep it as text.
  const safe = /^[ \t]*[=+\-@]/.test(raw) ? `\t${raw}` : raw;
  return /[",\n\r\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 BOM + CRLF so Excel opens Indian currency/names correctly. */
export function csvDocument(rows: CsvValue[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, rows: CsvValue[][]): void {
  const blob = new Blob([csvDocument(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
