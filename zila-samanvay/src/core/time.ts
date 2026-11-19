// Date helpers. Dates are stored as 'YYYY-MM-DD' strings, timestamps as ISO strings.
// Arithmetic is done on UTC midnights so day counts never drift.

const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date of a Date as YYYY-MM-DD. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function utcMidnight(s: string): number {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, n: number): string {
  const t = new Date(utcMidnight(date) + n * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b - a). Accepts dates or ISO timestamps. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMidnight(b) - utcMidnight(a)) / DAY);
}

/** Financial year (April–March) label for a date, e.g. '2026-27'. */
export function financialYear(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Months of the current FY elapsed at `date`, fractional (e.g. mid-November ≈ 7.5). */
export function fyMonthsElapsed(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const idx = m >= 4 ? m - 4 : m + 8; // April = 0
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return idx + d / daysInMonth;
}

/** FY months up to and including the month of `date`, as 'YYYY-MM'. */
export function fyMonths(date: string): string[] {
  const [y, m] = date.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const out: string[] = [];
  let yy = startYear;
  let mm = 4;
  while (yy < y || (yy === y && mm <= m)) {
    out.push(`${yy}-${pad(mm)}`);
    mm++;
    if (mm > 12) {
      mm = 1;
      yy++;
    }
  }
  return out;
}

/** Months of the FY elapsed at the END of month 'YYYY-MM' (April -> 1). */
export function fyMonthNumber(month: string): number {
  const m = Number(month.slice(5, 7));
  return m >= 4 ? m - 3 : m + 9;
}

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return `${pad(d)}-${MONTH_SHORT[m - 1]}-${y}`;
}

export function fmtMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`;
}
