import type { DataMap, DataObject } from '../types/data';
import { getConfig } from './registry';

export interface GraphNodeLite {
  id: string;
  configId: string;
  params: Record<string, unknown>;
}

export interface GraphEdgeLite {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface ExecResult {
  inputs: DataMap;
  outputs: DataMap;
  /** 多连接端口收到的全部上游对象(仅 multi 端口) */
  multiInputs?: Record<string, DataObject[]>;
  error?: string;
}

export interface RunOutcome {
  results: Record<string, ExecResult>;
  order: string[];
  hasCycle: boolean;
  totalMs: number;
}

// 拓扑排序(Kahn)。返回 null 表示存在环。
function topoSort(nodeIds: string[], edges: GraphEdgeLite[]): string[] | null {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    indeg.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  const order: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of adj.get(u)!) {
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  if (order.length !== nodeIds.length) return null;
  return order;
}

export function runGraph(
  nodes: GraphNodeLite[],
  edges: GraphEdgeLite[]
): RunOutcome {
  const t0 = performance.now();
  const nodeIds = nodes.map((n) => n.id);
  const order = topoSort(nodeIds, edges);
  const results: Record<string, ExecResult> = {};
  const hasCycle = order === null;
  const seq = order ?? nodeIds;
  const idSet = new Set(nodeIds);

  for (const nodeId of seq) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const config = getConfig(node.configId);
    if (!config) {
      results[nodeId] = { inputs: {}, outputs: {}, error: `未知节点类型 ${node.configId}` };
      continue;
    }
    const inputs: DataMap = {};
    const multiInputs: Record<string, DataObject[]> = {};
    const inSockets = config.inputs;
    for (const e of edges) {
      if (e.target !== nodeId || !idSet.has(e.source)) continue;
      const src = results[e.source];
      const outId = e.sourceHandle ?? 'out0';
      const obj = src?.outputs?.[outId];
      if (!obj) continue;
      const key = e.targetHandle ?? 'in0';
      const isMulti = inSockets.find((i) => i.id === key)?.multi ?? false;
      if (isMulti) {
        if (!multiInputs[key]) multiInputs[key] = [];
        multiInputs[key].push(obj);
        if (!inputs[key]) inputs[key] = obj;
      } else {
        inputs[key] = obj;
      }
    }
    const entry: ExecResult =
      Object.keys(multiInputs).length > 0
        ? { inputs, outputs: {}, multiInputs }
        : { inputs, outputs: {} };
    if (config.exec) {
      try {
        entry.outputs = config.exec({ nodeId, params: node.params, inputs });
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }
    results[nodeId] = entry;
  }
  return { results, order: seq, hasCycle, totalMs: performance.now() - t0 };
}
