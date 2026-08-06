import { memo, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { Column, DataMap, DataObject, NodeConfig } from '../types/data';
import { presetColors } from '../types/data';
import { useGraph } from '../store/useGraph';
import { toNum } from '../utils/math';

// ==================== 预制可视化 ====================

function numericCols(table: Extract<DataMap[string], { kind: 'table' }>): Column[] {
  return table.columns.filter((c) =>
    c.values.every((v) => v === null || toNum(v) !== null)
  );
}

function pick(table: Extract<DataMap[string], { kind: 'table' }>, name: string, fallback: number): Column | undefined {
  if (name) {
    const hit = table.columns.find((c) => c.name === name);
    if (hit) return hit;
  }
  const numeric = table.columns.filter((c) => c.values.every((v) => v === null || toNum(v) !== null));
  if (numeric.length > fallback) return numeric[fallback];
  return table.columns[fallback] ?? table.columns[0];
}

function isCategoryCol(col: Column | undefined): boolean {
  if (!col) return false;
  const n = Math.min(20, col.values.length);
  let strCount = 0;
  for (let i = 0; i < n; i++) {
    const v = col.values[i];
    if (typeof v === 'string' && toNum(v) === null) strCount++;
  }
  return strCount > n / 2;
}

function buildPresetOption(params: Record<string, unknown>, inputs: DataMap): echarts.EChartsOption {
  const chartType = String(params.chartType ?? 'scatter');
  const title = String(params.title ?? '');
  const table = inputs.in0?.kind === 'table' ? inputs.in0 : undefined;
  const scatter = inputs.in1;
  const series = inputs.in2;
  const baseTitle = title ? { text: title, textStyle: { fontSize: 13 } } : undefined;

  // 散点图
  if (chartType === 'scatter') {
    if (scatter && scatter.kind === 'scatter') {
      const pts = scatter.points.slice(0, 4000);
      const hasZ = pts.some((p) => typeof p[2] === 'number');
      const data = hasZ
        ? pts.map((p) => ({
            value: [p[0], p[1]],
            itemStyle: { color: `hsl(${(210 + (p[2] ?? 0) * 60) % 360},70%,60%)` },
          }))
        : pts.map((p) => [p[0], p[1]]);
      return {
        backgroundColor: 'transparent',
        title: baseTitle,
        tooltip: { trigger: 'item' },
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: [{ type: 'scatter', data, symbolSize: 7 }],
      };
    }
    if (table) {
      const xCol = pick(table, String(params.xCol ?? ''), 0);
      const yCol = pick(table, String(params.yCol ?? ''), 1);
      const data: [number, number][] = [];
      for (let i = 0; i < Math.min(table.columns[0].values.length, 5000); i++) {
        const x = toNum(xCol?.values[i]);
        const y = toNum(yCol?.values[i]);
        if (x !== null && y !== null) data.push([x, y]);
      }
      return {
        backgroundColor: 'transparent',
        title: baseTitle,
        tooltip: { trigger: 'item' },
        grid: { left: 45, right: 20, top: 30, bottom: 40 },
        xAxis: { type: 'value', name: xCol?.name ?? 'X' },
        yAxis: { type: 'value', name: yCol?.name ?? 'Y' },
        series: [{ type: 'scatter', data, symbolSize: 7 }],
      };
    }
  }

  // 折线图
  if (chartType === 'line') {
    let cats: string[] = [];
    let vals: number[] = [];
    if (series && series.kind === 'series') {
      cats = series.points.map((p) => String(p[0]));
      vals = series.points.map((p) => p[1]);
    } else if (table) {
      const xCol = pick(table, String(params.xCol ?? ''), 0);
      const yCol = pick(table, String(params.yCol ?? ''), 1);
      const cat = isCategoryCol(xCol);
      for (let i = 0; i < table.columns[0].values.length; i++) {
        const y = toNum(yCol?.values[i]);
        if (y === null) continue;
        cats.push(cat ? String(xCol?.values[i] ?? i) : String(toNum(xCol?.values[i]) ?? i));
        vals.push(y);
      }
    }
    return {
      backgroundColor: 'transparent',
      title: baseTitle,
      tooltip: { trigger: 'axis' },
      grid: { left: 45, right: 20, top: 30, bottom: 40 },
      xAxis: { type: 'category', data: cats },
      yAxis: { type: 'value' },
      series: [{ type: 'line', data: vals, symbolSize: 3, lineStyle: { width: 2 } }],
    };
  }

  // 柱状图
  if (chartType === 'bar') {
    if (table) {
      const numeric = numericCols(table);
      const yCol = pick(table, String(params.yCol ?? ''), numeric[0]?.name ? -1 : 0);
      const target = yCol && numeric.some((c) => c.name === yCol.name) ? yCol : numeric[0];
      const xCol = pick(table, String(params.xCol ?? ''), 0);
      const cat = isCategoryCol(xCol);
      const cats: string[] = [];
      const vals: number[] = [];
      for (let i = 0; i < table.columns[0].values.length; i++) {
        const v = toNum(target?.values[i]);
        if (v === null) continue;
        cats.push(cat ? String(xCol?.values[i] ?? i) : String(i));
        vals.push(v);
      }
      return {
        backgroundColor: 'transparent',
        title: baseTitle,
        tooltip: { trigger: 'axis' },
        grid: { left: 45, right: 20, top: 30, bottom: 40 },
        xAxis: { type: 'category', data: cats },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: vals, itemStyle: { color: '#3b82f6' } }],
      };
    }
  }

  // 火山图
  if (chartType === 'volcano') {
    if (table) {
      const fcCol = pick(table, String(params.fcCol ?? 'log2FC'), 0);
      const pCol = pick(table, String(params.pCol ?? 'pvalue'), 1);
      const data: { value: [number, number]; itemStyle: { color: string } }[] = [];
      for (let i = 0; i < table.columns[0].values.length; i++) {
        const fc = toNum(fcCol?.values[i]);
        const p = toNum(pCol?.values[i]);
        if (fc === null || p === null || p <= 0) continue;
        const negLog = -Math.log10(p);
        const color =
          Math.abs(fc) > 1 && p < 0.05 ? '#ef4444' : p < 0.05 ? '#f59e0b' : '#64748b';
        data.push({ value: [fc, negLog], itemStyle: { color } });
      }
      return {
        backgroundColor: 'transparent',
        title: { text: title || '火山图', textStyle: { fontSize: 13 } },
        tooltip: { trigger: 'item' },
        grid: { left: 50, right: 20, top: 30, bottom: 40 },
        xAxis: { type: 'value', name: fcCol?.name ?? 'log2FC' },
        yAxis: { type: 'value', name: `-log10(${pCol?.name ?? 'p'})` },
        series: [
          {
            type: 'scatter',
            data,
            symbolSize: 6,
            markLine: {
              symbol: 'none',
              lineStyle: { type: 'dashed', color: '#475569' },
              label: { show: false },
              data: [
                { xAxis: 1 },
                { xAxis: -1 },
                { yAxis: -Math.log10(0.05) },
              ],
            },
          },
        ],
      };
    }
  }

  // 热力图
  if (chartType === 'heatmap') {
    if (table) {
      const cols = numericCols(table).slice(0, 10);
      if (cols.length > 0) {
        const rows = Math.min(120, cols[0].values.length);
        const data: [number, number, number][] = [];
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols.length; j++) {
            const v = toNum(cols[j].values[i]);
            if (v !== null) data.push([j, i, v]);
          }
        }
        return {
          backgroundColor: 'transparent',
          title: baseTitle,
          tooltip: { position: 'top' },
          grid: { left: 60, right: 20, top: 30, bottom: 40 },
          xAxis: { type: 'category', data: cols.map((c) => c.name), splitArea: { show: true } },
          yAxis: { type: 'category', data: Array.from({ length: rows }, (_, i) => String(i)), splitArea: { show: true } },
          visualMap: { min: undefined, max: undefined, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#0f172a', '#3b82f6', '#f59e0b', '#ef4444'] } },
          series: [{ type: 'heatmap', data }],
        };
      }
    }
  }

  // 箱线图
  if (chartType === 'box') {
    if (table) {
      const cols = numericCols(table).slice(0, 12);
      const boxData = cols.map((c) => {
        const vals = c.values
          .map(toNum)
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b);
        const q = (r: number) => vals[Math.min(vals.length - 1, Math.floor(r * (vals.length - 1)))];
        return [q(0), q(0.25), q(0.5), q(0.75), q(1)];
      });
      return {
        backgroundColor: 'transparent',
        title: baseTitle,
        tooltip: { trigger: 'item' },
        grid: { left: 45, right: 20, top: 30, bottom: 60 },
        xAxis: { type: 'category', data: cols.map((c) => c.name), axisLabel: { rotate: 30 } },
        yAxis: { type: 'value' },
        series: [{ type: 'boxplot', data: boxData }],
      };
    }
  }

  return {
    backgroundColor: 'transparent',
    title: { text: '无可用数据', textStyle: { fontSize: 12, color: '#94a3b8' } },
    xAxis: { type: 'value' },
    yAxis: { type: 'value' },
  };
}

export const PresetChart = memo(function PresetChart({ nodeId }: { nodeId: string }) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === nodeId));
  const result = useGraph((s) => s.results[nodeId]);
  const params = node?.data.params ?? {};
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current, 'light');
    const option = buildPresetOption(params, result?.inputs ?? {});
    // 论文发表风格的亮色版本:白底、深色文字
    option.backgroundColor = '#ffffff';
    chartRef.current.setOption(option, true);
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [params, result, nodeId]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  // 导出与图表完全等大像素的 PNG(pixelRatio=1 即按当前显示尺寸原样输出)
  const handleExport = () => {
    const url = chartRef.current?.getDataURL({
      type: 'png',
      pixelRatio: 1,
      backgroundColor: '#ffffff',
    });
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chart.png';
    a.click();
  };

  return (
    <>
      <div className="nf-chart" ref={ref} />
      <div className="nf-viewer-actions">
        <button className="nf-btn nf-btn-sm nf-export-btn" onClick={handleExport}>
          导出 PNG(等大像素)
        </button>
      </div>
    </>
  );
});

// ==================== 原理化输出 ====================

type Vec3 = [number, number, number];

function rotate(p: Vec3, rotX: number, rotY: number): Vec3 {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  let x = p[0];
  let y = p[1];
  let z = p[2];
  const x1 = x * Math.cos(ry) + z * Math.sin(ry);
  const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
  const y2 = y * Math.cos(rx) - z1 * Math.sin(rx);
  const z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
  return [x1, y2, z2];
}

interface DrawCtx {
  w: number;
  h: number;
  scale: number;
  ox: number;
  oy: number;
  rotX: number;
  rotY: number;
  /** 2D 坐标系:平面正交投影,两轴在屏幕内相互垂直 */
  ortho2d?: boolean;
  ctx: CanvasRenderingContext2D;
}

function project(d: DrawCtx, p: Vec3): [number, number] {
  if (d.ortho2d) return [d.ox + p[0] * d.scale, d.oy - p[1] * d.scale];
  const r = rotate(p, d.rotX, d.rotY);
  return [d.ox + r[0] * d.scale, d.oy - r[1] * d.scale];
}

interface AxesInfo {
  dim: 2 | 3;
  xLen: number;
  yLen: number;
  zLen: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  grid: boolean;
  axisOrigin: 'origin' | 'left';
  showBorder: boolean;
  labelX: string;
  labelY: string;
  labelZ: string;
}

function resolveAxes(input: DataObject | undefined): AxesInfo {
  if (input && input.kind === 'axes') {
    const xMin = Number.isFinite(input.xMin) ? input.xMin : 0;
    const xMax = Number.isFinite(input.xMax) && input.xMax > xMin ? input.xMax : xMin + 10;
    const yMin = Number.isFinite(input.yMin) ? input.yMin : 0;
    const yMax = Number.isFinite(input.yMax) && input.yMax > yMin ? input.yMax : yMin + 10;
    const zMin = Number.isFinite(input.zMin) ? input.zMin : -5;
    const zMax = Number.isFinite(input.zMax) && input.zMax > zMin ? input.zMax : zMin + 10;
    return {
      dim: input.dim === 2 ? 2 : 3,
      xLen: Math.max(input.xLen, 1),
      yLen: Math.max(input.yLen, 1),
      zLen: Math.max(input.zLen, 1),
      xMin,
      xMax,
      yMin,
      yMax,
      zMin,
      zMax,
      grid: input.grid !== false,
      axisOrigin: input.axisOrigin === 'left' ? 'left' : 'origin',
      showBorder: input.showBorder !== false,
      labelX: input.labelX || 'X',
      labelY: input.labelY || 'Y',
      labelZ: input.labelZ || 'Z',
    };
  }
  // 未连接坐标系时的默认坐标系
  return { dim: 3, xLen: 10, yLen: 8, zLen: 6, xMin: -5, xMax: 5, yMin: -5, yMax: 5, zMin: -5, zMax: 5, grid: true, axisOrigin: 'origin', showBorder: true, labelX: 'X', labelY: 'Y', labelZ: 'Z' };
}

/** 刻度目标数量:按轴像素长度自动确定(密度自适应,Desmos 风格) */
function targetCount(pxLen: number): number {
  return Math.max(3, Math.min(10, Math.round(pxLen / 100)));
}

/** 生成"好看"的刻度(1/2/5×10^k 步长),返回刻度值与步长 */
function niceTicks(min: number, max: number, targetCount: number): { ticks: number[]; step: number } {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 1e-9) return { ticks: [min], step: 1 };
  const raw = span / Math.max(1, targetCount);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3.5) step = 2;
  else if (norm < 7.5) step = 5;
  else step = 10;
  step *= mag;
  const ticks: number[] = [];
  const first = Math.ceil(min / step - 1e-9) * step;
  for (let v = first; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks.length === 0) ticks.push(min);
  return { ticks, step };
}

/** 刻度数字格式化(按步长保留适当小数位) */
function fmtTick(v: number, step: number): string {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) < 1e-9) v = 0;
  const dec = step >= 1 ? 0 : Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))));
  return Number(v.toFixed(dec)).toString();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: Record<string, unknown>,
  inputs: DataMap,
  multi: Record<string, DataObject[]>
) {
  const C = presetColors(params);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  const rotX = Number(params.rotX ?? -20);
  const rotY = Number(params.rotY ?? 25);
  const axes = resolveAxes(inputs.in4);
  const hx = axes.xLen / 2;
  const hy = axes.yLen / 2;
  const hz = axes.zLen / 2;

  // 收集图元(点/线/面支持多路连接)
  const collect = (key: string): DataObject[] =>
    multi[key] && multi[key].length > 0 ? multi[key] : inputs[key] ? [inputs[key]] : [];
  const scatterList = collect('in0').filter((o): o is Extract<DataObject, { kind: 'scatter' }> => o.kind === 'scatter');
  const seriesList = collect('in1').filter((o): o is Extract<DataObject, { kind: 'series' }> => o.kind === 'series');
  const meshList = collect('in2').filter((o): o is Extract<DataObject, { kind: 'mesh' }> => o.kind === 'mesh');
  const dist = inputs.in3?.kind === 'distribution' ? inputs.in3 : undefined;
  const hasData = scatterList.length > 0 || seriesList.length > 0 || meshList.length > 0 || !!dist;

  // 数据坐标 → 轴盒局部坐标:每轴按范围独立缩放,精确覆盖 [min,max] 区间(如 x:10→100,y:10→50)
  const sx = axes.xLen / Math.max(axes.xMax - axes.xMin, 1e-9);
  const sy = axes.yLen / Math.max(axes.yMax - axes.yMin, 1e-9);
  const sz = axes.zLen / Math.max(axes.zMax - axes.zMin, 1e-9);
  const mapP = (p: Vec3): Vec3 => [
    (p[0] - axes.xMin) * sx - hx,
    (p[1] - axes.yMin) * sy - hy,
    (p[2] - axes.zMin) * sz - hz,
  ];

  // 坐标轴盒角点投影 → 确定统一渲染比例(等比例、不畸变)
  const corners: Vec3[] =
    axes.dim === 2
      ? [
          [-hx, -hy, 0],
          [hx, -hy, 0],
          [hx, hy, 0],
          [-hx, hy, 0],
        ]
      : (() => {
          const c: Vec3[] = [];
          for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) c.push([x, y, z]);
          return c;
        })();
  const tmp: DrawCtx = { w, h, scale: 1, ox: 0, oy: 0, rotX, rotY, ortho2d: axes.dim === 2, ctx };
  let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
  for (const c of corners) {
    const [px, py] = project(tmp, c);
    pMinX = Math.min(pMinX, px); pMaxX = Math.max(pMaxX, px);
    pMinY = Math.min(pMinY, py); pMaxY = Math.max(pMaxY, py);
  }
  const margin = 0.1;
  const scale = (Math.min(w, h) * (1 - margin * 2)) / Math.max(pMaxX - pMinX, pMaxY - pMinY, 1);
  const d: DrawCtx = { w, h, scale, ox: w / 2, oy: h / 2, rotX, rotY, ortho2d: axes.dim === 2, ctx };

  // 网格(按自动刻度,密度由像素大小决定)
  if (axes.grid) {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (axes.dim === 3) {
      // 地面网格(XZ 平面 y=yMin)
      const xt = niceTicks(axes.xMin, axes.xMax, targetCount(axes.xLen)).ticks;
      const zt = niceTicks(axes.zMin, axes.zMax, targetCount(axes.zLen)).ticks;
      for (const t of xt) {
        const a = project(d, mapP([t, axes.yMin, axes.zMin]));
        const b = project(d, mapP([t, axes.yMin, axes.zMax]));
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      for (const t of zt) {
        const a = project(d, mapP([axes.xMin, axes.yMin, t]));
        const b = project(d, mapP([axes.xMax, axes.yMin, t]));
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
    } else {
      const xt = niceTicks(axes.xMin, axes.xMax, targetCount(axes.xLen)).ticks;
      const yt = niceTicks(axes.yMin, axes.yMax, targetCount(axes.yLen)).ticks;
      for (const t of xt) {
        const a = project(d, mapP([t, axes.yMin, 0]));
        const b = project(d, mapP([t, axes.yMax, 0]));
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      for (const t of yt) {
        const a = project(d, mapP([axes.xMin, t, 0]));
        const b = project(d, mapP([axes.xMax, t, 0]));
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
    }
    ctx.stroke();
  }

  // 边界边框(带边框/不带边框开关)
  if (axes.showBorder) {
    ctx.strokeStyle = C.axis;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const boxEdges: [Vec3, Vec3][] =
      axes.dim === 3
        ? [
            [[-hx, -hy, -hz], [hx, -hy, -hz]],
            [[-hx, -hy, -hz], [-hx, hy, -hz]],
            [[-hx, -hy, -hz], [-hx, -hy, hz]],
            [[hx, -hy, -hz], [hx, hy, -hz]],
            [[hx, -hy, -hz], [hx, -hy, hz]],
            [[-hx, hy, -hz], [hx, hy, -hz]],
            [[-hx, hy, -hz], [-hx, hy, hz]],
            [[-hx, -hy, hz], [hx, -hy, hz]],
            [[-hx, -hy, hz], [-hx, hy, hz]],
            [[hx, hy, -hz], [hx, hy, hz]],
            [[hx, -hy, hz], [hx, hy, hz]],
            [[-hx, hy, hz], [hx, hy, hz]],
          ]
        : [
            [[-hx, -hy, 0], [hx, -hy, 0]],
            [[hx, -hy, 0], [hx, hy, 0]],
            [[hx, hy, 0], [-hx, hy, 0]],
            [[-hx, hy, 0], [-hx, -hy, 0]],
          ];
    for (const [a, b] of boxEdges) {
      const pa = project(d, a);
      const pb = project(d, b);
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (!hasData) {
    // 空坐标系也绘制坐标轴、刻度与数字
    drawAxes(ctx, d, axes, mapP, C);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('无输入数据', w / 2, h / 2);
    return;
  }

  // 构建并变换图元到坐标轴盒内
  const meshTrisRaw: Vec3[][] = [];
  for (const mesh of meshList) {
    for (const f of mesh.faces) {
      const v0 = mesh.vertices[f[0]];
      const v1 = mesh.vertices[f[1]];
      const v2 = mesh.vertices[f[2]];
      if (v0 && v1 && v2) meshTrisRaw.push([v0, v1, v2]);
    }
  }
  const meshTris = meshTrisRaw.map((t) => t.map(mapP) as Vec3[]);

  const distTrisRaw: Vec3[][] = [];
  if (dist) {
    const maxC = Math.max(...dist.bins.map((b) => b.count), 1);
    // 柱状分布:底边在 y=yMin,柱高按 Y 范围等比缩放(占 80%)
    const hScale = ((axes.yMax - axes.yMin) * 0.8) / maxC;
    const baseY = axes.yMin;
    for (const b of dist.bins) {
      const mid = (b.x0 + b.x1) / 2;
      const half = Math.max((b.x1 - b.x0) / 2, (axes.xMax - axes.xMin) * 0.01);
      const hgt = b.count * hScale;
      const x0 = mid - half;
      const x1 = mid + half;
      const a: Vec3 = [x0, baseY, 0];
      const b1: Vec3 = [x1, baseY, 0];
      const c1: Vec3 = [x1, baseY + hgt, 0];
      const d1: Vec3 = [x0, baseY + hgt, 0];
      distTrisRaw.push([a, b1, c1], [a, c1, d1]);
    }
  }
  const distTris = distTrisRaw.map((t) => t.map(mapP) as Vec3[]);

  // 分布(最底层)
  if (distTris.length > 0) {
    drawTris(ctx, d, distTris, C.dist, false, 1, true);
  }

  // 面(可多路网格)
  if (meshTris.length > 0) {
    const wire = !!params.wireframe;
    const fill = params.fillFaces !== false;
    const opacity = Number(params.faceOpacity ?? 0.85);
    const sorted = meshTris
      .map((t) => ({
        t,
        zAvg: (rotate(t[0], d.rotX, d.rotY)[2] + rotate(t[1], d.rotX, d.rotY)[2] + rotate(t[2], d.rotX, d.rotY)[2]) / 3,
      }))
      .sort((a, b) => a.zAvg - b.zAvg);
    for (const { t } of sorted) {
      drawTri(ctx, d, t, fill ? C.face : 'transparent', opacity, wire ? C.face : undefined);
    }
  }

  // 线(可多路曲线;读取对象携带的线样式,暴露参数可驱动逐段粗细/颜色)
  for (const sr of seriesList) {
    const baseW = Math.max(0.5, Number(sr.lineWidth ?? 2));
    const baseC = sr.lineColor ?? C.line;
    const style = sr.lineStyle ?? 'solid';
    const pts = sr.points;
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      const [sx, sy] = project(d, mapP([pts[0][0], pts[0][1], 0]));
      ctx.fillStyle = sr.colors?.[0] ?? baseC;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.5, (sr.sizes?.[0] ?? baseW) * 0.9), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.setLineDash(style === 'dashed' ? [7, 5] : []);
    for (let i = 0; i < pts.length - 1; i++) {
      const w = Math.max(0.4, sr.sizes?.[i] ?? baseW);
      const c = sr.colors?.[i] ?? baseC;
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      const [ax, ay] = project(d, mapP([pts[i][0], pts[i][1], 0]));
      const [bx, by] = project(d, mapP([pts[i + 1][0], pts[i + 1][1], 0]));
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 点(可多路散点;读取对象携带的点样式,暴露参数可驱动逐点大小/颜色;聚合点支持逐点形状)
  for (const sc of scatterList) {
    const baseSize = Math.max(1, Number(sc.pointSize ?? 3));
    const baseColor = sc.pointColor ?? C.point;
    const baseShape = sc.pointShape ?? 'circle';
    sc.points.slice(0, 6000).forEach((p, i) => {
      const sz = Math.max(0.5, sc.sizes?.[i] ?? baseSize);
      const col = sc.colors?.[i] ?? baseColor;
      const shp = (sc.shapes?.[i] as 'circle' | 'square' | 'diamond' | 'triangle') ?? baseShape;
      const [sx, sy] = project(d, mapP([p[0], p[1], p[2] ?? 0]));
      ctx.fillStyle = col;
      drawShape(ctx, shp, sx, sy, sz);
    });
  }

  // 坐标轴、刻度(自动)与数字标注(最后绘制,位于图元之上)
  drawAxes(ctx, d, axes, mapP, C);
}

/** 绘制坐标轴:2D 支持"以原点为中心/总贴左边沿",刻度按密度自动生成并标注数字;3D 轴过盒中心,正半轴加刻度 */
function drawAxes(
  ctx: CanvasRenderingContext2D,
  d: DrawCtx,
  axes: AxesInfo,
  mapP: (p: Vec3) => Vec3,
  C: ReturnType<typeof presetColors>
) {
  if (axes.dim === 2) {
    // 坐标轴位置:原点模式(范围内有原点则过原点,否则贴边) / 总贴左边沿
    const axisX_Y = axes.axisOrigin === 'origin' && 0 >= axes.yMin && 0 <= axes.yMax ? 0 : axes.yMin;
    const axisY_X = axes.axisOrigin === 'origin' && 0 >= axes.xMin && 0 <= axes.xMax ? 0 : axes.xMin;
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.6;
    // X 轴(水平,位于 axisX_Y)
    const x1 = project(d, mapP([axes.xMin, axisX_Y, 0]));
    const x2 = project(d, mapP([axes.xMax, axisX_Y, 0]));
    ctx.beginPath();
    ctx.moveTo(x1[0], x1[1]);
    ctx.lineTo(x2[0], x2[1]);
    ctx.stroke();
    // Y 轴(垂直,位于 axisY_X)
    const y1 = project(d, mapP([axisY_X, axes.yMin, 0]));
    const y2 = project(d, mapP([axisY_X, axes.yMax, 0]));
    ctx.beginPath();
    ctx.moveTo(y1[0], y1[1]);
    ctx.lineTo(y2[0], y2[1]);
    ctx.stroke();

    // 刻度线 + 数字标注(2D 正交投影下轴恒为水平/垂直)
    ctx.fillStyle = C.axis;
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    const xt = niceTicks(axes.xMin, axes.xMax, targetCount(axes.xLen));
    for (const t of xt.ticks) {
      const p = project(d, mapP([t, axisX_Y, 0]));
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - 4);
      ctx.lineTo(p[0], p[1] + 4);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(fmtTick(t, xt.step), p[0], p[1] + 14);
    }
    const yt = niceTicks(axes.yMin, axes.yMax, targetCount(axes.yLen));
    for (const t of yt.ticks) {
      const p = project(d, mapP([axisY_X, t, 0]));
      ctx.beginPath();
      ctx.moveTo(p[0] - 4, p[1]);
      ctx.lineTo(p[0] + 4, p[1]);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fmtTick(t, yt.step), p[0] - 6, p[1] + 3);
    }
    ctx.globalAlpha = 1;
    // 轴标签
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    const xLab = project(d, mapP([axes.xMax, axisX_Y, 0]));
    ctx.fillText(axes.labelX, xLab[0], xLab[1] - 6);
    const yLab = project(d, mapP([axisY_X, axes.yMax, 0]));
    ctx.fillText(axes.labelY, yLab[0] + 8, yLab[1]);
    return;
  }

  // ---- 3D:轴过轴盒中心,正半轴绘制刻度与数字 ----
  const off = (0.05 * Math.min(axes.xLen, axes.yLen, axes.zLen)) / 2;
  const hx = axes.xLen / 2;
  const hy = axes.yLen / 2;
  const hz = axes.zLen / 2;
  const axisEnds: [Vec3, string, 0 | 1 | 2][] = [
    [[hx + off, 0, 0], axes.labelX, 0],
    [[0, hy + off, 0], axes.labelY, 1],
    [[0, 0, hz + off], axes.labelZ, 2],
  ];
  const ranges: [number, number][] = [
    [axes.xMin, axes.xMax],
    [axes.yMin, axes.yMax],
    [axes.zMin, axes.zMax],
  ];
  const scales = [axes.xLen / Math.max(axes.xMax - axes.xMin, 1e-9), axes.yLen / Math.max(axes.yMax - axes.yMin, 1e-9), axes.zLen / Math.max(axes.zMax - axes.zMin, 1e-9)];
  const lengths = [axes.xLen, axes.yLen, axes.zLen];
  for (const [end, label, axisIdx] of axisEnds) {
    const o = project(d, [0, 0, 0]);
    const ep = project(d, end);
    // 正半轴
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(o[0], o[1]);
    ctx.lineTo(ep[0], ep[1]);
    ctx.stroke();
    // 负半轴(细线)
    const np = project(d, [-end[0], -end[1], -end[2]]);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o[0], o[1]);
    ctx.lineTo(np[0], np[1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 刻度(沿该轴按数据范围自动步长)+ 数字
    const [rMin, rMax] = ranges[axisIdx];
    const tk = niceTicks(rMin, rMax, targetCount(lengths[axisIdx]));
    const dx = ep[0] - o[0];
    const dy = ep[1] - o[1];
    const L = Math.hypot(dx, dy) || 1;
    const px = -dy / L;
    const py = dx / L;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.font = '9px sans-serif';
    ctx.fillStyle = C.axis;
    for (const t of tk.ticks) {
      const loc = (t - rMin) * scales[axisIdx] - lengths[axisIdx] / 2;
      const tickVec: Vec3 = axisIdx === 0 ? [loc, 0, 0] : axisIdx === 1 ? [0, loc, 0] : [0, 0, loc];
      const tp = project(d, tickVec);
      ctx.beginPath();
      ctx.moveTo(tp[0] - px * 3.5, tp[1] - py * 3.5);
      ctx.lineTo(tp[0] + px * 3.5, tp[1] + py * 3.5);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(fmtTick(t, tk.step), tp[0] + (dx / L) * 12, tp[1] + (dy / L) * 12 - 2);
    }
    ctx.globalAlpha = 1;
    // 标签
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, ep[0], ep[1] - 6);
  }
}

function drawTris(
  ctx: CanvasRenderingContext2D,
  d: DrawCtx,
  tris: Vec3[][],
  color: string,
  wire: boolean,
  opacity: number,
  fill: boolean
) {
  const sorted = tris
    .map((t) => ({
      t,
      zAvg: (rotate(t[0], d.rotX, d.rotY)[2] + rotate(t[1], d.rotX, d.rotY)[2] + rotate(t[2], d.rotX, d.rotY)[2]) / 3,
    }))
    .sort((a, b) => a.zAvg - b.zAvg);
  for (const { t } of sorted) drawTri(ctx, d, t, fill ? color : 'transparent', opacity, wire ? color : undefined);
}

function drawTri(
  ctx: CanvasRenderingContext2D,
  d: DrawCtx,
  t: Vec3[],
  fillColor: string,
  opacity: number,
  strokeColor?: string
) {
  const [a, b, c] = [project(d, t[0]), project(d, t[1]), project(d, t[2])];
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.closePath();
  if (fillColor !== 'transparent') {
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = opacity;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.globalAlpha = opacity;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** 按形状绘制一个点(以 size 为半径) */
function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: 'circle' | 'square' | 'diamond' | 'triangle',
  x: number,
  y: number,
  size: number
) {
  ctx.beginPath();
  switch (shape) {
    case 'square':
      ctx.rect(x - size, y - size, size * 2, size * 2);
      break;
    case 'diamond':
      ctx.moveTo(x, y - size * 1.4);
      ctx.lineTo(x + size * 1.4, y);
      ctx.lineTo(x, y + size * 1.4);
      ctx.lineTo(x - size * 1.4, y);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(x, y - size * 1.6);
      ctx.lineTo(x + size * 1.4, y + size * 1.1);
      ctx.lineTo(x - size * 1.4, y + size * 1.1);
      ctx.closePath();
      break;
    default:
      ctx.arc(x, y, size, 0, Math.PI * 2);
  }
  ctx.fill();
}

export const PrincipledCanvas = memo(function PrincipledCanvas({ nodeId }: { nodeId: string }) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === nodeId));
  const result = useGraph((s) => s.results[nodeId]);
  const params = node?.data.params ?? {};
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const draw = () => {
      const w = wrap.clientWidth;
      if (w <= 0) return;
      // 预览窗与坐标系尺寸完全等比例(Y : X)
      const axes = resolveAxes(result?.inputs?.in4);
      const h = Math.max(60, Math.min(620, (w * axes.yLen) / axes.xLen));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(ctx, w, h, params, result?.inputs ?? {}, result?.multiInputs ?? {});
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [params, result, nodeId]);

  // 导出:按坐标系输入的像素大小离屏渲染,导出与坐标系尺寸完全等大的 PNG
  const handleExport = () => {
    const axes = resolveAxes(result?.inputs?.in4);
    const w = Math.max(100, Math.min(12000, Math.round(axes.xLen)));
    const h = Math.max(100, Math.min(12000, Math.round(axes.yLen)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawScene(ctx, w, h, params, result?.inputs ?? {}, result?.multiInputs ?? {});
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'principled.png';
    a.click();
  };

  return (
    <div ref={wrapRef} className="nf-principled">
      <canvas ref={canvasRef} />
      <div className="nf-viewer-actions">
        <button className="nf-btn nf-btn-sm nf-export-btn" onClick={handleExport}>
          导出 PNG(等大像素)
        </button>
      </div>
    </div>
  );
});

// ==================== 数据输出(表格预览) ====================

export const DataOutputView = memo(function DataOutputView({ nodeId }: { nodeId: string }) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === nodeId));
  const result = useGraph((s) => s.results[nodeId]);
  const params = node?.data.params ?? {};
  const obj = result?.inputs?.in0;
  const table = obj && obj.kind === 'table' ? obj : undefined;
  const maxRows = Math.max(1, Math.round(Number(params.maxRows ?? 8) || 8));

  if (!table) {
    return <div className="nf-output-empty">请连接表格数据</div>;
  }
  if (table.columns.length === 0) {
    return <div className="nf-output-empty">表格为空</div>;
  }
  const total = table.columns[0]?.values.length ?? 0;
  const rows = Math.min(maxRows, total);
  return (
    <div className="nf-output-table">
      <table className="nf-table">
        <thead>
          <tr>
            <th>#</th>
            {table.columns.map((c) => (
              <th key={c.name}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <td>{r}</td>
              {table.columns.map((c) => (
                <td key={c.name}>{c.values[r] === null ? '—' : String(c.values[r])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="nf-table-more">
        共 {total} 行 × {table.columns.length} 列{total > rows ? `,预览前 ${rows} 行` : ''}
      </div>
    </div>
  );
});

// ==================== 视图分发 ====================

export function ViewerRender({ nodeId, config }: { nodeId: string; config: NodeConfig }) {
  if (config.id === 'viz_principled') return <PrincipledCanvas nodeId={nodeId} />;
  if (config.id === 'data_output') return <DataOutputView nodeId={nodeId} />;
  return <PresetChart nodeId={nodeId} />;
}
