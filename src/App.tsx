import { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useGraph } from './store/useGraph';
import { runGraph } from './nodes/execEngine';
import { useSettings } from './utils/settings';
import NodeCanvas from './ui/NodeCanvas';
import ContextMenu from './ui/ContextMenu';
import Toolbar from './ui/Toolbar';
import PropertiesPanel from './ui/PropertiesPanel';
import Inspector from './ui/Inspector';
import StatusBar from './ui/StatusBar';
import SettingsPanel from './ui/SettingsPanel';
import './styles.css';

function AppInner() {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const autoRun = useGraph((s) => s.autoRun);
  const runVersion = useGraph((s) => s.runVersion);
  const setResults = useGraph((s) => s.setResults);
  const addNode = useGraph((s) => s.addNode);
  const onConnect = useGraph((s) => s.onConnect);
  const updateNodeParams = useGraph((s) => s.updateNodeParams);
  const toggleExposed = useGraph((s) => s.toggleExposed);
  const undo = useGraph((s) => s.undo);
  const redo = useGraph((s) => s.redo);
  const { screenToFlowPosition } = useReactFlow();

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    flowPos: { x: number; y: number };
    nodeId?: string;
  } | null>(null);
  const [boxSelect, setBoxSelect] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bootstrapped = useRef(false);

  // 启动时从配置文件恢复设置偏好(自动执行 / 主题等)
  useEffect(() => {
    useSettings.getState().init();
  }, []);

  // 设置 → 主题:应用到界面并保持与旧版 localStorage 键的兼容
  // 切换瞬间完成:挂载 nf-no-anim 禁用全局过渡动画,下一帧移除(亮/暗互转无动画)
  const settingsTheme = useSettings((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('nf-no-anim');
    root.dataset.theme = settingsTheme;
    try {
      localStorage.setItem('syphon-theme', settingsTheme);
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => root.classList.remove('nf-no-anim'));
  }, [settingsTheme]);

  // 设置 → 自动执行:同步到图数据流 store,保证执行引擎与设置面板一致
  const settingsAutoRun = useSettings((s) => s.autoRun);
  useEffect(() => {
    useGraph.setState({ autoRun: settingsAutoRun });
  }, [settingsAutoRun]);

  // 初始化示例场景(表格→散点→原理化输出 / 网格→原理化 / 表格→预制图)
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    // 热更新/重挂载时若画布已有内容则不再重复添加
    if (useGraph.getState().nodes.length > 0) return;
    // 演示:表格 → 多路散点/曲线 → 原理化输出(多连接); 表格 → 火山图; 表格 → 数据输出(表格预览)
    const t = addNode('table_input', { x: 40, y: -140 });
    const ts1 = addNode('table_to_scatter', { x: 360, y: -240 });
    const ts2 = addNode('table_to_scatter', { x: 360, y: -80 });
    const tline = addNode('table_to_series', { x: 360, y: 80 });
    const vp = addNode('viz_principled', { x: 720, y: -160 });
    const ax = addNode('axis_input', { x: 720, y: 100 });
    const vps = addNode('viz_preset', { x: 40, y: 340 });
    const out = addNode('data_output', { x: 720, y: 340 });
    updateNodeParams(ts1, { xCol: 'log2FC', yCol: 'exprA', pointShape: 'circle', pointSize: 5, pointColor: '#1f77b4' });
    updateNodeParams(ts2, { xCol: 'exprB', yCol: 'exprA', pointShape: 'diamond', pointSize: 5, pointColor: '#d62728' });
    updateNodeParams(tline, { xCol: 'log2FC', yCol: 'exprA', lineStyle: 'solid', lineWidth: 2.5, lineColor: '#ff7f0e' });
    updateNodeParams(ax, { xLen: 16, yLen: 10, zLen: 8 });
    updateNodeParams(vps, { chartType: 'volcano' });
    // 演示暴露参数:将 ts1 的"点大小"暴露为输入口,并把表格首列(log2FC)接入 → 逐点大小与该行数值成正比
    toggleExposed(ts1, 'pointSize');
    onConnect({ source: t, target: ts1, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: t, target: ts2, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: t, target: tline, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: t, target: ts1, sourceHandle: 'out0', targetHandle: 'exp_pointSize' });
    onConnect({ source: ts1, target: vp, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: ts2, target: vp, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: tline, target: vp, sourceHandle: 'out0', targetHandle: 'in1' });
    onConnect({ source: ax, target: vp, sourceHandle: 'out0', targetHandle: 'in4' });
    onConnect({ source: t, target: vps, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: t, target: out, sourceHandle: 'out0', targetHandle: 'in0' });
  }, [addNode, onConnect, updateNodeParams, toggleExposed]);

  // 节点执行引擎
  useEffect(() => {
    if (!autoRun) return;
    const liteNodes = nodes.map((n) => ({
      id: n.id,
      configId: n.data.configId,
      params: n.data.params,
    }));
    const liteEdges = edges.map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));
    const outcome = runGraph(liteNodes, liteEdges);
    setResults(outcome.results, outcome.hasCycle, outcome.hasCycle ? '检测到连接回路' : null);
  }, [nodes, edges, autoRun, runVersion, setResults]);

  // 键盘快捷键:Ctrl+Z/Y 撤销重做、Escape 关闭菜单等
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const editing = t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      // Ctrl+Z 撤销 / Ctrl+Y、Ctrl+Shift+Z 重做(输入框聚焦时不拦截)
      if ((e.ctrlKey || e.metaKey) && !editing) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
          return;
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          redo();
          return;
        }
      }
      if (e.key === 'Escape') {
        setMenu(null);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screenToFlowPosition, undo, redo]);

  const openMenu = (x: number, y: number, nodeId?: string) => {
    setMenu({ x, y, flowPos: screenToFlowPosition({ x, y }), nodeId });
  };

  return (
    <div className="nf-app">
      <Toolbar boxSelect={boxSelect} setBoxSelect={setBoxSelect} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="nf-main">
        <NodeCanvas onOpenMenu={openMenu} boxSelect={boxSelect} />
        <PropertiesPanel />
      </div>
      <Inspector />
      <StatusBar />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          flowPos={menu.flowPos}
          nodeId={menu.nodeId}
          onClose={() => setMenu(null)}
        />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}
