import { create } from 'zustand';
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
} from '@xyflow/react';
import { addEdge, applyEdgeChanges, applyNodeChanges, MarkerType } from '@xyflow/react';
import type { ExecResult } from '../nodes/execEngine';
import { getConfig } from '../nodes/registry';
import { SOCKET_COLOR } from '../types/data';

export type GraphNode = Node<{
  configId: string;
  params: Record<string, unknown>;
  /** 已暴露(生成输入口)的参数 key 列表 */
  exposed: string[];
  /** 是否折叠(仅显示接口与标题栏) */
  collapsed?: boolean;
}>;

export interface LogEntry {
  id: string;
  time: string;
  level: 'info' | 'ok' | 'error';
  msg: string;
}

interface GraphState {
  nodes: GraphNode[];
  edges: Edge[];
  selectedId: string | null;
  autoRun: boolean;
  runVersion: number;
  /** 结构版本号:仅在节点/连线的增删、参数变更、暴露参数切换等结构性变更时递增。
   *  位置拖拽/选择/折叠等纯视觉变更不递增 —— 避免拖拽节点时反复触发全图重算 */
  structureVersion: number;
  results: Record<string, ExecResult>;
  hasCycle: boolean;
  lastError: string | null;
  logs: LogEntry[];
  /** 撤销历史(节点+连线快照) */
  past: { nodes: GraphNode[]; edges: Edge[] }[];
  /** 重做历史 */
  future: { nodes: GraphNode[]; edges: Edge[] }[];

  applyNodeChanges: (changes: NodeChange<GraphNode>[]) => void;
  applyEdgeChanges: (changes: EdgeChange[]) => void;
  /** 直接合并更新某条连线的 data(如曲线内分割点 mid 的拖拽调整;不入撤销历史)。
   *  值为 undefined 的键视为"删除该字段"(如清除分割点 mid,曲线恢复原始形状) */
  updateEdgeData: (id: string, data: Record<string, unknown>) => void;
  /** 当前被选中的曲线内分割点(所属曲线 id;可单独选中,Delete 删除后曲线恢复原始形状) */
  selectedSplitEdgeId: string | null;
  /** 选中 / 取消选中曲线内分割点 */
  selectSplitEdge: (id: string | null) => void;
  onConnect: (conn: Connection) => void;
  addNode: (configId: string, position: { x: number; y: number }) => string;
  removeNodes: (ids: string[]) => void;
  duplicateNodes: (ids: string[]) => void;
  clearAll: () => void;
  selectNode: (id: string | null) => void;
  updateNodeParams: (id: string, patch: Record<string, unknown>) => void;
  toggleExposed: (id: string, key: string) => void;
  toggleCollapse: (id: string) => void;
  /** 记录一次撤销快照(结构变更前调用;拖拽开始/参数变更等) */
  snapshotNow: () => void;
  /** Ctrl+Z 撤销 */
  undo: () => void;
  /** Ctrl+Y / Ctrl+Shift+Z 重做 */
  redo: () => void;
  /** 保存画布为 JSON 字符串 */
  saveGraph: () => string;
  /** 从 JSON 字符串恢复画布,成功返回 true */
  loadGraph: (json: string) => boolean;
  /** 一键整理:按数据流向分层自动排列节点 */
  autoLayout: () => void;
  setAutoRun: (v: boolean) => void;
  bumpRun: () => void;
  setResults: (results: Record<string, ExecResult>, hasCycle: boolean, lastError: string | null) => void;
  setNodesDirect: (nodes: GraphNode[]) => void;
  addLog: (level: LogEntry['level'], msg: string) => void;
  clearLogs: () => void;
}

let idCounter = 0;
export function genId(prefix = 'n'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

function nodeWidth(configId: string): number {
  const cfg = getConfig(configId);
  if (!cfg) return 260;
  if (cfg.isViewer) return 440;
  return 260;
}

/** 构建统一样式的连线(三次贝塞尔 + 源端口颜色 + 增大的命中判定范围) */
function buildEdgeProps(conn: Connection, nodes: GraphNode[]): Partial<Edge> {
  const src = nodes.find((n) => n.id === conn.source);
  const cfg = src ? getConfig(src.data.configId) : undefined;
  const sock = cfg?.outputs.find((o) => o.id === conn.sourceHandle);
  const color = sock ? SOCKET_COLOR[sock.type] : '#7c8db5';
  return {
    type: 'cubic',
    animated: false,
    interactionWidth: 32,
    style: { stroke: color, strokeWidth: 2.2 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 },
  };
}

export const useGraph = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  selectedSplitEdgeId: null,
  autoRun: true,
  runVersion: 0,
  structureVersion: 0,
  results: {},
  hasCycle: false,
  lastError: null,
  logs: [],
  past: [],
  future: [],

  applyNodeChanges: (changes) => {
    // 删除节点等结构性变更前记录撤销快照(拖拽位置/选择变化不入历史)
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
    if (structural) get().snapshotNow();
    set({ nodes: applyNodeChanges(changes, get().nodes) });
    // 仅删除/新增节点时才递增结构版本(位置拖拽/选择/尺寸变化不触发全图重算)
    if (structural) set({ structureVersion: get().structureVersion + 1 });
  },

  applyEdgeChanges: (changes) => {
    const structural = changes.some((c) => c.type === 'remove');
    if (structural) get().snapshotNow();
    set({ edges: applyEdgeChanges(changes, get().edges) });
    if (structural) set({ structureVersion: get().structureVersion + 1 });
  },

  updateEdgeData: (id, data) => {
    set({
      edges: get().edges.map((e) => {
        if (e.id !== id) return e;
        const prev = (e.data as Record<string, unknown> | undefined) ?? {};
        const next = { ...prev };
        // 值为 undefined 的键 → 删除该字段(如清除分割点 mid,曲线恢复原始三次贝塞尔)
        for (const [k, v] of Object.entries(data)) {
          if (v === undefined) delete next[k];
          else next[k] = v;
        }
        return { ...e, data: next };
      }),
    });
  },

  selectSplitEdge: (id) => set({ selectedSplitEdgeId: id }),

  onConnect: (conn) => {
    get().snapshotNow();
    set({
      edges: addEdge({ ...conn, ...buildEdgeProps(conn, get().nodes) }, get().edges),
      structureVersion: get().structureVersion + 1,
    });
    const src = get().nodes.find((n) => n.id === conn.source);
    const tn = get().nodes.find((n) => n.id === conn.target);
    get().addLog('ok', `已连接 ${src?.data.configId ?? ''} → ${tn?.data.configId ?? ''}(${conn.targetHandle})`);
  },

  addNode: (configId, position) => {
    get().snapshotNow();
    const id = genId();
    const cfg = getConfig(configId);
    const defaults: Record<string, unknown> = {};
    cfg?.params.forEach((p) => {
      if (p.type !== 'button') defaults[p.key] = p.default;
    });
    const node: GraphNode = {
      id,
      type: 'graph',
      position,
      data: { configId, params: defaults, exposed: [], collapsed: false },
      style: { width: nodeWidth(configId) },
    };
    set({ nodes: [...get().nodes, node], selectedId: id, structureVersion: get().structureVersion + 1 });
    return id;
  },

  removeNodes: (ids) => {
    if (ids.length === 0) return;
    get().snapshotNow();
    const setIds = new Set(ids);
    set({
      nodes: get().nodes.filter((n) => !setIds.has(n.id)),
      edges: get().edges.filter((e) => !setIds.has(e.source) && !setIds.has(e.target)),
      selectedId: setIds.has(get().selectedId ?? '') ? null : get().selectedId,
      structureVersion: get().structureVersion + 1,
    });
  },

  duplicateNodes: (ids) => {
    const setIds = new Set(ids);
    const srcNodes = get().nodes.filter((n) => setIds.has(n.id));
    if (srcNodes.length === 0) return;
    get().snapshotNow();
    const idMap = new Map<string, string>();
    const clones: GraphNode[] = srcNodes.map((n) => {
      const newId = genId();
      idMap.set(n.id, newId);
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: false,
        data: { configId: n.data.configId, params: { ...n.data.params }, exposed: [...(n.data.exposed ?? [])], collapsed: false },
      };
    });
    const newEdges = get().edges
      .filter((e) => setIds.has(e.source) && setIds.has(e.target))
      .map((e) => ({ ...e, id: genId('e'), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
    set({
      nodes: [...get().nodes, ...clones],
      edges: [...get().edges, ...newEdges],
      selectedId: clones[0]?.id ?? null,
      structureVersion: get().structureVersion + 1,
    });
  },

  clearAll: () => {
    if (get().nodes.length === 0) return;
    get().snapshotNow();
    set({ nodes: [], edges: [], selectedId: null, results: {}, lastError: null, structureVersion: get().structureVersion + 1 });
  },

  selectNode: (id) => set({ selectedId: id }),

  updateNodeParams: (id, patch) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    // 值无变化则不记录历史
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(node.data.params[k]) !== JSON.stringify(v)) changed = true;
    }
    if (!changed) return;
    get().snapshotNow();
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, ...patch } } } : n
      ),
      structureVersion: get().structureVersion + 1,
    });
  },

  toggleExposed: (id, key) => {
    get().snapshotNow();
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== id) return n;
        const cur = n.data.exposed ?? [];
        const exposed = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
        return { ...n, data: { ...n.data, exposed } };
      }),
      structureVersion: get().structureVersion + 1,
    });
  },

  toggleCollapse: (id) => {
    get().snapshotNow();
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } } : n
      ),
    });
  },

  snapshotNow: () => {
    const { past, nodes, edges } = get();
    const snap = { nodes: JSON.parse(JSON.stringify(nodes)) as GraphNode[], edges: JSON.parse(JSON.stringify(edges)) as Edge[] };
    const last = past[past.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
    set({ past: [...past, snap].slice(-100), future: [] });
  },

  undo: () => {
    const { past, future, nodes, edges } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [{ nodes, edges }, ...future].slice(0, 100),
      nodes: prev.nodes,
      edges: prev.edges,
      selectedId: null,
      results: {},
      hasCycle: false,
      lastError: null,
      structureVersion: get().structureVersion + 1,
    });
    get().addLog('info', '已撤销');
  },

  redo: () => {
    const { past, future, nodes, edges } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      future: future.slice(1),
      past: [...past, { nodes, edges }].slice(-100),
      nodes: next.nodes,
      edges: next.edges,
      selectedId: null,
      results: {},
      hasCycle: false,
      lastError: null,
      structureVersion: get().structureVersion + 1,
    });
    get().addLog('info', '已重做');
  },

  saveGraph: () => {
    const { nodes, edges } = get();
    return JSON.stringify(
      {
        format: 'syphon-graph',
        version: 1,
        nodes: nodes.map((n) => ({
          id: n.id,
          configId: n.data.configId,
          params: n.data.params,
          exposed: n.data.exposed ?? [],
          collapsed: !!n.data.collapsed,
          position: n.position,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
          // 曲线内部分割点(Alt 拆分,从属于曲线本身)一并持久化
          mid: (e.data as { mid?: { x: number; y: number } } | undefined)?.mid ?? null,
        })),
      },
      null,
      2
    );
  },

  loadGraph: (json) => {
    try {
      const data = JSON.parse(json);
      if (!data || data.format !== 'syphon-graph' || !Array.isArray(data.nodes)) return false;
      get().snapshotNow();
      // 旧版本"预制可视化"节点 → 对应独立图表节点
      const VIZ_MAP: Record<string, string> = {
        scatter: 'viz_scatter',
        line: 'viz_line',
        bar: 'viz_bar',
        volcano: 'viz_volcano',
        heatmap: 'viz_heatmap',
        box: 'viz_box',
        violin: 'viz_violin',
        sankey: 'viz_sankey',
        graph: 'viz_graph',
      };
      const nodes: GraphNode[] = data.nodes.map((n: Record<string, unknown>) => {
        const rawId = String(n.configId);
        const configId =
          rawId === 'viz_preset'
            ? VIZ_MAP[String((n.params as Record<string, unknown> | undefined)?.chartType ?? 'scatter')] ?? 'viz_scatter'
            : rawId;
        return {
          id: String(n.id),
          type: 'graph',
          position: {
            x: Number((n.position as { x?: number })?.x ?? 0),
            y: Number((n.position as { y?: number })?.y ?? 0),
          },
          data: {
            configId,
            params: n.params && typeof n.params === 'object' ? (n.params as Record<string, unknown>) : {},
            exposed: Array.isArray(n.exposed) ? n.exposed.map(String) : [],
            collapsed: !!n.collapsed,
          },
          style: { width: nodeWidth(configId) },
        };
      });
      const edges: Edge[] = (Array.isArray(data.edges) ? data.edges : []).map((e: Record<string, unknown>) => {
        const conn: Connection = {
          source: String(e.source),
          target: String(e.target),
          sourceHandle: (e.sourceHandle as string | null) ?? null,
          targetHandle: (e.targetHandle as string | null) ?? null,
        };
        const edge: Edge = { id: String(e.id ?? genId('e')), ...conn, ...buildEdgeProps(conn, nodes) };
        // 恢复曲线内部分割点(Alt 拆分)
        const mid = e.mid as { x?: number; y?: number } | null | undefined;
        if (mid && typeof mid.x === 'number' && typeof mid.y === 'number') {
          edge.data = { mid: { x: mid.x, y: mid.y } };
        }
        return edge;
      });
      set({
        nodes,
        edges,
        selectedId: null,
        results: {},
        hasCycle: false,
        lastError: null,
        structureVersion: get().structureVersion + 1,
      });
      get().addLog('ok', `已加载画布:${nodes.length} 个节点 / ${edges.length} 条连线`);
      return true;
    } catch (err) {
      console.error('加载画布失败:', err);
      return false;
    }
  },

  autoLayout: () => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;
    get().snapshotNow();
    // 数据流向:in-degree + 邻接表
    const indeg = new Map<string, number>();
    const outAdj = new Map<string, string[]>();
    const layer = new Map<string, number>();
    for (const n of nodes) {
      indeg.set(n.id, 0);
      outAdj.set(n.id, []);
      layer.set(n.id, 0);
    }
    for (const e of edges) {
      if (!indeg.has(e.target) || !outAdj.has(e.source)) continue;
      indeg.set(e.target, indeg.get(e.target)! + 1);
      outAdj.get(e.source)!.push(e.target);
    }
    // Kahn:每出队一层,后继节点层号 = max(前驱层号)+1
    const q: string[] = [];
    for (const n of nodes) if (indeg.get(n.id) === 0) q.push(n.id);
    let head = 0;
    while (head < q.length) {
      const id = q[head++];
      const cur = layer.get(id)!;
      for (const t of outAdj.get(id)!) {
        layer.set(t, Math.max(layer.get(t)!, cur + 1));
        indeg.set(t, indeg.get(t)! - 1);
        if (indeg.get(t) === 0) q.push(t);
      }
    }
    // 组内按当前 y 排序,保持视觉顺序
    const byLayer = new Map<number, string[]>();
    for (const n of nodes) {
      const l = layer.get(n.id) ?? 0;
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l)!.push(n.id);
    }
    const estH = (n: GraphNode): number => {
      const cfg = getConfig(n.data.configId);
      if (cfg?.isViewer) return 400;
      const rows = (cfg?.inputs.length ?? 0) + (cfg?.outputs.length ?? 0) + (n.data.exposed?.length ?? 0);
      return 100 + rows * 18;
    };
    const pos = new Map<string, { x: number; y: number }>();
    const gapX = 340;
    const gapY = 70;
    let totalH = 0;
    const layerHeights: number[] = [];
    const layerWidths: number[] = [];
    const maxLayer = Math.max(...byLayer.keys());
    for (let l = 0; l <= maxLayer; l++) {
      const ids = byLayer.get(l) ?? [];
      const hSum = ids.reduce((s, id) => s + estH(nodes.find((n) => n.id === id)!), 0);
      layerHeights.push(hSum + Math.max(0, ids.length - 1) * gapY);
      const w = Math.max(
        0,
        ...ids.map((id) => {
          const n = nodes.find((x) => x.id === id)!;
          return Number(n.style?.width) || nodeWidth(n.data.configId);
        })
      );
      layerWidths.push(w);
    }
    totalH = layerHeights.reduce((s, v) => s + v, 0);
    let yOffset = -totalH / 2;
    for (let l = 0; l <= maxLayer; l++) {
      const ids = byLayer.get(l) ?? [];
      // 按当前 y 排序
      const sorted = [...ids].sort(
        (a, b) =>
          (nodes.find((n) => n.id === a)?.position.y ?? 0) -
          (nodes.find((n) => n.id === b)?.position.y ?? 0)
      );
      let x = 0;
      for (let i = 0; i < l; i++) x += layerWidths[i] + gapX;
      const layerW = layerWidths[l] || 260;
      let y = yOffset;
      for (const id of sorted) {
        const n = nodes.find((x) => x.id === id)!;
        const w = Number(n.style?.width) || nodeWidth(n.data.configId);
        pos.set(id, { x: x + (layerW - w) / 2, y });
        y += estH(n) + gapY;
      }
      yOffset += layerHeights[l] + gapY;
    }
    set({
      nodes: nodes.map((n) => {
        const p = pos.get(n.id);
        return p ? { ...n, position: p } : n;
      }),
    });
  },

  setAutoRun: (v) => set({ autoRun: v }),

  bumpRun: () => set((st) => ({ runVersion: st.runVersion + 1 })),

  setResults: (results, hasCycle, lastError) =>
    set({ results, hasCycle, lastError }),

  setNodesDirect: (nodes) => set({ nodes }),

  addLog: (level, msg) => {
    const entry: LogEntry = {
      id: genId('log'),
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level,
      msg,
    };
    set((st) => ({ logs: [...st.logs.slice(-199), entry] }));
  },

  clearLogs: () => set({ logs: [] }),
}));
