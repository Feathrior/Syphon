import { memo, useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { Column, DataMap, DataObject, NodeConfig } from '../types/data';
import { presetColors, parseGradient } from '../types/data';
import { useGraph } from '../store/useGraph';
import { toNum } from '../utils/math';
import { savePngFile } from '../utils/tauri';
import { isResizing, onResizeEnd } from '../utils/resizeGuard';

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

/** 有序数组分位数 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** 表格中某列(按名称;找不到返回 undefined) */
function colByName(table: Extract<DataMap[string], { kind: 'table' }>, name: string): Column | undefined {
  if (!name) return undefined;
  return table.columns.find((c) => c.name === name);
}

/** 边列表聚合:source→target 权重(无权重列时按出现次数) */
function buildLinks(
  table: Extract<DataMap[string], { kind: 'table' }>,
  sourceCol: string,
  targetCol: string,
  valueCol: string
): { links: { source: string; target: string; value: number }[]; names: string[] } {
  const sc = colByName(table, sourceCol);
  const tc = colByName(table, targetCol);
  if (!sc || !tc) return { links: [], names: [] };
  const vc = valueCol ? colByName(table, valueCol) : undefined;
  const map = new Map<string, number>();
  const nameSet = new Set<string>();
  const n = Math.min(sc.values.length, tc.values.length);
  for (let i = 0; i < n; i++) {
    const s = String(sc.values[i] ?? '').trim();
    const t = String(tc.values[i] ?? '').trim();
    if (!s || !t || s === t) continue;
    const v = vc ? toNum(vc.values[i]) ?? 1 : 1;
    const key = s + '\u0000' + t;
    map.set(key, (map.get(key) ?? 0) + Math.max(0, v));
    nameSet.add(s);
    nameSet.add(t);
  }
  return {
    links: [...map].map(([k, value]) => {
      const [s, t] = k.split('\u0000');
      return { source: s, target: t, value };
    }),
    names: [...nameSet],
  };
}

/** 构建独立图表节点(viz_xxx)的 ECharts 配置。
 *  图表类型由调用方显式传入(取自节点 configId,如 viz_box→'box'),
 *  不能从 params.chartType 推断 —— 预设节点参数里没有该字段,否则会全部回退成散点图。 */
function buildPresetOption(chartType: string, params: Record<string, unknown>, inputs: DataMap): echarts.EChartsOption {
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
        let dMin = Infinity;
        let dMax = -Infinity;
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols.length; j++) {
            const v = toNum(cols[j].values[i]);
            if (v !== null) {
              data.push([j, i, v]);
              if (v < dMin) dMin = v;
              if (v > dMax) dMax = v;
            }
          }
        }
        if (!Number.isFinite(dMin)) dMin = 0;
        if (!Number.isFinite(dMax)) dMax = 1;
        // 颜色渐变:优先使用"色带输入"接入的色带,否则用节点参数里的渐变;calculable:false 取消可编辑色带(仅展示)
        const cb = inputs.in1;
        const gradientStops = cb && cb.kind === 'colorbar' && cb.stops.length > 0 ? cb.stops : parseGradient(params.gradient);
        const heatColors = gradientStops.map((s) => s.color);
        const heatMin = cb && cb.kind === 'colorbar' && Number.isFinite(cb.min) ? (cb.min as number) : dMin;
        const heatMax = cb && cb.kind === 'colorbar' && Number.isFinite(cb.max) ? (cb.max as number) : dMax;
        return {
          backgroundColor: 'transparent',
          title: baseTitle,
          tooltip: { position: 'top' },
          grid: { left: 60, right: 20, top: 30, bottom: 40 },
          xAxis: { type: 'category', data: cols.map((c) => c.name), splitArea: { show: true } },
          yAxis: { type: 'category', data: Array.from({ length: rows }, (_, i) => String(i)), splitArea: { show: true } },
          visualMap: { min: heatMin, max: heatMax, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: heatColors } },
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

  // 小提琴图(核密度估计 + custom series 绘制轮廓)
  if (chartType === 'violin') {
    if (table) {
      const cols = numericCols(table).slice(0, 8);
      if (cols.length > 0) {
        // custom series 的 data 为 [0](仅触发 renderItem),yAxis 范围不会自动包含实际数据值。
        // 必须显式设置 min/max,否则 a.coord([j, value]) 映射出的 y 坐标会超出可视区域
        let yMin = Infinity;
        let yMax = -Infinity;
        for (const col of cols) {
          for (const v of col.values) {
            const n = toNum(v);
            if (n !== null) {
              if (n < yMin) yMin = n;
              if (n > yMax) yMax = n;
            }
          }
        }
        if (!Number.isFinite(yMin)) yMin = 0;
        if (!Number.isFinite(yMax)) yMax = 1;
        // 留 5% 边距,避免小提琴顶部/底部贴边
        const yPad = (yMax - yMin) * 0.05 || 0.5;
        const series: any[] = cols.map((col) => {
          const sorted = col.values
            .map(toNum)
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b);
          return {
            type: 'custom' as const,
            name: col.name,
            data: [0],
            z: 3,
            renderItem: (params: unknown, api: unknown) => {
              const p = params as { seriesIndex: number };
              const a = api as {
                coord: (v: [number, number]) => [number, number];
                size: (v: [number, number]) => [number, number];
              };
              const j = p.seriesIndex;
              if (sorted.length < 2) return null;
              const min = sorted[0];
              const max = sorted[sorted.length - 1];
              const n = sorted.length;
              // 带宽:Silverman 规则(基于 IQR 鲁棒估计)
              const iqr = percentile(sorted, 0.75) - percentile(sorted, 0.25);
              const sigma = Math.min(iqr / 1.349, (max - min) / 2) || (max - min);
              const bw = Math.max(1e-6, 1.06 * sigma * Math.pow(n, -1 / 5));
              const samples = 40;
              const xs: number[] = [];
              const dens: number[] = [];
              let maxD = 0;
              for (let i = 0; i <= samples; i++) {
                const v = min + ((max - min) * i) / samples;
                let s = 0;
                for (const x of sorted) s += Math.exp(-((v - x) * (v - x)) / (2 * bw * bw));
                const d = s / (n * bw * Math.sqrt(2 * Math.PI));
                xs.push(v);
                dens.push(d);
                if (d > maxD) maxD = d;
              }
              const halfBand = Math.max(10, a.size([1, 0])[0] * 0.3);
              const points: [number, number][] = [];
              for (let i = 0; i <= samples; i++) {
                const [cx, cy] = a.coord([j, xs[i]]);
                points.push([cx - (dens[i] / maxD) * halfBand, cy]);
              }
              for (let i = samples; i >= 0; i--) {
                const [cx, cy] = a.coord([j, xs[i]]);
                points.push([cx + (dens[i] / maxD) * halfBand, cy]);
              }
              const med = percentile(sorted, 0.5);
              const [mx, my] = a.coord([j, med]);
              return {
                type: 'group',
                children: [
                  {
                    type: 'polygon',
                    shape: { points },
                    style: { fill: '#3b82f6', opacity: 0.6, stroke: '#1d4ed8', lineWidth: 1.2 },
                  },
                  {
                    type: 'line',
                    shape: { x1: mx - halfBand * 0.85, y1: my, x2: mx + halfBand * 0.85, y2: my },
                    style: { stroke: '#ffffff', lineWidth: 1.5 },
                  },
                ],
              } as any;
            },
          };
        });
        return {
          backgroundColor: 'transparent',
          title: baseTitle,
          tooltip: { trigger: 'item' },
          grid: { left: 45, right: 20, top: 30, bottom: 60 },
          xAxis: { type: 'category', data: cols.map((c) => c.name), axisLabel: { rotate: 30 } },
          yAxis: { type: 'value', min: yMin - yPad, max: yMax + yPad },
          series,
        };
      }
    }
  }

  // 桑基图(source→target 权重)
  if (chartType === 'sankey') {
    if (table) {
      const { links, names } = buildLinks(table, String(params.sourceCol ?? ''), String(params.targetCol ?? ''), String(params.valueCol ?? ''));
      if (links.length > 0 && names.length > 0) {
        return {
          backgroundColor: 'transparent',
          title: baseTitle,
          tooltip: { trigger: 'item' },
          series: [
            {
              type: 'sankey',
              left: 20,
              right: 70,
              top: 30,
              bottom: 30,
              data: names.map((name) => ({ name })),
              links,
              label: { fontSize: 10, color: '#475569' },
              lineStyle: { color: 'gradient', opacity: 0.45 },
              itemStyle: { borderWidth: 0 },
            },
          ],
        };
      }
    }
  }

  // 网络示意图(force 布局)
  if (chartType === 'graph') {
    if (table) {
      const { links, names } = buildLinks(table, String(params.sourceCol ?? ''), String(params.targetCol ?? ''), String(params.valueCol ?? ''));
      if (links.length > 0 && names.length > 0) {
        const maxV = Math.max(...links.map((l) => l.value), 1);
        return {
          backgroundColor: 'transparent',
          title: baseTitle,
          tooltip: { trigger: 'item' },
          series: [
            {
              type: 'graph',
              layout: 'force',
              roam: true,
              draggable: true,
              label: { show: true, fontSize: 10, color: '#475569' },
              force: { repulsion: 120, edgeLength: [60, 120] },
              data: names.map((name) => ({ name })),
              links: links.map((l) => ({
                source: l.source,
                target: l.target,
                value: l.value,
                lineStyle: { width: Math.max(1, (l.value / maxV) * 5), opacity: 0.55 },
              })),
              lineStyle: { color: 'source', curveness: 0.06 },
              itemStyle: { color: '#3b82f6', borderColor: '#fff', borderWidth: 1 },
              emphasis: { focus: 'adjacency', lineStyle: { width: 4 } },
            },
          ],
        };
      }
    }
  }

  return {
    backgroundColor: 'transparent',
    title: { text: '无可用数据', textStyle: { fontSize: 12, color: '#94a3b8' } },
    xAxis: { type: 'value' },
    yAxis: { type: 'value' },
  };
}

/** 导出时使用的紧凑 grid(贴坐标轴,白边最小) */
function compactGrid(chartType: string): Record<string, number> {
  if (chartType === 'heatmap') return { left: 10, right: 12, top: 26, bottom: 64 };
  if (chartType === 'box' || chartType === 'violin') return { left: 10, right: 12, top: 28, bottom: 46 };
  return { left: 10, right: 12, top: 28, bottom: 36 };
}

/** 预览窗共享交互:滚轮以鼠标指针位置为锚点缩放,按住拖拽平移,初始化重置。
 *  图表预览(独立图表节点)与原理化输出(坐标系 canvas)共用同一套交互,
 *  保证两个预览窗的操作方式完全一致。 */
function usePreviewView(wrapRef: React.RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  // 滚轮缩放预览:未按 Ctrl 时以鼠标指针位置为锚点缩放;按住 Ctrl 时交给 React Flow 整体缩放画布
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const nz = Math.min(4, Math.max(0.5, v.zoom * factor));
      const f = nz / v.zoom;
      return { zoom: nz, pan: { x: mx - (mx - v.pan.x) * f, y: my - (my - v.pan.y) * f } };
    });
  };
  // 拖拽平移:放大预览后按住并拖动可改变预览图像位置
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: view.pan.x, panY: view.pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, pan: { x: d.panX + e.clientX - d.startX, y: d.panY + e.clientY - d.startY } }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  // 初始化:重置预览缩放与平移(大小和方向恢复默认)
  const resetView = () => {
    setView({ zoom: 1, pan: { x: 0, y: 0 } });
  };
  return { view, onWheel, onPointerDown, onPointerMove, onPointerUp, resetView };
}

export const PresetChart = memo(function PresetChart({ nodeId }: { nodeId: string }) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === nodeId));
  const result = useGraph((s) => s.results[nodeId]);
  const params = node?.data.params ?? {};
  // 独立图表节点(viz_xxx)→ 图表类型;旧 viz_preset 走 params.chartType
  const configId = node?.data.configId ?? '';
  const chartType = configId.startsWith('viz_') && configId !== 'viz_principled'
    ? configId.slice(4)
    : String(params.chartType ?? 'scatter');
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const prevTypeRef = useRef<string | null>(null);
  // 与原理化输出共用同一套预览交互(指针锚定缩放 / 拖拽平移 / 初始化)
  const { view, onWheel, onPointerDown, onPointerMove, onPointerUp, resetView } = usePreviewView(wrapRef);
  // 导出像素尺寸:支持与原理化输出相同的 canvasPxW/H 参数,默认 1200×900
  const exportW = Math.round(toNum(params.canvasPxW as number | string | undefined) ?? 1200);
  const exportH = Math.round(toNum(params.canvasPxH as number | string | undefined) ?? 900);

  useEffect(() => {
    if (!divRef.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(divRef.current, 'light');
    const option = buildPresetOption(chartType, params, result?.inputs ?? {});
    // 论文发表风格的亮色版本:白底、深色文字
    option.backgroundColor = '#ffffff';
    // 仅图表类型切换时全量重建,同类型数据变化走增量更新(避免热力图等大图卡顿)
    const notMerge = prevTypeRef.current !== chartType;
    prevTypeRef.current = chartType;
    chartRef.current.setOption(option, notMerge);
    // ECharts resize 节流 + 防抖:连续 resize 时限制重绘频率(约 25fps),
    // 停止后延迟一次兜底精确重绘,避免窗口缩放时每帧全量重绘导致卡顿。
    // 窗口整体缩放期间(isResizing)完全跳过 —— 由 resizeGuard 统一在缩放结束后批量重绘
    let lastResize = 0;
    let timer = 0;
    const onResize = () => {
      if (isResizing()) return; // 窗口缩放期间跳过,结束后由 onResizeEnd 兜底
      if (performance.now() - lastResize >= 40) {
        lastResize = performance.now();
        chartRef.current?.resize();
      }
      clearTimeout(timer);
      timer = window.setTimeout(() => chartRef.current?.resize(), 120);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(divRef.current);
    // 窗口缩放结束后的兜底精确重绘(与各 viewer 统一批量执行,避免逐个 resize 造成帧堆积)
    const unbindResizeEnd = onResizeEnd(() => chartRef.current?.resize());
    return () => {
      ro.disconnect();
      clearTimeout(timer);
      unbindResizeEnd();
    };
  }, [params, result, nodeId, chartType]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  // 导出:按导出像素尺寸离屏渲染(白底 + 紧凑 grid 贴坐标轴)后保存 PNG
  const handleExport = async () => {
    const w = Math.max(100, Math.min(12000, exportW));
    const h = Math.max(100, Math.min(12000, exportH));
    const off = document.createElement('div');
    off.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;background:#fff;`;
    document.body.appendChild(off);
    try {
      const chart = echarts.init(off, 'light');
      const option = buildPresetOption(chartType, params, result?.inputs ?? {});
      option.backgroundColor = '#ffffff';
      if (option.grid && typeof option.grid === 'object') {
        option.grid = { ...(option.grid as object), ...compactGrid(chartType) };
      }
      chart.setOption(option);
      // 等待 force 布局 / 渲染稳定
      await new Promise((r) => setTimeout(r, 120));
      const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
      chart.dispose();
      await savePngFile(url, 'chart.png');
    } finally {
      off.remove();
    }
  };

  return (
    // 预览窗与原理化输出使用同一容器(.nf-principled)与操作栏:滚轮缩放、拖拽平移、初始化、导出
    <div ref={wrapRef} className="nf-principled" onWheel={onWheel}>
      <div
        className="nf-chart-scale"
        style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="nf-chart" ref={divRef} />
      </div>
      <div className="nf-viewer-actions">
        <span className="nf-zoom-hint">
          {Math.round(view.zoom * 100)}%
          <span className="nf-export-size">· 导出 {exportW}×{exportH}px</span>
        </span>
        <button className="nf-btn nf-btn-sm nf-reset-btn" onClick={resetView} title="重置预览缩放与位置">
          初始化
        </button>
        <button className="nf-btn nf-btn-sm nf-export-btn" onClick={handleExport}>
          导出 PNG
        </button>
      </div>
    </div>
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
  /** 各轴独立颜色(缺省时回退到颜色预设的 axis 色) */
  colorX?: string;
  colorY?: string;
  colorZ?: string;
  /** 各轴线条粗细(厘米) */
  widthX: number;
  widthY: number;
  widthZ: number;
  /** 各方向网格线显示状态 */
  gridX: boolean;
  gridY: boolean;
  gridZ: boolean;
  /** 轴文字大小(px,预览基准)与字体 */
  fontSize: number;
  fontFamily: string;
  /** 各轴末端箭头开关(X/Y) */
  arrows: { x: boolean; y: boolean };
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
      xLen: Math.max(input.xLen, 0.1),
      yLen: Math.max(input.yLen, 0.1),
      zLen: Math.max(input.zLen, 0.1),
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
      colorX: input.axisColors?.x,
      colorY: input.axisColors?.y,
      colorZ: input.axisColors?.z,
      widthX: Math.max(0.02, Number(input.axisWidths?.x ?? 0.12)),
      widthY: Math.max(0.02, Number(input.axisWidths?.y ?? 0.12)),
      widthZ: Math.max(0.02, Number(input.axisWidths?.z ?? 0.12)),
      gridX: input.gridX !== false,
      gridY: input.gridY !== false,
      gridZ: input.gridZ !== false,
      fontSize: Math.max(6, Math.min(24, Number(input.fontSize ?? 10))),
      fontFamily: input.fontFamily || 'sans-serif',
      arrows: { x: input.arrows?.x !== false, y: input.arrows?.y !== false },
    };
  }
  // 未连接坐标系时的默认坐标系
  return { dim: 3, xLen: 10, yLen: 8, zLen: 6, xMin: -5, xMax: 5, yMin: -5, yMax: 5, zMin: -5, zMax: 5, grid: true, axisOrigin: 'origin', showBorder: true, labelX: 'X', labelY: 'Y', labelZ: 'Z', widthX: 0.12, widthY: 0.12, widthZ: 0.12, gridX: true, gridY: true, gridZ: true, fontSize: 10, fontFamily: 'sans-serif', arrows: { x: true, y: true } };
}

/** 刻度目标数量:按轴厘米长度确定(与渲染尺寸无关),保证预览与导出刻度步长完全一致 */
function targetCount(cmLen: number): number {
  return Math.max(3, Math.min(10, Math.round(cmLen / 2)));
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

  // 收集图元(点/线/面/文本支持多路连接)
  const collect = (key: string): DataObject[] =>
    multi[key] && multi[key].length > 0 ? multi[key] : inputs[key] ? [inputs[key]] : [];
  const scatterList = collect('in0').filter((o): o is Extract<DataObject, { kind: 'scatter' }> => o.kind === 'scatter');
  const seriesList = collect('in1').filter((o): o is Extract<DataObject, { kind: 'series' }> => o.kind === 'series');
  const meshList = collect('in2').filter((o): o is Extract<DataObject, { kind: 'mesh' }> => o.kind === 'mesh');
  const textList = collect('in5').filter((o): o is Extract<DataObject, { kind: 'text' }> => o.kind === 'text');
  const dist = inputs.in3?.kind === 'distribution' ? inputs.in3 : undefined;
  const hasData = scatterList.length > 0 || seriesList.length > 0 || meshList.length > 0 || !!dist || textList.length > 0;

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
  // 像素基准:与轴盒同源于 min(w,h),保证预览与导出(任意画布宽高比)视觉一致:
  // 187.5 = 300·10/16,取 min(w,h) 的线性比例作为文字/线宽基准,画布越大字越大
  const fz = Math.max(0.5, Math.min(w, h) / 187.5);
  // 画布四周内容内边距(像素):为刻度数字 / 轴标签 / 末端箭头预留空间,
  // 避免内容与画布边缘贴得过近导致部分数字被裁切
  // (2D 轴标签最大偏移约 24fz,取 24fz + 余量)
  const pad = Math.max(34, 24 * fz);
  // 画布适配(fit,类比 Windows 背景"适应"):按宽/高两个方向分别计算缩放比后取较小者。
  // 画布与轴内容宽高比一致时内容紧贴画布(仅保留文字所需安全边距,不再留大片空白);
  // 不一致时贴合较小方向、另一方向居中。
  const scale =
    Math.min((w - 2 * pad) / Math.max(pMaxX - pMinX, 1), (h - 2 * pad) / Math.max(pMaxY - pMinY, 1));
  const d: DrawCtx = { w, h, scale, ox: w / 2, oy: h / 2, rotX, rotY, ortho2d: axes.dim === 2, ctx };

  // 网格(总开关 + 各方向独立开关;刻度按屏幕像素密度自动确定)
  if (axes.grid) {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = Math.max(0.5, fz);
    ctx.beginPath();
    if (axes.dim === 3) {
      // 地面网格(XZ 平面 y=yMin):X 方向线与 Z 方向线分别受 gridX/gridZ 控制
      const xt = niceTicks(axes.xMin, axes.xMax, targetCount(axes.xLen)).ticks;
      const zt = niceTicks(axes.zMin, axes.zMax, targetCount(axes.zLen)).ticks;
      if (axes.gridX) {
        for (const t of xt) {
          const a = project(d, mapP([t, axes.yMin, axes.zMin]));
          const b = project(d, mapP([t, axes.yMin, axes.zMax]));
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
      }
      if (axes.gridZ) {
        for (const t of zt) {
          const a = project(d, mapP([axes.xMin, axes.yMin, t]));
          const b = project(d, mapP([axes.xMax, axes.yMin, t]));
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
      }
    } else {
      const xt = niceTicks(axes.xMin, axes.xMax, targetCount(axes.xLen)).ticks;
      const yt = niceTicks(axes.yMin, axes.yMax, targetCount(axes.yLen)).ticks;
      if (axes.gridX) {
        for (const t of xt) {
          const a = project(d, mapP([t, axes.yMin, 0]));
          const b = project(d, mapP([t, axes.yMax, 0]));
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
      }
      if (axes.gridY) {
        for (const t of yt) {
          const a = project(d, mapP([axes.xMin, t, 0]));
          const b = project(d, mapP([axes.xMax, t, 0]));
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
      }
    }
    ctx.stroke();
  }

  // 边界边框(带边框/不带边框开关)
  if (axes.showBorder) {
    ctx.strokeStyle = C.axis;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.2 * fz;
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
    ctx.font = `${Math.max(6, 12 * fz)}px ${axes.fontFamily}`;
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

  // 线(可多路曲线;读取对象携带的线样式,暴露参数可驱动逐段粗细/颜色;粗细随画布宽度等比缩放)
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
      ctx.arc(sx, sy, Math.max(1.5, (sr.sizes?.[0] ?? baseW) * fz * 0.9), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.setLineDash(style === 'dashed' ? [7, 5] : []);
    for (let i = 0; i < pts.length - 1; i++) {
      const w = Math.max(0.4, (sr.sizes?.[i] ?? baseW) * fz);
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

  // 点(可多路散点;读取对象携带的点样式,暴露参数可驱动逐点大小/颜色;聚合点支持逐点形状;大小随画布宽度等比缩放)
  for (const sc of scatterList) {
    const baseSize = Math.max(1, Number(sc.pointSize ?? 3));
    const baseColor = sc.pointColor ?? C.point;
    const baseShape = sc.pointShape ?? 'circle';
    sc.points.slice(0, 6000).forEach((p, i) => {
      const sz = Math.max(0.5, (sc.sizes?.[i] ?? baseSize) * fz);
      const col = sc.colors?.[i] ?? baseColor;
      const shp = (sc.shapes?.[i] as 'circle' | 'square' | 'diamond' | 'triangle') ?? baseShape;
      const [sx, sy] = project(d, mapP([p[0], p[1], p[2] ?? 0]));
      ctx.fillStyle = col;
      drawShape(ctx, shp, sx, sy, sz);
    });
  }

  // 文本(可多路;锚定在轴盒内指定位置,字号按厘米换算像素,与坐标轴盒同比例)
  if (textList.length > 0) {
    // 1 厘米 ≈ 轴盒 X 方向全宽(xLen 厘米)映射到屏幕的像素数
    const pxPerCm = ((Math.max(pMaxX - pMinX, 1) * d.scale) / Math.max(axes.xLen, 0.01)) * 0.62;
    for (const txt of textList) {
      const ax = txt.halign === 'left' ? -hx : txt.halign === 'right' ? hx : 0;
      const ay = txt.valign === 'top' ? hy : txt.valign === 'bottom' ? -hy : 0;
      const [px, py] = project(d, [ax, ay, 0]);
      const fontPx = Math.max(6, txt.fontSize * pxPerCm);
      ctx.font = `${fontPx}px ${txt.fontFamily}`;
      ctx.textAlign = txt.halign === 'left' ? 'left' : txt.halign === 'right' ? 'right' : 'center';
      ctx.textBaseline = txt.valign === 'top' ? 'top' : txt.valign === 'bottom' ? 'bottom' : 'middle';
      if (txt.bgColor) {
        const tw = ctx.measureText(txt.text).width;
        const th = fontPx * 1.45;
        const bx = ctx.textAlign === 'left' ? px : ctx.textAlign === 'right' ? px - tw : px - tw / 2;
        const by = ctx.textBaseline === 'top' ? py : ctx.textBaseline === 'bottom' ? py - th : py - th / 2;
        ctx.fillStyle = txt.bgColor;
        ctx.fillRect(bx - 4, by - 2, tw + 8, th + 4);
      }
      ctx.fillStyle = txt.textColor;
      ctx.fillText(txt.text, px, py);
    }
  }

  // 坐标轴、刻度(自动)与数字标注(最后绘制,位于图元之上)
  drawAxes(ctx, d, axes, mapP, C);
}

/** 绘制坐标轴:2D 支持"以原点为中心/总贴左边沿",刻度按密度自动生成并标注数字;3D 轴过盒中心,正半轴加刻度
 *  各轴颜色/粗细独立设置(粗细为厘米,按当前渲染比例换算为像素);文字大小与字体可调 */
function drawAxes(
  ctx: CanvasRenderingContext2D,
  d: DrawCtx,
  axes: AxesInfo,
  mapP: (p: Vec3) => Vec3,
  C: ReturnType<typeof presetColors>
) {
  // 文字缩放基准:与轴盒同源于 min(w,h)(预览/导出一致);轴粗细(厘米)按渲染比例换算
  const fz = Math.max(0.5, Math.min(d.w, d.h) / 187.5);
  const fontPx = (base: number) => `${Math.max(6, Math.round(base * fz))}px ${axes.fontFamily}`;
  const cx = axes.colorX || C.axis;
  const cy = axes.colorY || C.axis;
  const cz = axes.colorZ || C.axis;
  const aw = (cm: number) => Math.max(0.5, cm * d.scale);

  if (axes.dim === 2) {
    // 坐标轴位置:原点模式(范围内有原点则过原点,否则贴边) / 总贴左边沿
    const axisX_Y = axes.axisOrigin === 'origin' && 0 >= axes.yMin && 0 <= axes.yMax ? 0 : axes.yMin;
    const axisY_X = axes.axisOrigin === 'origin' && 0 >= axes.xMin && 0 <= axes.xMax ? 0 : axes.xMin;
    // X 轴(水平,位于 axisX_Y)
    ctx.strokeStyle = cx;
    ctx.lineWidth = aw(axes.widthX);
    const x1 = project(d, mapP([axes.xMin, axisX_Y, 0]));
    const x2 = project(d, mapP([axes.xMax, axisX_Y, 0]));
    ctx.beginPath();
    ctx.moveTo(x1[0], x1[1]);
    ctx.lineTo(x2[0], x2[1]);
    ctx.stroke();
    // Y 轴(垂直,位于 axisY_X)
    ctx.strokeStyle = cy;
    ctx.lineWidth = aw(axes.widthY);
    const y1 = project(d, mapP([axisY_X, axes.yMin, 0]));
    const y2 = project(d, mapP([axisY_X, axes.yMax, 0]));
    ctx.beginPath();
    ctx.moveTo(y1[0], y1[1]);
    ctx.lineTo(y2[0], y2[1]);
    ctx.stroke();

    // 刻度线 + 数字标注(2D 正交投影下轴恒为水平/垂直)
    ctx.fillStyle = cx;
    ctx.font = fontPx(axes.fontSize);
    ctx.lineWidth = Math.max(1, fz);
    ctx.globalAlpha = 0.85;
    const xt = niceTicks(axes.xMin, axes.xMax, targetCount(axes.xLen));
    for (const t of xt.ticks) {
      const p = project(d, mapP([t, axisX_Y, 0]));
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - 4 * fz);
      ctx.lineTo(p[0], p[1] + 4 * fz);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(fmtTick(t, xt.step), p[0], p[1] + 14 * fz);
    }
    ctx.fillStyle = cy;
    const yt = niceTicks(axes.yMin, axes.yMax, targetCount(axes.yLen));
    for (const t of yt.ticks) {
      const p = project(d, mapP([axisY_X, t, 0]));
      ctx.beginPath();
      ctx.moveTo(p[0] - 4 * fz, p[1]);
      ctx.lineTo(p[0] + 4 * fz, p[1]);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fmtTick(t, yt.step), p[0] - 6 * fz, p[1] + 3 * fz);
    }
    ctx.globalAlpha = 1;
    // 轴标签(文字略大于刻度数字)
    ctx.font = fontPx(axes.fontSize + 2);
    ctx.textAlign = 'center';
    const xLab = project(d, mapP([axes.xMax, axisX_Y, 0]));
    const yLab = project(d, mapP([axisY_X, axes.yMax, 0]));
    if (axes.axisOrigin === 'left') {
      // 总贴左边沿:标签位于坐标轴"正中心位置"(X 轴中点 / Y 轴中点),
      // 并再向外偏移一段距离,不与坐标轴及刻度数字重合
      const xMid = project(d, mapP([(axes.xMin + axes.xMax) / 2, axisX_Y, 0]));
      const yMid = project(d, mapP([axisY_X, (axes.yMin + axes.yMax) / 2, 0]));
      ctx.fillStyle = cx;
      ctx.fillText(axes.labelX, xMid[0], xMid[1] + 26 * fz);
      ctx.fillStyle = cy;
      ctx.save();
      ctx.translate(yMid[0] - 24 * fz, yMid[1]);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(axes.labelY, 0, 0);
      ctx.restore();
    } else {
      // 以原点为中心:标签位于轴末端上方(X)/右侧(Y)
      ctx.fillStyle = cx;
      ctx.fillText(axes.labelX, xLab[0], xLab[1] - 6 * fz);
      ctx.fillStyle = cy;
      ctx.fillText(axes.labelY, yLab[0] + 8 * fz, yLab[1]);
    }
    // 轴末端箭头(可选):X/Y 轴各按开关绘制实心三角箭头
    if (axes.arrows.x) {
      const p0 = project(d, mapP([axes.xMax - (axes.xMax - axes.xMin) * 0.08, axisX_Y, 0]));
      drawArrow(ctx, p0, xLab, 8 * fz, cx);
    }
    if (axes.arrows.y) {
      const p0 = project(d, mapP([axisY_X, axes.yMax - (axes.yMax - axes.yMin) * 0.08, 0]));
      drawArrow(ctx, p0, yLab, 8 * fz, cy);
    }
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
  const axisColors = [cx, cy, cz];
  const axisWidthsCm = [axes.widthX, axes.widthY, axes.widthZ];
  for (const [end, label, axisIdx] of axisEnds) {
    const o = project(d, [0, 0, 0]);
    const ep = project(d, end);
    // 正半轴
    ctx.strokeStyle = axisColors[axisIdx];
    ctx.lineWidth = aw(axisWidthsCm[axisIdx]);
    ctx.beginPath();
    ctx.moveTo(o[0], o[1]);
    ctx.lineTo(ep[0], ep[1]);
    ctx.stroke();
    // 负半轴(细线)
    const np = project(d, [-end[0], -end[1], -end[2]]);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(0.5, aw(axisWidthsCm[axisIdx]) * 0.5);
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
    ctx.lineWidth = Math.max(1, fz);
    ctx.globalAlpha = 0.7;
    ctx.font = fontPx(axes.fontSize - 1);
    ctx.fillStyle = axisColors[axisIdx];
    for (const t of tk.ticks) {
      const loc = (t - rMin) * scales[axisIdx] - lengths[axisIdx] / 2;
      const tickVec: Vec3 = axisIdx === 0 ? [loc, 0, 0] : axisIdx === 1 ? [0, loc, 0] : [0, 0, loc];
      const tp = project(d, tickVec);
      ctx.beginPath();
      ctx.moveTo(tp[0] - px * 3.5 * fz, tp[1] - py * 3.5 * fz);
      ctx.lineTo(tp[0] + px * 3.5 * fz, tp[1] + py * 3.5 * fz);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(fmtTick(t, tk.step), tp[0] + (dx / L) * 12 * fz, tp[1] + (dy / L) * 12 * fz - 2 * fz);
    }
    ctx.globalAlpha = 1;
    // 标签
    ctx.font = fontPx(axes.fontSize + 2);
    ctx.textAlign = 'center';
    ctx.fillText(label, ep[0], ep[1] - 6 * fz);
    // 末端箭头(可选):仅 X/Y 轴按开关绘制
    if ((axisIdx === 0 && axes.arrows.x) || (axisIdx === 1 && axes.arrows.y)) {
      drawArrow(ctx, o, ep, 8 * fz, axisColors[axisIdx]);
    }
  }
}

/** 在 p2 处绘制实心三角箭头(方向沿 p1→p2,size 为箭头长度) */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  p1: [number, number],
  p2: [number, number],
  size: number,
  color: string
) {
  const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p2[0], p2[1]);
  ctx.lineTo(p2[0] - size * Math.cos(ang - 0.42), p2[1] - size * Math.sin(ang - 0.42));
  ctx.lineTo(p2[0] - size * Math.cos(ang + 0.42), p2[1] - size * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
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
    ctx.lineWidth = Math.max(0.5, Math.min(d.w, d.h) / 187.5);
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
  // 与图表预览共用同一套预览交互(指针锚定缩放 / 拖拽平移 / 初始化)
  const { view, onWheel, onPointerDown, onPointerMove, onPointerUp, resetView } = usePreviewView(wrapRef);
  // 画布像素大小(本节点参数):同时决定预览/导出白色矩形背景的宽高比与导出 PNG 的像素数量
  const exportW = Math.round(toNum(params.canvasPxW as number | string | undefined) ?? 1920);
  const exportH = Math.round(toNum(params.canvasPxH as number | string | undefined) ?? 1200);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const draw = () => {
      const w = wrap.clientWidth;
      if (w <= 0) return;
      // 预览窗外围容器(.nf-principled)高度恒定,不随画布(导出宽高比)改变而改变:
      // 画布按导出宽高比在容器内"适应(contain)"缩放 —— 宽高比与容器一致时紧贴,否则居中。
      const CONTAINER_H = 230; // 与 .nf-principled 的固定高度一致
      const BAR_H = 38; // 底部悬浮操作栏高度(画布区域 = 容器高 - 操作栏高)
      const availH = CONTAINER_H - BAR_H;
      const ratio = exportH / exportW;
      // 先按容器宽度铺满,再按比例收紧高度;超高时转以高度为基准收窄宽度,保持宽高比不变
      let cw = w;
      let ch = cw * ratio;
      if (ch > availH) {
        ch = availH;
        cw = ch / ratio;
      }
      // 仅当样式尺寸实际变化时才写 DOM,避免窗口 resize 期间反复触发 layout
      if (canvas.style.width !== `${cw}px`) canvas.style.width = `${cw}px`;
      if (canvas.style.height !== `${ch}px`) canvas.style.height = `${ch}px`;
      const dpr = window.devicePixelRatio || 1;
      const pxW = Math.round(cw * dpr);
      const pxH = Math.round(ch * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(ctx, cw, ch, params, result?.inputs ?? {}, result?.multiInputs ?? {});
    };
    // 窗口 resize 重绘调度:rAF 合并同帧多次触发 + 节流(连续 resize 时最小重绘间隔 40ms,
    // 约 25fps,显著降低 Tauri 打包后 WebView 每帧全量重绘的负担)+ 防抖(resize 停止 120ms
    // 后强制精确重绘一次,保证最终尺寸像素级准确)。三者配合使拖动窗口缩放流畅无延迟。
    // 窗口整体缩放期间(isResizing)完全跳过 —— 由 resizeGuard 统一在缩放结束后批量重绘。
    const state = { raf: 0, timer: 0, last: 0 };
    const MIN_GAP = 40; // 连续 resize 时最小重绘间隔(ms)
    const SETTLE_DELAY = 120; // resize 停止后防抖时长(ms)
    const performDraw = () => {
      state.last = performance.now();
      draw();
    };
    const scheduleDraw = () => {
      if (isResizing()) return; // 窗口缩放期间跳过,结束后由 onResizeEnd 兜底
      // 节流:距上次重绘不足最小间隔时不立即重绘,交给下一帧再检查
      cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(() => {
        if (performance.now() - state.last < MIN_GAP) {
          scheduleDraw(); // 仍处于密集 resize 中,延后到下一帧检查
        } else {
          performDraw();
        }
      });
      // 防抖:resize 停止后延迟精确重绘,兜底保证最终尺寸准确
      clearTimeout(state.timer);
      state.timer = window.setTimeout(() => {
        cancelAnimationFrame(state.raf);
        performDraw();
      }, SETTLE_DELAY);
    };
    draw();
    const ro = new ResizeObserver(scheduleDraw);
    ro.observe(wrap);
    // 窗口缩放结束后的兜底精确重绘(与各 viewer 统一批量执行,避免逐个重绘造成帧堆积)
    const unbindResizeEnd = onResizeEnd(performDraw);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(state.raf);
      clearTimeout(state.timer);
      unbindResizeEnd();
    };
  }, [params, result, nodeId]);

  // 导出:按"画布像素大小"参数离屏渲染,白色矩形背景即画布宽高,输出完整画布(不裁剪内容)
  const handleExport = async () => {
    const w = Math.max(100, Math.min(12000, exportW));
    const h = Math.max(100, Math.min(12000, exportH));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawScene(ctx, w, h, params, result?.inputs ?? {}, result?.multiInputs ?? {});
    await savePngFile(canvas.toDataURL('image/png'), 'principled.png');
  };

  return (
    // 滚轮缩放绑定在整个预览窗容器上:范围内任意位置(含画布四周空白)都可缩放
    <div ref={wrapRef} className="nf-principled" onWheel={onWheel}>
      {/* 仅画布缩放/平移(等比 transform);操作栏/标题不随滚轮缩放 */}
      <div
        className="nf-chart-scale"
        style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} />
      </div>
      <div className="nf-viewer-actions">
        <span className="nf-zoom-hint">
          {Math.round(view.zoom * 100)}%
          <span className="nf-export-size">
            · 导出 {exportW}×{exportH}px
          </span>
        </span>
        <button className="nf-btn nf-btn-sm nf-reset-btn" onClick={resetView} title="重置预览缩放与位置">
          初始化
        </button>
        <button className="nf-btn nf-btn-sm nf-export-btn" onClick={handleExport}>
          导出 PNG
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
