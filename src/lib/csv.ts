// CSV export that opens cleanly in Excel: UTF-8 BOM (so ₹ and Hindi names
// survive), CRLF line ends, and every cell quoted only when it needs to be.

export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, rows: CsvCell[][]) {
  const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 510 minutes -> 8.5 (hours, 2 decimals) — sums correctly in Excel. */
export const hoursDecimal = (minutes: number) => Math.round(((minutes || 0) / 60) * 100) / 100;
