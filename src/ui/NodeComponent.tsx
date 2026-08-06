import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { getConfig } from '../nodes/registry';
import { CATEGORY_INFO, SOCKET_COLOR, SOCKET_LABEL } from '../types/data';
import type { GraphNode } from '../store/useGraph';
import { useGraph } from '../store/useGraph';
import { ViewerRender } from './ViewerRender';

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

  const cat = CATEGORY_INFO[config.category];
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
      style={{ width: config.isViewer ? 440 : 260 }}
    >
      <div className="nf-node-header" style={{ background: `linear-gradient(90deg, ${cat.color}33, ${cat.color}0d)`, borderColor: `${cat.color}66` }}>
        <span className="nf-cat-icon" style={{ color: cat.color }}>
          {cat.icon}
        </span>
        <span className="nf-node-title">{config.label}</span>
        <span className="nf-collapse-ind" title="右键节点可折叠/展开">
          {collapsed ? '▸' : '▾'}
        </span>
        {result?.error && <span className="nf-node-badge" title={result.error}>!</span>}
      </div>

      <div className="nf-node-body nodrag">
        <div className="nf-sockets">
          <div className="nf-sockets-col">
            {config.inputs.map((sock) => (
              <div key={sock.id} className="nf-socket nf-socket-in">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={sock.id}
                  className="nf-handle"
                  style={{ background: SOCKET_COLOR[sock.type] }}
                />
                <span className="nf-socket-name" title={SOCKET_LABEL[sock.type]}>
                  {sock.name}
                </span>
                <span className="nf-socket-type" style={{ color: SOCKET_COLOR[sock.type] }}>
                  {SOCKET_LABEL[sock.type]}
                </span>
              </div>
            ))}
            {exposedSockets.map((p) => (
              <div key={`exp_${p.key}`} className="nf-socket nf-socket-in nf-socket-exposed">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`exp_${p.key}`}
                  className="nf-handle nf-handle-exp"
                  style={{ background: '#94a3b8' }}
                />
                <span className="nf-socket-name" title={`暴露参数:接入数据列驱动${p.label}`}>
                  {p.label}
                </span>
                <span className="nf-socket-type" style={{ color: '#94a3b8' }}>
                  数据
                </span>
              </div>
            ))}
            {config.inputs.length === 0 && exposedSockets.length === 0 && <div className="nf-socket-empty">无输入</div>}
          </div>
          <div className="nf-sockets-col nf-sockets-col-out">
            {config.outputs.map((sock) => (
              <div key={sock.id} className="nf-socket nf-socket-out">
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
                  style={{ background: SOCKET_COLOR[sock.type] }}
                />
              </div>
            ))}
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
