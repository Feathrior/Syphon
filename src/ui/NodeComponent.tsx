import { memo, useMemo } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { getConfig } from '../nodes/registry';
import { CATEGORY_INFO, SOCKET_COLOR, SOCKET_LABEL } from '../types/data';
import type { GraphNode } from '../store/useGraph';
import { useGraph } from '../store/useGraph';
import { useTheme } from '../utils/theme';
import { ViewerRender } from './ViewerRender';

/** hex 颜色混入白色,用于暗色主题下顶栏提亮 */
function lighten(hex: string, amt: number): string {
  const m = hex.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return hex;
  const c = [1, 2, 3].map((i) => Math.round(parseInt(m[i], 16) + (255 - parseInt(m[i], 16)) * amt));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function paramSummary(params: Record<string, unknown>, keys: string[]): string {
  const parts: string[] = [];
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (typeof v === 'object') continue;
    if (typeof v === 'boolean') continue;
    if (typeof v === 'string' && v.startsWith('#')) continue;
    parts.push(String(v));
  }
  return parts.join(' · ');
}

export const GraphNodeComponent = memo(function GraphNodeComponent({
  id,
  data,
  selected,
}: NodeProps<GraphNode>) {
  const config = getConfig(data.configId);
  const result = useGraph((s) => s.results[id]);
  if (!config) return <div className="nf-node nf-node-error">未知节点</div>;

  // 订阅画布缩放:描边像素不随缩放变化;缩放到一定程度后隐藏节点内部文字
  const zoom = useStore((s) => s.transform[2]);
  const { theme } = useTheme();
  const borderWidth = Math.max(0.75, 2 / zoom);
  const bodyHidden = zoom < 0.55;

  // 统计每个端口上的实际连线数 → 多连线端口纵向拉伸,区分不同线的连接终点
  const edges = useGraph((s) => s.edges);
  const inCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) if (e.target === id && e.targetHandle) m.set(e.targetHandle, (m.get(e.targetHandle) ?? 0) + 1);
    return m;
  }, [edges, id]);
  const outCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) if (e.source === id && e.sourceHandle) m.set(e.sourceHandle, (m.get(e.sourceHandle) ?? 0) + 1);
    return m;
  }, [edges, id]);
  /** 端口高度:未连线/单连线为 11px 圆角方块;每多 1 条连线纵向延长 10px,上限 64px。
      所在行高度取 max(18, 端口高度),保证文字行不被压缩 */
  const handleH = (c: number) => (c <= 1 ? 11 : Math.min(64, 11 + (c - 1) * 10));
  const rowH = (c: number) => Math.max(18, handleH(c));

  const cat = CATEGORY_INFO[config.category];
  // 暗色主题下顶栏提亮,提升白字可读性
  const headerBg = theme === 'dark' ? lighten(cat.color, 0.22) : cat.color;
  const inputs = result?.inputs ?? {};
  const inputCount = Object.keys(inputs).length;
  const outputCount = config.outputs.filter((o) => result?.outputs?.[o.id]).length;
  const summary = paramSummary(data.params, config.params.filter((p) => p.type !== 'button').slice(0, 3).map((p) => p.key));
  // 暴露参数:生成同名输入口(类型 any,可接收表格/曲线等数据列)
  const exposedSockets = (data.exposed ?? [])
    .map((k) => config.params.find((p) => p.key === k))
    .filter((p): p is NonNullable<typeof p> => !!p && p.type !== 'button');
  // 折叠状态:仅显示接口与标题栏
  const collapsed = !!data.collapsed;

  return (
    <div
      className={`nf-node ${selected ? 'nf-selected' : ''} ${collapsed ? 'nf-node-collapsed' : ''}`}
      style={{
        width: config.isViewer ? 440 : 260,
        borderWidth,
        boxShadow: selected
          ? `0 0 0 ${1 / zoom}px var(--accent), 0 0 0 ${3 / zoom}px var(--accent-glow)`
          : undefined,
      }}
    >
      <div className="nf-node-header" style={{ background: headerBg, borderColor: headerBg }}>
        <span className="nf-cat-icon">{cat.icon}</span>
        <span className="nf-node-title">{config.label}</span>
        <span className="nf-collapse-ind" title="右键节点可折叠/展开">
          {collapsed ? '▸' : '▾'}
        </span>
        {result?.error && <span className="nf-node-badge" title={result.error}>!</span>}
      </div>

      <div className={`nf-node-body nodrag${bodyHidden ? ' nf-zoom-min' : ''}`}>
        <div className="nf-sockets">
          <div className="nf-sockets-col">
            {config.inputs.map((sock) => {
              const h = handleH(inCount.get(sock.id) ?? 0);
              return (
                <div key={sock.id} className="nf-socket nf-socket-in" style={{ minHeight: rowH(inCount.get(sock.id) ?? 0) }}>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={sock.id}
                    className="nf-handle"
                    style={{ background: SOCKET_COLOR[sock.type], height: h }}
                  />
                  <span className="nf-socket-name" title={SOCKET_LABEL[sock.type]}>
                    {sock.name}
                  </span>
                  <span className="nf-socket-type" style={{ color: SOCKET_COLOR[sock.type] }}>
                    {SOCKET_LABEL[sock.type]}
                  </span>
                </div>
              );
            })}
            {exposedSockets.map((p) => {
              const h = handleH(inCount.get(`exp_${p.key}`) ?? 0);
              return (
                <div key={`exp_${p.key}`} className="nf-socket nf-socket-in nf-socket-exposed" style={{ minHeight: rowH(inCount.get(`exp_${p.key}`) ?? 0) }}>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`exp_${p.key}`}
                    className="nf-handle nf-handle-exp"
                    style={{ background: '#94a3b8', height: h }}
                  />
                  <span className="nf-socket-name" title={`暴露参数:接入数据列驱动${p.label}`}>
                    {p.label}
                  </span>
                  <span className="nf-socket-type" style={{ color: '#94a3b8' }}>
                    数据
                  </span>
                </div>
              );
            })}
            {config.inputs.length === 0 && exposedSockets.length === 0 && <div className="nf-socket-empty">无输入</div>}
          </div>
          <div className="nf-sockets-col nf-sockets-col-out">
            {config.outputs.map((sock) => {
              const h = handleH(outCount.get(sock.id) ?? 0);
              return (
                <div key={sock.id} className="nf-socket nf-socket-out" style={{ minHeight: rowH(outCount.get(sock.id) ?? 0) }}>
                  <span className="nf-socket-name" title={SOCKET_LABEL[sock.type]}>
                    {sock.name}
                  </span>
                  <span className="nf-socket-type" style={{ color: SOCKET_COLOR[sock.type] }}>
                    {SOCKET_LABEL[sock.type]}
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={sock.id}
                    className="nf-handle"
                    style={{ background: SOCKET_COLOR[sock.type], height: h }}
                  />
                </div>
              );
            })}
            {config.outputs.length === 0 && <div className="nf-socket-empty">无输出</div>}
          </div>
        </div>

        {!collapsed && (
          <>
            {summary && <div className="nf-param-line">{summary}</div>}

            {config.isViewer && (
              <div className="nf-viewer">
                <ViewerRender nodeId={id} config={config} />
                {inputCount === 0 && !result?.error && (
                  <div className="nf-viewer-empty">请连接数据</div>
                )}
              </div>
            )}

            {config.outputs.length > 0 && (
              <div className="nf-outputs-line">
                <span className={`nf-dot ${outputCount > 0 ? 'nf-dot-on' : ''}`} />
                <span className="nf-outputs-text">
                  {outputCount}/{config.outputs.length} 输出{result?.error ? ' · 出错' : ''}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {!collapsed && result?.error && <div className="nf-error nodrag">{result.error}</div>}
    </div>
  );
});
