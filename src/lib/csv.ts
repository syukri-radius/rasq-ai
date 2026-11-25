/**
 * Shared CSV cell encoding.
 * - Quotes every cell and doubles embedded quotes (RFC 4180).
 * - Neutralizes spreadsheet formula injection: values starting with =, +, -, @, or tab are
 *   prefixed with a single quote. Use this for ANY value that may originate from an
 *   untrusted document (SRS requirements, test cases, audit details, generated scenarios).
 */
export const csvCell = (value: unknown): string => {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** Encode one row (array of cells). */
export const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(",");
