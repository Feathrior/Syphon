import { open } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile } from '@tauri-apps/plugin-fs';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface DataFile {
  name: string;
  buffer: ArrayBuffer;
}

const FILTERS = [
  { name: '数据文件 (CSV/Excel)', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'xls'] },
];

function pickFileInBrowser(): Promise<DataFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,.xlsx,.xls';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ name: f.name, buffer: reader.result as ArrayBuffer });
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(f);
    };
    input.click();
  });
}

// 读取 CSV/Excel 数据文件,返回文件名与二进制内容
export async function pickDataFile(): Promise<DataFile | null> {
  if (!isTauri()) return pickFileInBrowser();
  try {
    const file = await open({ multiple: false, filters: FILTERS });
    if (!file) return null;
    const path = file as string;
    const name = path.split(/[\\/]/).pop() ?? 'data';
    const bytes = await readFile(path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return { name, buffer };
  } catch (err) {
    console.error('读取文件失败:', err);
    return null;
  }
}

// 读取纯文本数据文件
export async function pickAndReadTextFile(): Promise<string | null> {
  if (!isTauri()) {
    const f = await pickFileInBrowser();
    return f ? new TextDecoder().decode(f.buffer) : null;
  }
  try {
    const file = await open({ multiple: false, filters: FILTERS });
    if (!file) return null;
    return await readTextFile(file as string);
  } catch (err) {
    console.error('读取文件失败:', err);
    return null;
  }
}

// 读取画布 JSON 文件(.json)
export async function pickJsonFile(): Promise<string | null> {
  if (!isTauri()) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => resolve(null);
        reader.readAsText(f);
      };
      input.click();
    });
  }
  try {
    const file = await open({
      multiple: false,
      filters: [{ name: '画布文件 (JSON)', extensions: ['json'] }],
    });
    if (!file) return null;
    return await readTextFile(file as string);
  } catch (err) {
    console.error('读取画布文件失败:', err);
    return null;
  }
}
