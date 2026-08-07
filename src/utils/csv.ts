import * as XLSX from 'xlsx';
import type { Column } from '../types/data';

// 将 Excel 工作簿(第一个工作表)转换为 CSV 文本
export function excelBufferToCsv(buffer: ArrayBuffer): string {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return '';
  return XLSX.utils.sheet_to_csv(sheet);
}

// 简易 CSV/TSV 解析(支持引号包裹)
export function parseDelimitedText(text: string, delimiter: ',' | '\t' = ','): Column[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const splitLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = !inQuote;
      } else if (ch === delimiter && !inQuote) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  };

  const rows = lines.map(splitLine);
  const width = Math.max(...rows.map((r) => r.length));
  const names: string[] = [];
  for (let c = 0; c < width; c++) {
    const first = (rows[0][c] ?? '').trim();
    const looksHeader = first !== '' && Number.isNaN(Number(first));
    names.push(looksHeader ? first : `列${c + 1}`);
  }
  const hasHeader = rows[0].some((v, c) => names[c] === v.trim() && Number.isNaN(Number(v)));
  const startRow = hasHeader ? 1 : 0;

  const columns: Column[] = names.map((name) => ({ name, values: [] }));
  for (let r = startRow; r < rows.length; r++) {
    for (let c = 0; c < width; c++) {
      const raw = (rows[r][c] ?? '').trim();
      if (raw === '') {
        columns[c].values.push(null);
      } else {
        // 数字字符串转为 Number,非数字字符串(如中文分类标签)保留原始文本。
        // 否则 Number('收入')=NaN 会破坏桑基图等依赖分类列的图表数据。
        const n = Number(raw);
        columns[c].values.push(Number.isNaN(n) ? raw : n);
      }
    }
  }
  return columns;
}

export function buildTableFromColumns(columns: Column[]): Column[] {
  return columns;
}
