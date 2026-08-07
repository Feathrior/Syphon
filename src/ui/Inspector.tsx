import { useMemo, useState } from 'react';
import type { Column, DataObject } from '../types/data';
import { getConfig } from '../nodes/registry';
import { useGraph } from '../store/useGraph';
import { toNum } from '../utils/math';

function TablePreview({ columns }: { columns: Column[] }) {
  const rows = columns[0]?.values.length ?? 0;
  const shown = Math.min(8, rows);
  return (
    <div className="nf-table-wrap">
      <table className="nf-table">
        <thead>
          <tr>
            <th>#</th>
            {columns.map((c) => (
              <th key={c.name}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: shown }, (_, r) => (
            <tr key={r}>
              <td>{r}</td>
              {columns.map((c) => (
                <td key={c.name}>{c.values[r] === null ? '—' : String(c.values[r])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows > shown && <div className="nf-table-more">…共 {rows} 行</div>}
    </div>
  );
}

function ObjectPreview({ obj }: { obj: DataObject }) {
  switch (obj.kind) {
    case 'table':
      return <TablePreview columns={obj.columns} />;
    case 'series':
    case 'scatter': {
      const pts = obj.points.slice(0, 12);
      return (
        <div className="nf-table-wrap">
          <table className="nf-table">
            <thead>
              <tr>
                <th>#</th>
                <th>x</th>
                <th>y</th>
                {obj.kind === 'scatter' && <th>z</th>}
              </tr>
            </thead>
            <tbody>
              {pts.map((p, i) => (
                <tr key={i}>
                  <td>{i}</td>
                  <td>{p[0]}</td>
                  <td>{p[1]}</td>
                  {obj.kind === 'scatter' && <td>{p[2] ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="nf-table-more">共 {obj.points.length} 个点</div>
        </div>
      );
    }
    case 'mesh':
      return (
        <div className="nf-obj-summary">
          <div>顶点: {obj.vertices.length}</div>
          <div>三角面: {obj.faces.length}</div>
          <div>名称: {obj.name}</div>
        </div>
      );
    case 'grid':
      return (
        <div className="nf-obj-summary">
          <div>X 范围: {obj.x[0]} ~ {obj.x[obj.x.length - 1]}({obj.x.length})</div>
          <div>Y 范围: {obj.y[0]} ~ {obj.y[obj.y.length - 1]}({obj.y.length})</div>
          <div>Z 范围: {Math.min(...obj.values.flat().filter(Number.isFinite))} ~ {Math.max(...obj.values.flat().filter(Number.isFinite))}</div>
        </div>
      );
    case 'distribution':
      return (
        <div className="nf-table-wrap">
          <table className="nf-table">
            <thead>
              <tr>
                <th>区间</th>
                <th>计数</th>
              </tr>
            </thead>
            <tbody>
              {obj.bins.slice(0, 12).map((b, i) => (
                <tr key={i}>
                  <td>[{b.x0.toFixed(3)}, {b.x1.toFixed(3)})</td>
                  <td>{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="nf-table-more">共 {obj.bins.length} 组, {obj.sampleCount} 个样本</div>
        </div>
      );
    case 'axes':
      return (
        <div className="nf-obj-summary">
          <div>维度: {obj.dim}D</div>
          <div>像素: {obj.xLen} × {obj.yLen} × {obj.zLen}</div>
          <div>范围: X {obj.xMin}~{obj.xMax} / Y {obj.yMin}~{obj.yMax}{obj.dim === 3 ? ` / Z ${obj.zMin}~${obj.zMax}` : ''}</div>
          <div>定位: {obj.axisOrigin === 'origin' ? '以原点为中心' : '总贴左边沿'}{obj.grid ? ' · 网格开' : ' · 网格关'}{obj.showBorder ? ' · 边框开' : ' · 边框关'}</div>
          <div>标签: {obj.labelX} / {obj.labelY} / {obj.labelZ}</div>
        </div>
      );
  }
}

export default function Inspector() {
  const [tab, setTab] = useState<'data' | 'log'>('data');
  const selectedId = useGraph((s) => s.selectedId);
  // 只订阅所选节点的 data 引用 —— 拖拽位置时 data 引用不变,避免每帧重渲染 Inspector。
  // 需要全量节点信息时用 getState() 按需读取(如错误列表的 configId 查找)
  const selectedData = useGraph((s) => s.nodes.find((n) => n.id === s.selectedId)?.data);
  const results = useGraph((s) => s.results);
  const hasCycle = useGraph((s) => s.hasCycle);
  const lastError = useGraph((s) => s.lastError);

  const config = selectedData ? getConfig(selectedData.configId) : undefined;
  const result = selectedId ? results[selectedId] : undefined;
  const logs = useGraph((s) => s.logs);

  const errors = useMemo(() => {
    const list: { nodeId: string; label: string; msg: string }[] = [];
    const allNodes = useGraph.getState().nodes;
    for (const [id, r] of Object.entries(results)) {
      if (r.error) {
        const cfg = getConfig(allNodes.find((n) => n.id === id)?.data.configId ?? '');
        list.push({ nodeId: id, label: cfg?.label ?? id, msg: r.error });
      }
    }
    return list;
  }, [results]);

  return (
    <div className="nf-inspector">
      <div className="nf-inspector-tabs">
        <button
          className={`nf-inspector-tab ${tab === 'data' ? 'nf-inspector-tab-active' : ''}`}
          onClick={() => setTab('data')}
        >
          数据预览
        </button>
        <button
          className={`nf-inspector-tab ${tab === 'log' ? 'nf-inspector-tab-active' : ''}`}
          onClick={() => setTab('log')}
        >
          日志
          {errors.length > 0 && <span className="nf-log-badge">{errors.length}</span>}
        </button>
      </div>
      <div className="nf-inspector-body">
        {tab === 'data' ? (
          !selectedData || !result ? (
            <div className="nf-inspector-hint">点击节点查看输出数据预览</div>
          ) : (
            <div className="nf-inspector-data">
              <div className="nf-inspector-title">
                {config?.label} 的输出
              </div>
              {Object.entries(result.outputs).map(([id, obj]) => (
                <div key={id} className="nf-inspector-block">
                  <div className="nf-inspector-block-title">{id} · {obj.kind}</div>
                  <ObjectPreview obj={obj} />
                </div>
              ))}
              {Object.keys(result.outputs).length === 0 && (
                <div className="nf-inspector-hint">
                  {result.error ? `执行出错:${result.error}` : config?.isViewer ? '此节点为可视化节点,查看节点内图表' : '该节点无输出'}
                </div>
              )}
            </div>
          )
        ) : (
          <div className="nf-inspector-log">
            {logs.map((l) => (
              <div
                key={l.id}
                className={`nf-log-line ${l.level === 'error' ? 'nf-log-error' : l.level === 'ok' ? 'nf-log-ok' : ''}`}
              >
                <span className="nf-log-time">{l.time}</span> {l.msg}
              </div>
            ))}
            {logs.length > 0 && <div className="nf-log-sep" />}
            {hasCycle && <div className="nf-log-line nf-log-error">⚠ 检测到连接回路,部分节点未按顺序执行</div>}
            {lastError && <div className="nf-log-line nf-log-error">{lastError}</div>}
            {errors.length === 0 && !hasCycle && logs.length === 0 && (
              <div className="nf-log-line">执行正常,无错误。</div>
            )}
            {errors.map((e) => (
              <div key={e.nodeId} className="nf-log-line nf-log-error">
                [{e.label}] {e.msg}
              </div>
            ))}
            {Object.entries(results).filter(([, r]) => !r.error).length > 0 && (
              <div className="nf-log-line nf-log-ok">
                {Object.entries(results).filter(([, r]) => !r.error).length} 个节点执行成功
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
