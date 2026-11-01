/** Escape one CSV field per RFC 4180 (quote when needed, double the quotes). */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Build a CSV document with CRLF line endings so spreadsheets open it cleanly. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((cells) => cells.map(csvEscape).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
