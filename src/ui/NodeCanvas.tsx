import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStore,
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

export default function NodeCanvas({ onOpenMenu, boxSelect }: Props) {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const applyNodeChanges = useGraph((s) => s.applyNodeChanges);
  const applyEdgeChanges = useGraph((s) => s.applyEdgeChanges);
  const updateEdgeData = useGraph((s) => s.updateEdgeData);
  const onConnect = useGraph((s) => s.onConnect);
  const selectNode = useGraph((s) => s.selectNode);
  const selectSplitEdge = useGraph((s) => s.selectSplitEdge);
  const toggleCollapse = useGraph((s) => s.toggleCollapse);
  const snapshotNow = useGraph((s) => s.snapshotNow);
  const addLog = useGraph((s) => s.addLog);
  // 记录本次连线会话中已上报过的非法连接,避免重复刷日志
  const invalidRef = useRef<Set<string>>(new Set());
  // 画布容器引用:用于捕获滚轮事件(节点区域不缩放画布)
  const wrapRef = useRef<HTMLDivElement>(null);
  // Ctrl 切断("切水果"):按住 Ctrl 并按住鼠标左键划过连线即可断开
  const [ctrlDown, setCtrlDown] = useState(false);
  const cutSeenRef = useRef<Set<string>>(new Set());
  // Shift+拖拽插入:实时高亮将被切断(插入)的连线
  const [cutHighlight, setCutHighlight] = useState<string | null>(null);
  // Shift+拖拽插入:插入点预览(屏幕坐标)
  const [insertPreview, setInsertPreview] = useState<{ x: number; y: number } | null>(null);
  // Ctrl 切断:鼠标悬停到的连线(将被划断,实时高亮提示)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  // Ctrl 切断:已切断处短暂标记(划过操作的清晰反馈)
  const [cutFlash, setCutFlash] = useState<{ x: number; y: number; key: number }[]>([]);
  // Alt+悬停曲线拆分:命中的曲线与拆分点(屏幕坐标),点击后写入曲线内部分割点 data.mid
  const [altSplit, setAltSplit] = useState<{ edgeId: string; fx: number; fy: number; sx: number; sy: number } | null>(null);
  // 画布 transform:用于 zoom 换算与流坐标→屏幕坐标
  const [viewTx, viewTy, viewZoom] = useStore((s) => s.transform);
  // 本次连线拖拽是否成功连接(用于松开未连接时自动弹出节点菜单)
  const justConnectedRef = useRef(false);

  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setCtrlDown(true);
        cutSeenRef.current.clear();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setCtrlDown(false);
        setHoverEdge(null);
      }
      // Alt 松开后立即清除拆分点预览(不再等待下一次 mousemove)
      if (e.key === 'Alt') setAltSplit(null);
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 删除选中的曲线内分割点:Delete/Backspace(曲线恢复原始三次贝塞尔,整条连线保留)。
  // 用捕获阶段监听,先于 React Flow 自带的"删除选中节点/连线"处理,避免误删其它元素
  useEffect(() => {
    const del = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const st = useGraph.getState();
      if (!st.selectedSplitEdgeId) return;
      e.preventDefault();
      const id = st.selectedSplitEdgeId;
      st.updateEdgeData(id, { mid: undefined });
      st.selectSplitEdge(null);
      st.addLog('ok', '已删除分割点:曲线恢复为原始形状');
    };
    window.addEventListener('keydown', del, true);
    return () => window.removeEventListener('keydown', del, true);
  }, []);

  // Ctrl+滚轮缩放:画布区域交给 React Flow(zoomOnScroll=false + zoomActivationKeyCode="Control");
  // 画布之外的区域(顶栏/属性面板/底部检查器等)由本监听接管,保证"任意位置 Ctrl+滚轮都能整体缩放"
  const { zoomTo, getViewport, screenToFlowPosition } = useReactFlow();
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // 画布内部由 React Flow 自己处理(避免重复缩放);这里只接管画布之外的区域
      const t = e.target as Element | null;
      if (t && t.closest('.react-flow__pane')) return;
      e.preventDefault();
      // 与 React Flow 滚轮缩放完全一致的缩放比例:scale *= 2^(-deltaY*0.002)
      const factor = Math.pow(2, -e.deltaY * 0.002);
      zoomTo(getViewport().zoom * factor);
    };
    const opts = { passive: false } as AddEventListenerOptions;
    window.addEventListener('wheel', onWheel, opts);
    return () => window.removeEventListener('wheel', onWheel, opts);
  }, [zoomTo, getViewport]);

  // Ctrl+拖动划过连线 → 切断:悬停时实时高亮目标连线,划过切断并给出短暂标记
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
      // 切断处短暂标记:清晰的"划过"反馈(红色斜切标记,快速扩散淡出)
      const key = Date.now() + Math.random();
      setCutFlash((f) => [...f, { x, y, key }]);
      window.setTimeout(() => setCutFlash((f) => f.filter((it) => it.key !== key)), 420);
    };
    const mv = (e: MouseEvent) => {
      if (!e.ctrlKey) {
        setHoverEdge(null);
        return;
      }
      // 悬停高亮:鼠标所在连线即"将要被划断"的目标
      const el = e.target as Element | null;
      const edgeEl = el?.closest?.('.react-flow__edge') as HTMLElement | null;
      setHoverEdge(edgeEl?.getAttribute('data-id') ?? null);
      if (!(e.buttons & 1)) return;
      cutAt(e.clientX, e.clientY);
    };
    const mu = () => setHoverEdge(null);
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlDown(true);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', mu);
    window.addEventListener('keydown', kd);
    return () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('keydown', kd);
    };
  }, [applyEdgeChanges, addLog]);

  // Alt+悬停曲线:按住 Alt 划过曲线时,实时高亮目标曲线并显示拆分点预览(小圆点)
  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (!e.altKey) {
        setAltSplit(null);
        return;
      }
      const el = e.target as Element | null;
      const edgeEl = el?.closest?.('.react-flow__edge') as HTMLElement | null;
      const edgeId = edgeEl?.getAttribute('data-id') ?? null;
      if (!edgeId) {
        setAltSplit(null);
        return;
      }
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const hit = closestOnEdgePath(edgeId, flow.x, flow.y);
      if (!hit || hit.dist >= HIT) {
        setAltSplit(null);
        return;
      }
      setAltSplit({
        edgeId,
        fx: hit.x,
        fy: hit.y,
        sx: hit.x * viewZoom + viewTx,
        sy: hit.y * viewZoom + viewTy,
      });
    };
    window.addEventListener('mousemove', mv);
    return () => window.removeEventListener('mousemove', mv);
  }, [screenToFlowPosition, viewZoom, viewTx, viewTy]);

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
  }, [nodes, edges, addLog]);

  const onNodeClick: NodeMouseHandler<GraphNode> = (_, node) => {
    selectNode(node.id);
    // 点击节点时取消分割点选中
    selectSplitEdge(null);
  };

  const HIT = 46 / viewZoom; // 命中距离按缩放换算,保证各缩放级别下都容易命中

  // Alt+点击曲线:在命中点写入曲线的内部分割点 data.mid。
  // 分割点从属于曲线本身(不是节点):让一条贝塞尔曲线外观上分成两段(功能仍是一条连线),
  // 删除连线时两段与分割点一起消失,用于整理曲线避免杂乱。
  const splitEdgeAt = (edge: Edge, fx: number, fy: number) => {
    updateEdgeData(edge.id, { mid: { x: fx, y: fy } });
    addLog('ok', 'Alt 拆分:曲线已插入分割点(外观两段,功能仍是一条连线)');
    setAltSplit(null);
  };

  // 点击连线本体 → Ctrl 切断 / Alt 在点击处拆分曲线(点击小圆点已被其自身捕获,不会到这里)
  const onEdgeClick = (e: React.MouseEvent, edge: Edge) => {
    // 点击连线本体时取消分割点选中
    selectSplitEdge(null);
    if (e.ctrlKey) {
      applyEdgeChanges([{ type: 'remove', id: edge.id }]);
      addLog('info', `Ctrl 切断:${edge.source} → ${edge.target}`);
      const key = Date.now() + Math.random();
      setCutFlash((f) => [...f, { x: e.clientX, y: e.clientY, key }]);
      window.setTimeout(() => setCutFlash((f) => f.filter((it) => it.key !== key)), 420);
      return;
    }
    if (e.altKey) {
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const hit = closestOnEdgePath(edge.id, flow.x, flow.y);
      if (!hit || hit.dist >= HIT) return;
      splitEdgeAt(edge, hit.x, hit.y);
    }
  };

  // Shift+拖拽节点 → 融入连线中间(拆分连线)。拖拽过程中实时高亮将被切断(插入)的连线并预览插入点

  // 贝塞尔曲线路径缓存(键:edge id → 解析后的 SVGPathElement),避免拖拽每帧重复解析
  const pathCacheRef = useRef<Map<string, { el: SVGPathElement; d: string }>>(new Map());

  /** 返回鼠标点到指定连线渲染路径的最近点(与所见曲线完全重合) */
  const closestOnEdgePath = (edgeId: string, px: number, py: number): { x: number; y: number; dist: number } | null => {
    const el = document.querySelector<SVGPathElement>(
      `.react-flow__edge[data-id="${CSS.escape(edgeId)}"] path`
    );
    if (!el) return null;
    const d = el.getAttribute('d') ?? '';
    if (!d) return null;
    let cached = pathCacheRef.current.get(edgeId);
    if (!cached || cached.d !== d) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      cached = { el: p, d };
      pathCacheRef.current.set(edgeId, cached);
      if (pathCacheRef.current.size > 80) {
        const entries = [...pathCacheRef.current.entries()];
        pathCacheRef.current = new Map(entries.slice(-40));
      }
    }
    const total = cached.el.getTotalLength();
    if (total === 0) return null;
    const N = 64;
    let best = { x: px, y: py, dist: Infinity };
    for (let i = 0; i <= N; i++) {
      const pt = cached.el.getPointAtLength((total * i) / N);
      const dist = Math.hypot(pt.x - px, pt.y - py);
      if (dist < best.dist) best = { x: pt.x, y: pt.y, dist };
    }
    return best;
  };

  // 从输入端(target)拖拽连线,松开时未连上任何输出 → 自动弹出节点菜单,便于直接选择要连接的后方节点
  const onConnectEnd = (e: MouseEvent | TouchEvent, cs: { fromHandle?: { type?: string } | null }) => {
    const connected = justConnectedRef.current;
    justConnectedRef.current = false;
    if (connected) return;
    if (cs.fromHandle?.type !== 'target') return;
    const x = 'clientX' in e ? e.clientX : window.innerWidth / 2;
    const y = 'clientY' in e ? e.clientY : window.innerHeight / 2;
    onOpenMenu(x, y);
  };

  const onNodeDragStart: OnNodeDrag<GraphNode> = () => {
    snapshotNow();
  };

  const onNodeDrag: OnNodeDrag<GraphNode> = (e, node) => {
    if (!e.shiftKey) {
      setCutHighlight(null);
      setInsertPreview(null);
      return;
    }
    const center = nodeCenter(node);
    let best: { id: string; d: number; px: number; py: number } | null = null;
    for (const edge of edges) {
      const hit = closestOnEdgePath(edge.id, center.x, center.y);
      if (!hit || hit.dist >= HIT) continue;
      if (!best || hit.dist < best.d) {
        best = { id: edge.id, d: hit.dist, px: hit.x, py: hit.y };
      }
    }
    setCutHighlight(best?.id ?? null);
    setInsertPreview(best ? { x: best.px * viewZoom + viewTx, y: best.py * viewZoom + viewTy } : null);
  };

  const onNodeDragStop: OnNodeDrag<GraphNode> = (e, node) => {
    setCutHighlight(null);
    setInsertPreview(null);
    if (!e.shiftKey) return;
    const center = nodeCenter(node);
    const nc = getConfig(node.data.configId);
    if (!nc) return;
    let best: { edge: Edge; d: number } | null = null;
    for (const edge of edges) {
      const hit = closestOnEdgePath(edge.id, center.x, center.y);
      if (!hit || hit.dist >= HIT) continue;
      if (!best || hit.dist < best.d) best = { edge, d: hit.dist };
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
  // Ctrl 划断时高亮鼠标悬停的连线:加粗 + 红色 + 置顶(清晰提示"将要被划断")
  // Alt 拆分时高亮鼠标悬停的曲线:加粗 + 紫色 + 置顶(提示"可在此拆分")
  const highlightEdges = useMemo(
    () => {
      if (!cutHighlight && !hoverEdge && !altSplit) return edges;
      return edges.map((e) => {
        if (e.id === cutHighlight) {
          return { ...e, style: { ...e.style, stroke: '#f59e0b', strokeWidth: 5 }, zIndex: 100 };
        }
        if (e.id === hoverEdge) {
          return { ...e, style: { ...e.style, stroke: '#ef4444', strokeWidth: 4 }, zIndex: 90 };
        }
        if (e.id === altSplit?.edgeId) {
          return { ...e, style: { ...e.style, stroke: '#8b5cf6', strokeWidth: 5 }, zIndex: 95 };
        }
        return e;
      });
    },
    [edges, cutHighlight, hoverEdge, altSplit]
  );

  return (
    <div className="nf-canvas-wrap" ref={wrapRef}>
      <ReactFlow
        nodes={nodes}
        edges={highlightEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={applyNodeChanges}
        onEdgesChange={applyEdgeChanges}
        onConnect={(conn) => {
          justConnectedRef.current = true;
          onConnect(conn);
        }}
        onConnectEnd={onConnectEnd}
        onConnectStart={() => invalidRef.current.clear()}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => {
          selectNode(null);
          selectSplitEdge(null);
        }}
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
        // 缩放模式:默认不随滚轮缩放画布;按住 Ctrl 滚轮时(任意位置)才整体缩放(走 pinch 分支)
        zoomOnScroll={false}
        zoomOnPinch
        zoomActivationKeyCode="Control"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.7} color="var(--flow-dot)" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const cfg = getConfig((n as GraphNode).data?.configId ?? '');
            return cfg ? CATEGORY_INFO[cfg.category].color : '#888';
          }}
          nodeStrokeWidth={2}
          maskColor="var(--flow-mask)"
          pannable
          zoomable
          style={{ width: 180, height: 120 }}
        />
      </ReactFlow>
      {/* Ctrl 切断标记:划过并切断连线时的短暂反馈(红色斜切标记,快速扩散淡出) */}
      {cutFlash.map((f) => (
        <span key={f.key} className="nf-cut-flash" style={{ left: f.x, top: f.y }} />
      ))}
      {/* Shift 拖拽插入点预览 */}
      {insertPreview && (
        <div className="nf-insert-preview" style={{ left: insertPreview.x, top: insertPreview.y }}>
          <span className="nf-insert-dot" />
          <span className="nf-insert-label">插入</span>
        </div>
      )}
      {/* Alt 拆分点预览:曲线内分割点将插入的位置 */}
      {altSplit && (
        <div className="nf-alt-split-dot" style={{ left: altSplit.sx, top: altSplit.sy }} />
      )}
    </div>
  );
}
