import type { Column, DataObject, ExecContext, ExecFn } from '../types/data';
import { parseDelimitedText } from '../utils/csv';
import {
  compileFormula,
  cumulativeIntegral,
  derivative,
  exponentialFit,
  histogram,
  linspace,
  linearFit,
  movingAverage,
  polyEval,
  polyFit,
  toNum,
} from '../utils/math';
import { presetScatter, presetSeries, presetTable } from '../utils/sampleData';

export const num = (v: unknown, d: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};

export const str = (v: unknown, d = ''): string => (v === undefined || v === null ? d : String(v));

// ---------- 通用辅助 ----------
function toSeries(obj: DataObject | undefined): [number, number][] | null {
  if (!obj) return null;
  if (obj.kind === 'series') return obj.points;
  if (obj.kind === 'scatter') return obj.points.map((p) => [p[0], p[1] ?? 0]);
  return null;
}

function toTable(obj: DataObject | undefined): Column[] | null {
  if (!obj || obj.kind !== 'table') return null;
  return obj.columns;
}

function firstNumericCols(columns: Column[], count: number): Column[] {
  const out: Column[] = [];
  for (const c of columns) {
    if (c.values.every((v) => v === null || toNum(v) !== null)) {
      out.push(c);
      if (out.length >= count) break;
    }
  }
  return out;
}

function resolveColumns(columns: Column[], spec: string): Column[] {
  const wanted = spec
    .split(/[,，;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Column[] = [];
  for (const w of wanted) {
    const idx = Number(w);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= columns.length) {
      out.push({ ...columns[idx - 1], values: [...columns[idx - 1].values] });
    } else {
      const hit = columns.find((c) => c.name === w);
      if (hit) out.push({ ...hit, values: [...hit.values] });
    }
  }
  return out;
}

function makeSeries(ctx: ExecContext, inId: string): [number, number][] {
  const pts = toSeries(ctx.inputs[inId]);
  if (!pts) throw new Error(`输入 ${inId} 不是曲线/散点`);
  return pts;
}

// ---------- 组输入节点 ----------
const execTableInput: ExecFn = ({ params }) => {
  const mode = str(params.mode, 'preset');
  if (mode === 'manual') {
    const text = str(params.dataText, '');
    if (!text.trim()) throw new Error('未提供数据文本');
    const delimiter = str(params.delimiter, 'csv') === 'tsv' ? '\t' : ',';
    return { out0: { kind: 'table', columns: parseDelimitedText(text, delimiter) } };
  }
  return { out0: { kind: 'table', columns: presetTable(str(params.preset, 'phys')) } };
};

// ---------- 坐标系(厘米制虚拟尺寸) ----------
/** 坐标系预设:提供基础轴样式。单独设置的字段仅在用户自定义(与"默认"预设不同)时覆盖预设值 */
const AXIS_PRESETS: Record<
  string,
  {
    colorX: string;
    colorY: string;
    colorZ: string;
    widthX: number;
    widthY: number;
    widthZ: number;
    gridX: boolean;
    gridY: boolean;
    gridZ: boolean;
    border: boolean;
  }
> = {
  default: { colorX: '#333333', colorY: '#333333', colorZ: '#333333', widthX: 0.12, widthY: 0.12, widthZ: 0.12, gridX: true, gridY: true, gridZ: true, border: true },
  math: { colorX: '#111111', colorY: '#111111', colorZ: '#111111', widthX: 0.08, widthY: 0.08, widthZ: 0.08, gridX: true, gridY: true, gridZ: true, border: true },
  engineering: { colorX: '#1f77b4', colorY: '#2ca02c', colorZ: '#d62728', widthX: 0.16, widthY: 0.16, widthZ: 0.16, gridX: true, gridY: true, gridZ: true, border: true },
  minimal: { colorX: '#666666', colorY: '#666666', colorZ: '#666666', widthX: 0.08, widthY: 0.08, widthZ: 0.08, gridX: false, gridY: false, gridZ: false, border: true },
  borderless: { colorX: '#333333', colorY: '#333333', colorZ: '#333333', widthX: 0.12, widthY: 0.12, widthZ: 0.12, gridX: true, gridY: true, gridZ: true, border: false },
};

const execAxis: ExecFn = ({ params }) => {
  const name = str(params.name, '坐标系');
  const dim = str(params.dim, '3d') === '2d' ? 2 : 3;
  // 厘米制虚拟尺寸:只定义比例关系,与画布实际像素数量无关
  const xLen = Math.max(0.5, num(params.xLen, 16));
  const yLen = Math.max(0.5, num(params.yLen, 10));
  const zLen = Math.max(0.5, num(params.zLen, 8));
  const grid = params.grid !== false;
  // 数据范围(x/y 起始与结束数字,支持 10→100 等任意区间)
  let xMin = num(params.xStart, 0);
  let xMax = num(params.xEnd, 10);
  let yMin = num(params.yStart, 0);
  let yMax = num(params.yEnd, 10);
  let zMin = num(params.zStart, -5);
  let zMax = num(params.zEnd, 5);
  if (xMax - xMin < 1e-9) xMax = xMin + 1;
  if (yMax - yMin < 1e-9) yMax = yMin + 1;
  if (zMax - zMin < 1e-9) zMax = zMin + 1;
  const axisOrigin = str(params.axisOrigin, 'origin') === 'left' ? 'left' : 'origin';
  const labelX = str(params.labelX, 'X') || 'X';
  const labelY = str(params.labelY, 'Y') || 'Y';
  const labelZ = str(params.labelZ, 'Z') || 'Z';

  // 预设作为基础样式,单独字段(与"默认"预设不同即视为已自定义)覆盖预设
  const base = AXIS_PRESETS[str(params.axisPreset, 'default')] ?? AXIS_PRESETS.default;
  const pick = <K extends keyof typeof AXIS_PRESETS.default>(v: unknown, key: K) =>
    v !== undefined && v !== AXIS_PRESETS.default[key] ? (v as (typeof AXIS_PRESETS.default)[K]) : base[key];
  const showBorder = pick(params.showBorder, 'border') !== false;
  const colorX = String(pick(params.axisColorX, 'colorX'));
  const colorY = String(pick(params.axisColorY, 'colorY'));
  const colorZ = String(pick(params.axisColorZ, 'colorZ'));
  const widthX = Math.max(0.02, num(pick(params.axisWidthX, 'widthX'), 0.12));
  const widthY = Math.max(0.02, num(pick(params.axisWidthY, 'widthY'), 0.12));
  const widthZ = Math.max(0.02, num(pick(params.axisWidthZ, 'widthZ'), 0.12));
  const gridX = pick(params.gridX, 'gridX') !== false;
  const gridY = pick(params.gridY, 'gridY') !== false;
  const gridZ = pick(params.gridZ, 'gridZ') !== false;

  const fontSize = Math.max(6, Math.min(24, num(params.fontSize, 10)));
  const fontFamily = str(params.fontFamily, 'sans-serif');
  // 轴末端箭头开关(X/Y)
  const arrowX = params.arrowX !== false;
  const arrowY = params.arrowY !== false;

  return {
    out0: {
      kind: 'axes',
      name,
      dim,
      xLen,
      yLen,
      zLen,
      xMin,
      xMax,
      yMin,
      yMax,
      zMin,
      zMax,
      grid,
      axisOrigin,
      showBorder,
      labelX,
      labelY,
      labelZ,
      axisColors: { x: colorX, y: colorY, z: colorZ },
      axisWidths: { x: widthX, y: widthY, z: widthZ },
      gridX,
      gridY,
      gridZ,
      fontSize,
      fontFamily,
      axisPreset: str(params.axisPreset, 'default'),
      arrows: { x: arrowX, y: arrowY },
    },
  };
};

const execLineInput: ExecFn = ({ params }) => {
  const name = str(params.name, '线');
  const mode = str(params.mode, 'parametric');
  if (mode === 'points') {
    const raw = str(params.pointsText, '');
    const pts = raw
      .split('\n')
      .map((l) => l.split(/[,，\t;；\s]+/).filter(Boolean))
      .filter((r) => r.length >= 2)
      .map((r) => [Number(r[0]), Number(r[1])])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) as [number, number][];
    if (pts.length === 0) throw new Error('未解析到有效点(格式:每行 x,y)');
    return { out0: { kind: 'series', name, points: pts } };
  }
  const start = num(params.start, 0);
  const end = num(params.end, 10);
  const count = Math.max(2, Math.round(num(params.count, 200)));
  const xs = linspace(start, end, count);
  const fx = compileFormula(str(params.fx, 'x'));
  const fy = compileFormula(str(params.fy, 'sin(x)'));
  const points = xs
    .map((x) => [fx ? fx(x, 0) : x, fy ? fy(x, 0) : 0])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) as [number, number][];
  return { out0: { kind: 'series', name, points } };
};

function genMesh(params: Record<string, unknown>): DataObject {
  const name = str(params.name, '面');
  const geo = str(params.geometry, 'plane');
  const nu = Math.max(2, Math.round(num(params.nu, 24)));
  const nv = Math.max(2, Math.round(num(params.nv, 24)));
  const r1 = num(params.radius, 2);
  const r2 = num(params.radius2, 0.8);
  const verts: [number, number, number][] = [];
  const faces: [number, number, number][] = [];
  const idx = (i: number, j: number) => i * (nv + 1) + j;
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      if (geo === 'sphere') {
        const theta = u * Math.PI;
        const phi = v * 2 * Math.PI;
        verts.push([
          r1 * Math.sin(theta) * Math.cos(phi),
          r1 * Math.cos(theta),
          r1 * Math.sin(theta) * Math.sin(phi),
        ]);
      } else if (geo === 'torus') {
        const theta = u * 2 * Math.PI;
        const phi = v * 2 * Math.PI;
        verts.push([
          (r1 + r2 * Math.cos(phi)) * Math.cos(theta),
          (r1 + r2 * Math.cos(phi)) * Math.sin(theta),
          r2 * Math.sin(phi),
        ]);
      } else {
        verts.push([(u * 2 - 1) * r1, (v * 2 - 1) * r1, 0]);
      }
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = idx(i, j);
      const b = idx(i, j + 1);
      const c = idx(i + 1, j + 1);
      const d = idx(i + 1, j);
      faces.push([a, b, c], [a, c, d]);
    }
  }
  return { kind: 'mesh', name, vertices: verts, faces };
}

const execFaceInput: ExecFn = ({ params }) => ({ out0: genMesh(params) });

const execGridInput: ExecFn = ({ params }) => {
  const name = str(params.name, '网格');
  const nx = Math.max(2, Math.round(num(params.nx, 40)));
  const ny = Math.max(2, Math.round(num(params.ny, 40)));
  const xmin = num(params.xmin, -4);
  const xmax = num(params.xmax, 4);
  const ymin = num(params.ymin, -4);
  const ymax = num(params.ymax, 4);
  const f = compileFormula(str(params.formula, 'sin(sqrt(x*x+y*y))'));
  const x = linspace(xmin, xmax, nx);
  const y = linspace(ymin, ymax, ny);
  const values = y.map((yi) => x.map((xi) => (f ? f(xi, yi) : NaN)));
  return { out0: { kind: 'grid', name, x, y, values } };
};

const execScatterInput: ExecFn = ({ params }) => {
  // 聚合点输入:每个点独立设置 x/y、大小、形状、颜色
  const name = str(params.name, '聚合点');
  const raw = Array.isArray(params.points) ? params.points : [];
  const numOrUndef = (v: unknown): number | string | undefined =>
    typeof v === 'number' || typeof v === 'string' ? v : undefined;
  const pts = raw
    .map((p) => {
      const rec = p as { x?: unknown; y?: unknown; size?: unknown; shape?: unknown; color?: unknown };
      return {
        x: toNum(numOrUndef(rec.x)),
        y: toNum(numOrUndef(rec.y)),
        size: toNum(numOrUndef(rec.size)),
        shape: str(rec.shape, 'circle'),
        color: str(rec.color, '#1f77b4'),
      };
    })
    .filter(
      (p): p is { x: number; y: number; size: number | null; shape: string; color: string } =>
        p.x !== null && p.y !== null
    );
  if (pts.length === 0) throw new Error('请添加点(至少一个有效点)');
  const points: [number, number, number?][] = pts.map((p) => [Number(p.x.toFixed(5)), Number(p.y.toFixed(5))]);
  const out: DataObject = { kind: 'scatter', name, points };
  if (pts.some((p) => p.size !== null && Number(p.size) !== 4)) {
    out.sizes = pts.map((p) => Math.max(0.5, Number(p.size) || 4));
  }
  if (pts.some((p) => p.shape && p.shape !== 'circle')) {
    out.shapes = pts.map((p) => (p.shape === 'square' || p.shape === 'diamond' || p.shape === 'triangle' ? p.shape : 'circle'));
  }
  if (pts.some((p) => p.color && p.color !== '#1f77b4')) {
    out.colors = pts.map((p) => p.color || '#1f77b4');
  }
  return { out0: out };
};

/** 函数曲线:输入 y=f(x) 表达式,输出采样曲线 */
const execFuncCurve: ExecFn = ({ params }) => {
  const name = str(params.name, '函数曲线');
  const expr = str(params.expression, 'sin(x)');
  const f = compileFormula(expr);
  if (!f) throw new Error(`表达式无效:${expr}`);
  const xMin = num(params.xMin, 0);
  const xMax = num(params.xMax, 10);
  if (xMax <= xMin) throw new Error('X 结束需大于 X 起始');
  const samples = Math.max(2, Math.round(num(params.samples, 200)));
  const xs = linspace(xMin, xMax, samples);
  const points = xs
    .map((x) => [x, f(x, 0)])
    .filter((p) => Number.isFinite(p[1]))
    .map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]) as [number, number][];
  if (points.length === 0) throw new Error('函数在此范围内无有效值');
  return { out0: { kind: 'series', name, points } };
};

const execSeriesInput: ExecFn = ({ params }) => {
  return { out0: presetSeries(str(params.preset, 'quadratic')) };
};

// ---------- 数据初步节点 ----------
const execClean: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const fillMode = str(params.fillMissing, 'none');
  const dropMissing = !!params.dropMissing;
  const dedupe = !!params.dedupe;

  let columns = cols.map((c) => ({ name: c.name, values: [...c.values] }));

  // 按列填充缺失值
  if (fillMode !== 'none') {
    columns = columns.map((col) => {
      const vals = col.values;
      if (fillMode === 'zero') {
        return { ...col, values: vals.map((v) => (v === null ? 0 : v)) };
      }
      const nums = vals.map(toNum);
      const present = nums.filter((v): v is number => v !== null);
      const mean = present.length ? present.reduce((s, v) => s + v, 0) / present.length : 0;
      if (fillMode === 'mean') {
        return { ...col, values: vals.map((v) => (v === null ? Number(mean.toFixed(4)) : v)) };
      }
      // 线性插值
      const out: (number | string | null)[] = [...vals];
      let prevIdx = -1;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] !== null) {
          if (prevIdx >= 0 && i - prevIdx > 1) {
            const a = toNum(vals[prevIdx]) ?? 0;
            const b = toNum(vals[i]) ?? a;
            for (let k = prevIdx + 1; k < i; k++) {
              out[k] = Number((a + ((b - a) * (k - prevIdx)) / (i - prevIdx)).toFixed(4));
            }
          }
          prevIdx = i;
        }
      }
      for (let i = 0; i < out.length; i++) if (out[i] === null) out[i] = mean;
      return { ...col, values: out };
    });
  }

  const rowCount = columns[0]?.values.length ?? 0;
  const keep: number[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < rowCount; r++) {
    const rowMissing = columns.some((c) => toNum(c.values[r]) === null);
    if (dropMissing && rowMissing) continue;
    const key = columns.map((c) => String(c.values[r])).join('\u0001');
    if (dedupe && seen.has(key)) continue;
    if (dedupe) seen.add(key);
    keep.push(r);
  }
  return {
    out0: {
      kind: 'table',
      columns: columns.map((c) => ({
        name: c.name,
        values: keep.map((r) => c.values[r]),
      })),
    },
  };
};

const execNormalize: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const method = str(params.method, 'minmax');
  const spec = str(params.columns, '');
  const targets = spec
    ? resolveColumns(cols, spec).map((c) => c.name)
    : cols.map((c) => c.name).filter((n) => cols.find((c) => c.name === n)?.values.every((v) => toNum(v) !== null));
  const columns = cols.map((col) => {
    if (!targets.includes(col.name)) return { ...col, values: [...col.values] };
    const nums = col.values.map(toNum);
    const present = nums.filter((v): v is number => v !== null);
    let fn: (v: number | null) => number | null = (v) => v;
    if (present.length > 0) {
      if (method === 'zscore') {
        const mean = present.reduce((s, v) => s + v, 0) / present.length;
        const std = Math.sqrt(present.reduce((s, v) => s + (v - mean) ** 2, 0) / present.length) || 1;
        fn = (v) => (v === null ? null : Number(((v - mean) / std).toFixed(5)));
      } else {
        const mn = Math.min(...present);
        const mx = Math.max(...present);
        const span = mx - mn || 1;
        fn = (v) => (v === null ? null : Number(((v - mn) / span).toFixed(5)));
      }
    }
    return { name: col.name, values: col.values.map((v) => fn(toNum(v))) };
  });
  return { out0: { kind: 'table', columns } };
};

const execFilter: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const colName = str(params.column, cols[0]?.name ?? '');
  const col = cols.find((c) => c.name === colName);
  if (!col) throw new Error(`找不到列:${colName}`);
  const minS = str(params.min, '');
  const maxS = str(params.max, '');
  const hasMin = minS !== '' && Number.isFinite(Number(minS));
  const hasMax = maxS !== '' && Number.isFinite(Number(maxS));
  const mn = Number(minS);
  const mx = Number(maxS);
  const keep: number[] = [];
  col.values.forEach((v, r) => {
    const n = toNum(v);
    if (n === null) return;
    if (hasMin && n < mn) return;
    if (hasMax && n > mx) return;
    keep.push(r);
  });
  return {
    out0: {
      kind: 'table',
      columns: cols.map((c) => ({ name: c.name, values: keep.map((r) => c.values[r]) })),
    },
  };
};

const execSample: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const method = str(params.method, 'first');
  const count = Math.max(0, Math.round(num(params.count, 20)));
  const rowCount = cols[0]?.values.length ?? 0;
  let keep: number[] = [];
  if (method === 'every') {
    const step = Math.max(1, Math.round(num(params.step, 2)));
    for (let r = 0; r < rowCount; r += step) keep.push(r);
  } else if (method === 'random') {
    const all = Array.from({ length: rowCount }, (_, i) => i);
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    keep = all.slice(0, Math.min(count, rowCount)).sort((a, b) => a - b);
  } else {
    keep = Array.from({ length: Math.min(count, rowCount) }, (_, i) => i);
  }
  return {
    out0: {
      kind: 'table',
      columns: cols.map((c) => ({ name: c.name, values: keep.map((r) => c.values[r]) })),
    },
  };
};

// ---------- 数据运算节点 ----------
const execDerivative: ExecFn = (ctx) => {
  const pts = makeSeries(ctx, 'in0');
  const name = str(ctx.params.name, '导数');
  return {
    out0: {
      kind: 'series',
      name,
      points: derivative(pts).map((p) => [Number(p.x.toFixed(6)), Number(p.y.toFixed(6))]),
    },
  };
};

const execIntegral: ExecFn = (ctx) => {
  const pts = makeSeries(ctx, 'in0');
  return {
    out0: {
      kind: 'series',
      name: str(ctx.params.name, '积分'),
      points: cumulativeIntegral(pts).map((p) => [Number(p.x.toFixed(6)), Number(p.y.toFixed(6))]),
    },
  };
};

const execFit: ExecFn = (ctx) => {
  const pts = makeSeries(ctx, 'in0');
  if (pts.length < 3) throw new Error('数据点过少,无法拟合');
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const method = str(ctx.params.method, 'linear');
  const name = str(ctx.params.name, '拟合曲线');
  let coeffs: number[] = [];
  let desc = '';
  if (method === 'exponential') {
    const ef = exponentialFit(xs, ys);
    if (!ef) throw new Error('指数拟合失败(需要 y>0)');
    desc = `y = ${ef.a.toFixed(4)} · e^(${ef.b.toFixed(4)}·x), R²=${ef.r2.toFixed(4)}`;
    const f = (x: number) => ef.a * Math.exp(ef.b * x);
    const out = linspace(Math.min(...xs), Math.max(...xs), 200).map((x) => [Number(x.toFixed(4)), Number(f(x).toFixed(5))]);
    return {
      out0: { kind: 'series', name, points: out as [number, number][] },
      out1: {
        kind: 'table',
        columns: [
          { name: '参数', values: ['a', 'b', 'R²'] },
          { name: '值', values: [ef.a.toFixed(4), ef.b.toFixed(4), ef.r2.toFixed(4)] },
        ],
      },
    };
  }
  const degree = Math.round(num(ctx.params.degree, 1));
  coeffs = polyFit(xs, ys, degree);
  desc = `y = ${coeffs
    .map((c, i) => `${c.toFixed(4)}·x^${i}`)
    .reverse()
    .join(' + ')}`;
  const out = linspace(Math.min(...xs), Math.max(...xs), 200).map((x) => [
    Number(x.toFixed(4)),
    Number(polyEval(coeffs, x).toFixed(5)),
  ]);
  const r2 = (() => {
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < ys.length; i++) {
      ssRes += (ys[i] - polyEval(coeffs, xs[i])) ** 2;
      ssTot += (ys[i] - my) ** 2;
    }
    return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  })();
  desc += `  R²=${r2.toFixed(4)}`;
  return {
    out0: { kind: 'series', name, points: out as [number, number][] },
    out1: {
      kind: 'table',
      columns: [
        { name: '参数', values: coeffs.map((_, i) => `c${i}`) },
        { name: '值', values: coeffs.map((c) => Number(c.toFixed(6))) },
      ],
    },
  };
};

const execSmooth: ExecFn = (ctx) => {
  const pts = makeSeries(ctx, 'in0');
  const window = Math.max(1, Math.round(num(ctx.params.window, 5)));
  return {
    out0: {
      kind: 'series',
      name: str(ctx.params.name, '平滑曲线'),
      points: movingAverage(pts, window),
    },
  };
};

const execFormula: ExecFn = (ctx) => {
  const pts = makeSeries(ctx, 'in0');
  const expr = str(ctx.params.expression, 'y');
  const f = compileFormula(expr);
  if (!f) throw new Error(`表达式无效:${expr}`);
  return {
    out0: {
      kind: 'series',
      name: str(ctx.params.name, `f(x)=${expr}`),
      points: pts.map((p) => {
        const v = f(p[0], p[1]);
        if (!Number.isFinite(v)) throw new Error('表达式计算失败');
        return [Number(p[0].toFixed(6)), Number(v.toFixed(6))];
      }),
    },
  };
};

// ---------- 暴露参数(接入数据列 → 逐点属性) ----------
/** 从任意数据对象中提取一行一个的数值序列(表格取首列,曲线/散点取 y) */
function exposedValues(obj: DataObject | undefined): number[] | null {
  if (!obj) return null;
  if (obj.kind === 'table') {
    const first = obj.columns[0];
    if (!first) return null;
    const vals = first.values
      .map(toNum)
      .filter((v): v is number => v !== null);
    return vals.length ? vals : null;
  }
  if (obj.kind === 'series') return obj.points.map((p) => p[1]);
  if (obj.kind === 'scatter') return obj.points.map((p) => p[1] ?? 0);
  if (obj.kind === 'grid') {
    const flat = obj.values
      .flat()
      .map(toNum)
      .filter((v): v is number => v !== null);
    return flat.length ? flat : null;
  }
  if (obj.kind === 'distribution') return obj.bins.map((b) => b.count);
  if (obj.kind === 'mesh') return obj.vertices.map((v) => Math.hypot(v[0], v[1], v[2]));
  return null;
}

/** 归一化到 [0,1](成正比) */
function norm01(values: number[]): number[] {
  const max = Math.max(...values);
  if (!Number.isFinite(max) || max <= 0) return values.map(() => 1);
  return values.map((v) => Math.max(0, Math.min(1, v / max)));
}

/** 数值 → 颜色(蓝→红渐变) */
function valueColor(t: number): string {
  const hue = Math.round(210 - 210 * t);
  return `hsl(${hue}, 75%, 55%)`;
}

// ---------- 数据转化节点 ----------
const execExtractColumns: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const columns = resolveColumns(cols, str(params.columns, '1,2'));
  if (columns.length === 0) throw new Error('未匹配到列');
  return { out0: { kind: 'table', columns } };
};

const execExtractRows: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const start = Math.max(0, Math.round(num(params.start, 0)));
  const end = Math.max(start, Math.round(num(params.end, 0)));
  const step = Math.max(1, Math.round(num(params.step, 1)));
  const keep: number[] = [];
  for (let r = start; r <= end && r < (cols[0]?.values.length ?? 0); r += step) keep.push(r);
  return {
    out0: {
      kind: 'table',
      columns: cols.map((c) => ({ name: c.name, values: keep.map((r) => c.values[r]) })),
    },
  };
};

const execTableToScatter: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const numeric = firstNumericCols(cols, 3);
  const xCol = cols.find((c) => c.name === str(params.xCol, '')) ?? numeric[0];
  const yCol = cols.find((c) => c.name === str(params.yCol, '')) ?? numeric[1] ?? numeric[0];
  if (!xCol || !yCol) throw new Error('请选择 x/y 列');
  const zCol = params.zCol ? cols.find((c) => c.name === String(params.zCol)) : undefined;
  // 暴露参数:接入数据列后逐点大小/颜色与对应行数值成正比
  const sizeVals = exposedValues(inputs.exp_pointSize);
  const colorVals = exposedValues(inputs.exp_pointColor);
  const normSize = sizeVals ? norm01(sizeVals) : null;
  const normColor = colorVals ? norm01(colorVals) : null;
  const baseSize = Math.max(1, num(params.pointSize, 4));
  const baseColor = str(params.pointColor, '#1f77b4');
  const shape = str(params.pointShape, 'circle') as 'circle' | 'square' | 'diamond' | 'triangle';
  const points: [number, number, number?][] = [];
  const sizes: number[] = [];
  const colors: string[] = [];
  const n = Math.max(xCol.values.length, yCol.values.length);
  for (let i = 0; i < n; i++) {
    const x = toNum(xCol.values[i]);
    const y = toNum(yCol.values[i]);
    if (x === null || y === null) continue;
    const z = zCol ? toNum(zCol.values[i]) : undefined;
    if (zCol && z === null) continue;
    points.push([Number(x.toFixed(5)), Number(y.toFixed(5)), z === undefined || z === null ? undefined : Number(z.toFixed(5))]);
    if (normSize) sizes.push(baseSize * Math.max(0.3, normSize[i] ?? 0.5));
    if (normColor) colors.push(valueColor(normColor[i] ?? 0));
  }
  const out: DataObject = {
    kind: 'scatter',
    name: str(params.name, '散点'),
    points,
    pointSize: baseSize,
    pointColor: baseColor,
    pointShape: shape,
  };
  if (sizes.length) out.sizes = sizes;
  if (colors.length) out.colors = colors;
  return { out0: out };
};

const execTableToSeries: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const numeric = firstNumericCols(cols, 2);
  const xCol = cols.find((c) => c.name === str(params.xCol, '')) ?? numeric[0];
  const yCol = cols.find((c) => c.name === str(params.yCol, '')) ?? numeric[1] ?? numeric[0];
  if (!xCol || !yCol) throw new Error('请选择 x/y 列');
  const widthVals = exposedValues(inputs.exp_lineWidth);
  const colorVals = exposedValues(inputs.exp_lineColor);
  const normW = widthVals ? norm01(widthVals) : null;
  const normC = colorVals ? norm01(colorVals) : null;
  const baseW = Math.max(0.5, num(params.lineWidth, 2));
  const baseC = str(params.lineColor, '#ff7f0e');
  const style = str(params.lineStyle, 'solid') === 'dashed' ? 'dashed' : 'solid';
  const points: [number, number][] = [];
  const sizes: number[] = [];
  const colors: string[] = [];
  for (let i = 0; i < xCol.values.length; i++) {
    const x = toNum(xCol.values[i]);
    const y = toNum(yCol.values[i]);
    if (x === null || y === null) continue;
    points.push([Number(x.toFixed(5)), Number(y.toFixed(5))]);
    if (normW) sizes.push(baseW * Math.max(0.3, normW[i] ?? 0.5));
    if (normC) colors.push(valueColor(normC[i] ?? 0));
  }
  const out: DataObject = {
    kind: 'series',
    name: str(params.name, '曲线'),
    points,
    lineWidth: baseW,
    lineColor: baseC,
    lineStyle: style,
  };
  if (sizes.length) out.sizes = sizes;
  if (colors.length) out.colors = colors;
  return { out0: out };
};

const execTableToDistribution: ExecFn = ({ params, inputs }) => {
  const cols = toTable(inputs.in0);
  if (!cols) throw new Error('缺少表格输入');
  const col = cols.find((c) => c.name === str(params.column, cols[0]?.name));
  if (!col) throw new Error('请选择数据列');
  const values = col.values
    .map(toNum)
    .filter((v): v is number => v !== null);
  if (values.length === 0) throw new Error('该列无数值数据');
  const bins = histogram(values, Math.round(num(params.bins, 20)));
  return {
    out0: {
      kind: 'distribution',
      name: str(params.name, `${col.name} 分布`),
      bins,
      sampleCount: values.length,
    },
  };
};

const execSeriesToScatter: ExecFn = (ctx) => {
  const pts = makeSeries(ctx, 'in0');
  // 暴露参数:接入数据列后逐点大小/颜色与数值成正比
  const sizeVals = exposedValues(ctx.inputs.exp_pointSize);
  const colorVals = exposedValues(ctx.inputs.exp_pointColor);
  const normSize = sizeVals ? norm01(sizeVals) : null;
  const normColor = colorVals ? norm01(colorVals) : null;
  const baseSize = Math.max(1, num(ctx.params.pointSize, 4));
  const baseColor = str(ctx.params.pointColor, '#1f77b4');
  const shape = str(ctx.params.pointShape, 'circle') as 'circle' | 'square' | 'diamond' | 'triangle';
  const sizes: number[] = [];
  const colors: string[] = [];
  pts.forEach((p, i) => {
    if (normSize) sizes.push(baseSize * Math.max(0.3, normSize[i] ?? 0.5));
    if (normColor) colors.push(valueColor(normColor[i] ?? 0));
  });
  const out: DataObject = {
    kind: 'scatter',
    name: str(ctx.params.name, '散点'),
    points: pts.map((p) => [p[0], p[1]]),
    pointSize: baseSize,
    pointColor: baseColor,
    pointShape: shape,
  };
  if (sizes.length) out.sizes = sizes;
  if (colors.length) out.colors = colors;
  return { out0: out };
};

const execLinearFitDirect: ExecFn = (ctx) => {
  const pts = makeSeries(ctx, 'in0');
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const fit = linearFit(xs, ys);
  const f = (x: number) => fit.a + fit.b * x;
  const out = linspace(Math.min(...xs), Math.max(...xs), 200).map((x) => [Number(x.toFixed(4)), Number(f(x).toFixed(5))]);
  return {
    out0: { kind: 'series', name: '线性回归', points: out as [number, number][] },
    out1: {
      kind: 'table',
      columns: [
        { name: '参数', values: ['a(截距)', 'b(斜率)', 'R²'] },
        { name: '值', values: [Number(fit.a.toFixed(5)), Number(fit.b.toFixed(5)), Number(fit.r2.toFixed(5))] },
      ],
    },
  };
};

export const EXEC: Record<string, ExecFn> = {
  table_input: execTableInput,
  axis_input: execAxis,
  line_input: execLineInput,
  face_input: execFaceInput,
  grid_input: execGridInput,
  scatter_input: execScatterInput,
  series_input: execSeriesInput,
  func_curve: execFuncCurve,
  clean: execClean,
  normalize: execNormalize,
  filter: execFilter,
  sample: execSample,
  derivative: execDerivative,
  integral: execIntegral,
  fit: execFit,
  linreg: execLinearFitDirect,
  smooth: execSmooth,
  formula: execFormula,
  extract_columns: execExtractColumns,
  extract_rows: execExtractRows,
  table_to_scatter: execTableToScatter,
  table_to_series: execTableToSeries,
  table_to_distribution: execTableToDistribution,
  series_to_scatter: execSeriesToScatter,
};
