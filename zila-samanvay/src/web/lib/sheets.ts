// Spreadsheet parsing in the browser: CSV (RFC 4180, quotes, CRLF, BOM) and Excel .xlsx
// (first worksheet, shared strings, inline strings, numbers). No server round-trip, no
// heavy dependency — fflate unzips the .xlsx container.

import { unzipSync, strFromU8 } from 'fflate';

export type Grid = string[][];

export function parseCsv(text: string): Grid {
  const s = text.replace(/^﻿/, '');
  const rows: Grid = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseXlsx(buf: ArrayBuffer): Grid {
  const files = unzipSync(new Uint8Array(buf));
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : null);
  const parser = new DOMParser();
  const shared: string[] = [];
  const ss = read('xl/sharedStrings.xml');
  if (ss) {
    const doc = parser.parseFromString(ss, 'application/xml');
    for (const si of Array.from(doc.getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
    }
  }
  // locate the first sheet through the workbook relationships
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const wbDoc = parser.parseFromString(wb, 'application/xml');
    const first = wbDoc.getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const relDoc = parser.parseFromString(rels, 'application/xml');
    for (const r of Array.from(relDoc.getElementsByTagName('Relationship'))) {
      if (r.getAttribute('Id') === rid) {
        const target = r.getAttribute('Target') ?? '';
        sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      }
    }
  }
  const sheet = read(sheetPath);
  if (!sheet) throw new Error('Could not find a worksheet in this Excel file.');
  const doc = parser.parseFromString(sheet, 'application/xml');
  const grid: Grid = [];
  for (const r of Array.from(doc.getElementsByTagName('row'))) {
    const rowIdx = Number(r.getAttribute('r') ?? grid.length + 1) - 1;
    const out: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r') ?? '';
      const idx = ref ? colIndex(ref) : out.length;
      const type = c.getAttribute('t');
      let v = '';
      if (type === 's') v = shared[Number(c.getElementsByTagName('v')[0]?.textContent ?? -1)] ?? '';
      else if (type === 'inlineStr') v = Array.from(c.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('');
      else v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      while (out.length < idx) out.push('');
      out[idx] = v;
    }
    grid[rowIdx] = out;
  }
  return Array.from(grid, (r) => r ?? []).filter((r) => r.some((x) => String(x).trim() !== ''));
}

export async function readSheet(file: File): Promise<Grid> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return parseXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls')) throw new Error('Old .xls format: open it in Excel and "Save As" .xlsx or .csv first.');
  return parseCsv(await file.text());
}
