import type { ParamSpec, PointInput } from '../types/data';
import { getConfig } from '../nodes/registry';
import { CATEGORY_INFO, SOCKET_LABEL } from '../types/data';
import { useGraph } from '../store/useGraph';
import { pickDataFile } from '../utils/tauri';
import { excelBufferToCsv } from '../utils/csv';

function describeOutput(obj: import('../types/data').DataObject | null): string {
  if (!obj) return '';
  switch (obj.kind) {
    case 'table':
      return `${obj.columns.length} 列 × ${obj.columns[0]?.values.length ?? 0} 行`;
    case 'series':
    case 'scatter':
      return `${obj.points.length} 个点`;
    case 'mesh':
      return `${obj.vertices.length} 顶点 / ${obj.faces.length} 面`;
    case 'grid':
      return `${obj.x.length} × ${obj.y.length} 网格`;
    case 'distribution':
      return `${obj.bins.length} 组 / ${obj.sampleCount} 样本`;
    case 'axes':
      return `${obj.dim}D ${obj.xLen}×${obj.yLen}×${obj.zLen} ${obj.xMin}~${obj.xMax}/${obj.yMin}~${obj.yMax} ${obj.axisOrigin === 'origin' ? '原点居中' : '贴左沿'}`;
    case 'text':
      return `"${obj.text}" ${obj.fontSize}cm ${obj.halign}/${obj.valign}`;
    case 'colorbar':
      return `${obj.stops.length} 段渐变 ${obj.min}~${obj.max}${obj.horizontal === false ? '(垂直)' : ''}`;
  }
}

function getOutput(obj: unknown): import('../types/data').DataObject | null {
  return typeof obj === 'object' && obj !== null ? (obj as import('../types/data').DataObject) : null;
}

function ParamControl({
  spec,
  value,
  onChange,
  nodeId,
}: {
  spec: ParamSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  nodeId: string;
}) {
  const updateNodeParams = useGraph((s) => s.updateNodeParams);
  if (spec.type === 'button') {
    return (
      <button
        className="nf-btn nf-btn-sm nf-btn-import"
        onClick={async () => {
          const file = await pickDataFile();
          if (file === null) return;
          const lower = file.name.toLowerCase();
          let text: string;
          if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
            text = excelBufferToCsv(file.buffer);
          } else {
            text = new TextDecoder().decode(file.buffer);
          }
          if (!text.trim()) return;
          const delimiter = text.includes('\t') && !text.includes(',') ? 'tsv' : 'csv';
          updateNodeParams(nodeId, { mode: 'manual', dataText: text, delimiter });
        }}
      >
        选择 CSV/Excel 文件…
      </button>
    );
  }
  const v = value ?? spec.default;
  switch (spec.type) {
    case 'select':
      return (
        <select value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <input type="checkbox" checked={!!v} onChange={(e) => onChange(e.target.checked)} />
      );
    case 'number':
      return (
        <input
          type="number"
          value={String(v ?? '')}
          step={spec.step}
          min={spec.min}
          max={spec.max}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'range':
      return (
        <div className="nf-range-row">
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={Number(v)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="nf-range-val">{Number(v).toFixed(2)}</span>
        </div>
      );
    case 'color':
      return (
        <div className="nf-color-row">
          <input type="color" value={String(v ?? '#888888')} onChange={(e) => onChange(e.target.value)} />
          <input type="text" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case 'textarea':
      return (
        <textarea
          rows={4}
          placeholder={spec.placeholder}
          value={String(v ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'points': {
      // 聚合点编辑器:每点独立设置 x/y 坐标、大小、形状、颜色,可不断添加
      const pts = (Array.isArray(v) ? v : []) as PointInput[];
      const setPt = (i: number, patch: Partial<PointInput>) => {
        onChange(pts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
      };
      return (
        <div className="nf-points-editor">
          {pts.map((p, i) => (
            <div key={i} className="nf-point-row">
              <div className="nf-point-fields">
                <label>X</label>
                <input
                  type="number"
                  step="0.1"
                  value={String(p.x ?? '')}
                  onChange={(e) => setPt(i, { x: e.target.value === '' ? '' : Number(e.target.value) })}
                />
                <label>Y</label>
                <input
                  type="number"
                  step="0.1"
                  value={String(p.y ?? '')}
                  onChange={(e) => setPt(i, { y: e.target.value === '' ? '' : Number(e.target.value) })}
                />
                <label>大小</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={String(p.size ?? 4)}
                  onChange={(e) => setPt(i, { size: e.target.value === '' ? '' : Number(e.target.value) })}
                />
                <label>形状</label>
                <select
                  value={p.shape ?? 'circle'}
                  onChange={(e) => setPt(i, { shape: e.target.value as PointInput['shape'] })}
                >
                  <option value="circle">圆形</option>
                  <option value="square">方形</option>
                  <option value="diamond">菱形</option>
                  <option value="triangle">三角形</option>
                </select>
                <label>颜色</label>
                <input
                  type="color"
                  value={p.color || '#1f77b4'}
                  onChange={(e) => setPt(i, { color: e.target.value })}
                />
              </div>
              <button
                className="nf-point-del"
                title="删除该点"
                onClick={() => onChange(pts.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="nf-btn nf-btn-sm nf-point-add"
            onClick={() => onChange([...pts, { x: 0, y: 0, size: 4, shape: 'circle', color: '#1f77b4' }])}
          >
            ＋ 添加点
          </button>
        </div>
      );
    }
    case 'gradient': {
      // 渐变色带编辑器:顶部预览条(点击添加停止点) + 停止点列表(调整位置/颜色/删除)
      const stops = (Array.isArray(v) ? v : []).map((s, i) => ({
        ...(typeof s === 'object' && s !== null ? (s as import('../types/data').GradientStop) : { offset: i / 2, color: '#888888' }),
      }));
      const previewCss = `linear-gradient(to right, ${stops
        .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
        .join(', ')})`;
      const addStop = (offset: number) => {
        const clamped = Math.max(0, Math.min(1, offset));
        const sorted = [...stops, { offset: clamped, color: '#f97316' }].sort((a, b) => a.offset - b.offset);
        onChange(sorted);
      };
      const setStop = (i: number, patch: Partial<import('../types/data').GradientStop>) => {
        onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)).sort((a, b) => a.offset - b.offset));
      };
      return (
        <div className="nf-gradient-editor">
          <div
            className="nf-gradient-bar"
            style={{ background: previewCss }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              addStop((e.clientX - rect.left) / rect.width);
            }}
            title="点击添加停止点"
          />
          <div className="nf-gradient-stops">
            {stops.map((s, i) => (
              <div key={i} className="nf-gradient-stop-row">
                <span className="nf-gradient-swatch" style={{ background: s.color }} />
                <label>位置</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={String(s.offset)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setStop(i, { offset: Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0 });
                  }}
                />
                <label>颜色</label>
                <input type="color" value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} />
                <button
                  className="nf-point-del"
                  title="删除该停止点"
                  onClick={() => onChange(stops.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button className="nf-btn nf-btn-sm nf-point-add" onClick={() => addStop(0.5)}>
            ＋ 添加停止点
          </button>
        </div>
      );
    }
    default:
      return (
        <input
          type="text"
          placeholder={spec.placeholder}
          value={String(v ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export default function PropertiesPanel() {
  const selectedId = useGraph((s) => s.selectedId);
  // 只订阅所选节点的 data 引用 —— 拖拽位置时 data 引用不变,避免每帧重渲染属性面板
  const selectedData = useGraph((s) => s.nodes.find((n) => n.id === s.selectedId)?.data);
  const results = useGraph((s) => s.results);
  const updateNodeParams = useGraph((s) => s.updateNodeParams);
  const toggleExposed = useGraph((s) => s.toggleExposed);
  const removeNodes = useGraph((s) => s.removeNodes);
  const duplicateNodes = useGraph((s) => s.duplicateNodes);

  const config = selectedData ? getConfig(selectedData.configId) : undefined;
  const exposedKeys = selectedData?.exposed ?? [];

  return (
    <aside className="nf-props">
      {!selectedData || !config ? (
        <div className="nf-props-empty">
          <div className="nf-props-empty-title">未选择节点</div>
          <p>在画布右键弹出"新建节点"菜单,添加节点开始构建数据处理流程。</p>
          <ul className="nf-help-list">
            <li><b>组输入</b> — 表格 / 坐标轴 / 线 / 面 / 网格</li>
            <li><b>数据初步</b> — 清洗 / 标准化 / 筛选 / 抽样</li>
            <li><b>数据运算</b> — 求导 / 积分 / 拟合 / 平滑</li>
            <li><b>数据转化</b> — 行列提取 / 转散点 / 转曲线 / 转分布</li>
            <li><b>数据可视化</b> — 预制图表 + 原理化输出</li>
          </ul>
        </div>
      ) : (
        <div className="nf-props-body">
          <div className="nf-props-head" style={{ borderColor: `${CATEGORY_INFO[config.category].color}55` }}>
            <div className="nf-props-title">
              <span style={{ color: CATEGORY_INFO[config.category].color }}>{CATEGORY_INFO[config.category].icon}</span>
              {config.label}
            </div>
            <div className="nf-props-cat" style={{ color: CATEGORY_INFO[config.category].color }}>
              {CATEGORY_INFO[config.category].label}
            </div>
          </div>
          <div className="nf-props-desc">{config.description}</div>

          {config.params.length > 0 && (
            <div className="nf-props-section">
              <div className="nf-props-section-title">参数</div>
              {config.params.map((p) => {
                const isExposed = exposedKeys.includes(p.key);
                return (
                  <div key={p.key} className="nf-param-row">
                    <div className="nf-param-head">
                      <label className="nf-param-label" title={p.help}>
                        {p.label}
                      </label>
                      {p.type !== 'button' && (p as { expose?: boolean }).expose && (
                        <button
                          className={`nf-expose-btn ${isExposed ? 'nf-expose-on' : ''}`}
                          title={
                            isExposed
                              ? '已暴露(点击取消):节点上已生成输入口,接入数据列后逐点驱动该参数'
                              : '暴露(点击启用):在节点上生成输入口,可接入表格数据列逐点驱动该参数'
                          }
                          onClick={() => toggleExposed(selectedId!, p.key)}
                        >
                          <span className="nf-expose-dot" />
                        </button>
                      )}
                    </div>
                    <ParamControl
                      spec={p}
                      nodeId={selectedId!}
                      value={selectedData!.params[p.key]}
                      onChange={(v) => updateNodeParams(selectedId!, { [p.key]: v })}
                    />
                    {p.help && <div className="nf-param-help">{p.help}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {config.outputs.length > 0 && (
            <div className="nf-props-section">
              <div className="nf-props-section-title">输出状态</div>
              {config.outputs.map((o) => {
                const obj = selectedId ? results[selectedId]?.outputs[o.id] : undefined;
                return (
                  <div key={o.id} className="nf-out-row">
                    <span className="nf-out-name">{o.name}</span>
                    <span className="nf-out-type">{SOCKET_LABEL[o.type]}</span>
                    <span className={`nf-out-val ${obj ? 'nf-out-ok' : ''}`}>
                      {obj ? describeOutput(getOutput(obj)) : '未计算'}
                    </span>
                  </div>
                );
              })}
              {selectedId && results[selectedId]?.error && (
                <div className="nf-node-error-text">错误:{results[selectedId].error}</div>
              )}
            </div>
          )}

          <div className="nf-props-section">
            <div className="nf-props-section-title">节点操作</div>
            <div className="nf-props-actions">
              <button className="nf-btn nf-btn-sm" onClick={() => duplicateNodes([selectedId!])}>
                复制
              </button>
              <button className="nf-btn nf-btn-sm nf-btn-danger" onClick={() => removeNodes([selectedId!])}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
