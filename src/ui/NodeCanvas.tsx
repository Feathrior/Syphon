import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
} from '@xyflow/react';
import type { Connection, Edge, IsValidConnection, NodeMouseHandler, OnNodeDrag } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraph, type GraphNode } from '../store/useGraph';
import { getConfig } from '../nodes/registry';
import { CATEGORY_INFO, SOCKET_LABEL, isCompatible, type SocketType } from '../types/data';
import { GraphNodeComponent } from './NodeComponent';
import CubicEdge from './edges';
export interface MenuRequest {
  x: number;
  y: number;
  flowPos: { x: number; y: number };
  nodeId?: string;
}

interface Props {
  onOpenMenu: (x: number, y: number, nodeId?: string) => void;
  boxSelect: boolean;
}

const nodeTypes = { graph: GraphNodeComponent };
const edgeTypes = { cubic: CubicEdge };

function MiniNode({ data }: { data: GraphNode['data'] }) {
  const cfg = getConfig(data.configId);
  return <div style={{ background: cfg ? CATEGORY_INFO[cfg.category].color : '#888' }} className="nf-mini-node" />;
}

/** 节点在画布中的中心点(用真实 DOM 高度估算) */
function nodeCenter(n: GraphNode): { x: number; y: number } {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${n.id}"] .nf-node`);
  const w = n.style?.width ? Number(n.style.width) : 260;
  const h = el?.offsetHeight ?? 120;
  return { x: n.position.x + w / 2, y: n.position.y + h / 2 };
}

/** 点到线段距离 */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default function NodeCanvas({ onOpenMenu, boxSelect }: Props) {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const applyNodeChanges = useGraph((s) => s.applyNodeChanges);
  const applyEdgeChanges = useGraph((s) => s.applyEdgeChanges);
  const onConnect = useGraph((s) => s.onConnect);
  const selectNode = useGraph((s) => s.selectNode);
  const toggleCollapse = useGraph((s) => s.toggleCollapse);
  const snapshotNow = useGraph((s) => s.snapshotNow);
  const addLog = useGraph((s) => s.addLog);
  // 记录本次连线会话中已上报过的非法连接,避免重复刷日志
  const invalidRef = useRef<Set<string>>(new Set());
  // Ctrl 切断("切水果"):按住 Ctrl 并按住鼠标左键划过连线即可断开
  const [ctrlDown, setCtrlDown] = useState(false);
  const cutSeenRef = useRef<Set<string>>(new Set());
  // Shift+拖拽插入:实时高亮将被切断(插入)的连线
  const [cutHighlight, setCutHighlight] = useState<string | null>(null);

  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setCtrlDown(true);
        cutSeenRef.current.clear();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlDown(false);
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Ctrl+拖动划过连线 → 切断(切水果:按住 Ctrl 并按住鼠标左键横扫)
  useEffect(() => {
    const cutAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      const edgeEl = el?.closest?.('.react-flow__edge') as HTMLElement | null;
      if (!edgeEl) return;
      const id = edgeEl.getAttribute('data-id');
      if (!id || cutSeenRef.current.has(id)) return;
      cutSeenRef.current.add(id);
      applyEdgeChanges([{ type: 'remove', id }]);
      addLog('info', 'Ctrl 切断:已断开一条连线');
    };
    const mv = (e: MouseEvent) => {
      if (e.ctrlKey && (e.buttons & 1)) cutAt(e.clientX, e.clientY);
    };
    window.addEventListener('mousemove', mv);
    return () => window.removeEventListener('mousemove', mv);
  }, [applyEdgeChanges, addLog]);

  const isValidConnection: IsValidConnection = useMemo(() => {
    return (conn: Edge | Connection) => {
      const sn = nodes.find((n) => n.id === conn.source);
      const tn = nodes.find((n) => n.id === conn.target);
      if (!sn || !tn || sn.id === tn.id) return false;
      const sc = getConfig(sn.data.configId);
      const tc = getConfig(tn.data.configId);
      if (!sc || !tc) return false;
      const so = sc.outputs.find((o) => o.id === conn.sourceHandle);
      if (!so) return false;
      let tiType: SocketType | null = null;
      const ti = tc.inputs.find((i) => i.id === conn.targetHandle);
      if (ti) {
        tiType = ti.type;
      } else if (conn.targetHandle?.startsWith('exp_')) {
        // 暴露参数输入口:类型 any,可接收任意数据列
        const key = conn.targetHandle.slice(4);
        const exposed = tn.data.exposed ?? [];
        const p = tc.params.find((q) => q.key === key && q.type !== 'button' && (q as { expose?: boolean }).expose);
        if (exposed.includes(key) && p) tiType = 'any';
      }
      if (!tiType) return false;
      if (!isCompatible(so.type, tiType)) {
        const key = `${sn.id}:${conn.sourceHandle}->${tn.id}:${conn.targetHandle}`;
        if (!invalidRef.current.has(key)) {
          invalidRef.current.add(key);
          addLog(
            'error',
            `类型不匹配,拒绝连线:${sc.label}(${SOCKET_LABEL[so.type]}) → ${tc.label}(${SOCKET_LABEL[tiType]})`
          );
        }
        return false;
      }
      return true;
    };
  }, [nodes, addLog]);

  const onNodeClick: NodeMouseHandler<GraphNode> = (_, node) => selectNode(node.id);

  // Ctrl+点击连线 → 切断
  const onEdgeClick = (e: React.MouseEvent, edge: Edge) => {
    if (e.ctrlKey) {
      applyEdgeChanges([{ type: 'remove', id: edge.id }]);
      addLog('info', `Ctrl 切断:${edge.source} → ${edge.target}`);
    }
  };

  // Shift+拖拽节点 → 融入连线中间(拆分连线)。拖拽过程中实时高亮将被切断(插入)的连线
  const onNodeDragStart: OnNodeDrag<GraphNode> = () => {
    snapshotNow();
  };

  const onNodeDrag: OnNodeDrag<GraphNode> = (e, node) => {
    if (!e.shiftKey) {
      setCutHighlight(null);
      return;
    }
    const center = nodeCenter(node);
    let best: { id: string; d: number } | null = null;
    for (const edge of edges) {
      const s = nodes.find((n) => n.id === edge.source);
      const t = nodes.find((n) => n.id === edge.target);
      if (!s || !t) continue;
      const a = nodeCenter(s);
      const b = nodeCenter(t);
      const d = distToSegment(center.x, center.y, a.x, a.y, b.x, b.y);
      if (d < 40 && (!best || d < best.d)) best = { id: edge.id, d };
    }
    setCutHighlight(best?.id ?? null);
  };

  const onNodeDragStop: OnNodeDrag<GraphNode> = (e, node) => {
    setCutHighlight(null);
    if (!e.shiftKey) return;
    const center = nodeCenter(node);
    const nc = getConfig(node.data.configId);
    if (!nc) return;
    let best: { edge: Edge; d: number } | null = null;
    for (const edge of edges) {
      const s = nodes.find((n) => n.id === edge.source);
      const t = nodes.find((n) => n.id === edge.target);
      if (!s || !t) continue;
      const a = nodeCenter(s);
      const b = nodeCenter(t);
      const d = distToSegment(center.x, center.y, a.x, a.y, b.x, b.y);
      if (d < 40 && (!best || d < best.d)) best = { edge, d };
    }
    if (!best) return;
    const { edge } = best;
    const sc = getConfig(nodes.find((n) => n.id === edge.source)?.data.configId ?? '');
    const tc = getConfig(nodes.find((n) => n.id === edge.target)?.data.configId ?? '');
    if (!sc || !tc) return;
    const so = sc.outputs.find((o) => o.id === edge.sourceHandle);
    const ti = tc.inputs.find((i) => i.id === edge.targetHandle);
    if (!so || !ti) return;
    // 找该节点兼容的输入/输出口
    const inSock = nc.inputs.find((i) => isCompatible(so.type, i.type));
    const outSock = nc.outputs.find((o) => isCompatible(o.type, ti.type));
    if (!inSock || !outSock) return;
    const dup = edges.some(
      (ed) =>
        ed.id !== edge.id &&
        ed.source === edge.source &&
        ed.target === node.id &&
        ed.sourceHandle === edge.sourceHandle &&
        ed.targetHandle === inSock.id
    );
    if (dup) return;
    applyEdgeChanges([{ type: 'remove', id: edge.id }]);
    onConnect({ source: edge.source, target: node.id, sourceHandle: edge.sourceHandle ?? null, targetHandle: inSock.id });
    onConnect({ source: node.id, target: edge.target, sourceHandle: outSock.id, targetHandle: edge.targetHandle ?? null });
    addLog('ok', 'Shift 拖拽:节点已插入连线中间');
  };

  // Shift 拖拽时高亮将被切断(插入)的连线:加粗 + 亮橙 + 置顶
  const highlightEdges = useMemo(
    () =>
      cutHighlight
        ? edges.map((e) =>
            e.id === cutHighlight
              ? { ...e, style: { ...e.style, stroke: '#f59e0b', strokeWidth: 5 }, zIndex: 100 }
              : e
          )
        : edges,
    [edges, cutHighlight]
  );

  return (
    <div className="nf-canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={highlightEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={applyNodeChanges}
        onEdgesChange={applyEdgeChanges}
        onConnect={onConnect}
        onConnectStart={() => invalidRef.current.clear()}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => selectNode(null)}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu(e.clientX, e.clientY);
        }}
        onNodeContextMenu={(e, node) => {
          // 节点内部右键 → 折叠/展开节点(只显示接口与标题栏)
          e.preventDefault();
          selectNode(node.id);
          toggleCollapse(node.id);
        }}
        panOnDrag={!boxSelect && !ctrlDown}
        selectionOnDrag={boxSelect}
        selectionMode={boxSelect ? SelectionMode.Partial : SelectionMode.Full}
        deleteKeyCode={['Delete', 'Backspace']}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#273349" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const cfg = getConfig((n as GraphNode).data?.configId ?? '');
            return cfg ? CATEGORY_INFO[cfg.category].color : '#888';
          }}
          nodeStrokeWidth={2}
          maskColor="rgba(2,6,23,0.7)"
          pannable
          zoomable
          style={{ width: 180, height: 120 }}
        />
      </ReactFlow>
    </div>
  );
}
