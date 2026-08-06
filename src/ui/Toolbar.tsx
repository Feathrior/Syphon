import { useReactFlow } from '@xyflow/react';
import { useGraph } from '../store/useGraph';
import { pickJsonFile, saveTextFile } from '../utils/tauri';

interface Props {
  boxSelect: boolean;
  setBoxSelect: (v: boolean) => void;
}

export default function Toolbar({ boxSelect, setBoxSelect }: Props) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const autoRun = useGraph((s) => s.autoRun);
  const setAutoRun = useGraph((s) => s.setAutoRun);
  const bumpRun = useGraph((s) => s.bumpRun);
  const clearAll = useGraph((s) => s.clearAll);
  const saveGraph = useGraph((s) => s.saveGraph);
  const loadGraph = useGraph((s) => s.loadGraph);
  const autoLayout = useGraph((s) => s.autoLayout);
  const nodeCount = useGraph((s) => s.nodes.length);
  const edgeCount = useGraph((s) => s.edges.length);
  const hasCycle = useGraph((s) => s.hasCycle);

  const handleClear = () => {
    if (nodeCount === 0) return;
    if (window.confirm('确定清空画布上的所有节点吗?')) clearAll();
  };

  const handleSave = async () => {
    if (nodeCount === 0) return;
    const json = saveGraph();
    const ok = await saveTextFile(json, 'syphon-graph.json');
    if (!ok) window.alert('保存画布失败');
  };

  const handleLoad = async () => {
    const text = await pickJsonFile();
    if (text === null) return;
    if (!loadGraph(text)) {
      window.alert('画布文件格式无效,无法加载');
    } else {
      setTimeout(() => fitView({ padding: 0.25 }), 50);
    }
  };

  const handleAutoLayout = () => {
    if (nodeCount === 0) return;
    autoLayout();
    setTimeout(() => fitView({ padding: 0.25 }), 50);
  };

  return (
    <div className="nf-toolbar">
      <div className="nf-brand">
        <span className="nf-brand-mark">S</span>
        <span className="nf-brand-text">Syphon 节点化数据处理</span>
      </div>

      <div className="nf-toolbar-group">
        <button
          className={`nf-btn ${boxSelect ? 'nf-btn-active' : ''}`}
          onClick={() => setBoxSelect(!boxSelect)}
          title="切换框选模式(类似 Blender 的 B 键框选)"
        >
          框选
        </button>
        <button className="nf-btn" onClick={() => fitView()} title="适应视图 (Home)">
          适应视图
        </button>
        <button className="nf-btn" onClick={() => zoomIn()} title="放大">
          +
        </button>
        <button className="nf-btn" onClick={() => zoomOut()} title="缩小">
          −
        </button>
      </div>

      <div className="nf-toolbar-group">
        <label className="nf-check" title="图元变更后自动重新执行">
          <input
            type="checkbox"
            checked={autoRun}
            onChange={(e) => setAutoRun(e.target.checked)}
          />
          自动执行
        </label>
        <button className="nf-btn nf-btn-primary" onClick={bumpRun} title="立即重新执行 (F5)">
          执行
        </button>
        <button className="nf-btn nf-btn-danger" onClick={handleClear} title="清空画布">
          清空
        </button>
      </div>

      <div className="nf-toolbar-group">
        <button className="nf-btn" onClick={handleSave} title="将当前画布保存为 JSON 文件">
          保存
        </button>
        <button className="nf-btn" onClick={handleLoad} title="从 JSON 文件加载画布">
          加载
        </button>
        <button className="nf-btn" onClick={handleAutoLayout} title="按数据流向分层自动排列节点">
          一键整理
        </button>
      </div>

      <div className="nf-toolbar-right">
        {hasCycle && <span className="nf-warn">⚠ 连接存在回路</span>}
        <span className="nf-stat">{nodeCount} 节点 · {edgeCount} 连接</span>
        <kbd className="nf-kbd">Shift + A</kbd>
        <span className="nf-stat">新建节点</span>
      </div>
    </div>
  );
}
