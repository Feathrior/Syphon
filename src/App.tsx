import { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useGraph } from './store/useGraph';
import { runGraph } from './nodes/execEngine';
import { useSettings } from './utils/settings';
import type { SocketType } from './types/data';
import NodeCanvas from './ui/NodeCanvas';
import type { MenuRequest } from './ui/NodeCanvas';
import ContextMenu from './ui/ContextMenu';
import Toolbar from './ui/Toolbar';
import PropertiesPanel from './ui/PropertiesPanel';
import Inspector from './ui/Inspector';
import StatusBar from './ui/StatusBar';
import SettingsPanel from './ui/SettingsPanel';
import ShortcutsPanel from './ui/ShortcutsPanel';
import './styles.css';

function AppInner() {
  const autoRun = useGraph((s) => s.autoRun);
  const runVersion = useGraph((s) => s.runVersion);
  const structureVersion = useGraph((s) => s.structureVersion);
  const setResults = useGraph((s) => s.setResults);
  const addNode = useGraph((s) => s.addNode);
  const onConnect = useGraph((s) => s.onConnect);
  const updateNodeParams = useGraph((s) => s.updateNodeParams);
  const toggleExposed = useGraph((s) => s.toggleExposed);
  const undo = useGraph((s) => s.undo);
  const redo = useGraph((s) => s.redo);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    flowPos: { x: number; y: number };
    nodeId?: string;
    pendingConn?: { source: string; sourceHandle: string | null; socketType: SocketType };
  } | null>(null);
  const [boxSelect, setBoxSelect] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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

  // 初始化示例场景:四条并行流水线,覆盖输入/数据初步/数据运算/数据转化/可视化全链路
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    // 热更新/重挂载时若画布已有内容则不再重复添加
    if (useGraph.getState().nodes.length > 0) return;
    const fit = () => setTimeout(() => fitView({ padding: 0.18 }), 60);

    // ── 流水线 A:表格 → 标准化 → 热力图(数据初步 + 预制可视化) ──
    const ti1 = addNode('table_input', { x: 0, y: -340 });
    updateNodeParams(ti1, { preset: 'iris' });
    const nrm = addNode('normalize', { x: 340, y: -340 });
    const heat = addNode('viz_heatmap', { x: 680, y: -340 });
    onConnect({ source: ti1, target: nrm, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: nrm, target: heat, sourceHandle: 'out0', targetHandle: 'in0' });

    // ── 流水线 B:表格 → 条件筛选 → 转散点 → 原理化输出(核心主流程) ──
    const ti2 = addNode('table_input', { x: 0, y: -60 });
    updateNodeParams(ti2, { preset: 'volcano' });
    const flt = addNode('filter', { x: 340, y: -60 });
    updateNodeParams(flt, { column: 'log2FC', min: '1' });
    const ts = addNode('table_to_scatter', { x: 680, y: -60 });
    updateNodeParams(ts, { xCol: 'log2FC', yCol: 'exprA', pointShape: 'circle', pointSize: 5, pointColor: '#1f77b4' });
    const vp = addNode('viz_principled', { x: 1020, y: -60 });
    onConnect({ source: ti2, target: flt, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: flt, target: ts, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: ts, target: vp, sourceHandle: 'out0', targetHandle: 'in0' });
    // 演示"参数暴露":点大小接入数据列 → 每个点的大小与该行 log2FC 成正比
    toggleExposed(ts, 'pointSize');
    onConnect({ source: flt, target: ts, sourceHandle: 'out0', targetHandle: 'exp_pointSize' });

    // ── 流水线 C:表格 → 转曲线 → 平滑 → 原理化输出(线输入) ──
    const tline = addNode('table_to_series', { x: 340, y: 220 });
    updateNodeParams(tline, { xCol: 'log2FC', yCol: 'exprA', lineStyle: 'solid', lineWidth: 2.5, lineColor: '#ff7f0e' });
    const sm = addNode('smooth', { x: 680, y: 220 });
    onConnect({ source: ti2, target: tline, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: tline, target: sm, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: sm, target: vp, sourceHandle: 'out0', targetHandle: 'in1' });

    // ── 流水线 D:火山图 + 数据输出(表格预览) + 坐标系 → 原理化 ──
    const vol = addNode('viz_volcano', { x: 1020, y: 220 });
    const out = addNode('data_output', { x: 680, y: 460 });
    const ax = addNode('axis_input', { x: 340, y: 460 });
    updateNodeParams(ax, { xLen: 16, yLen: 10, zLen: 8 });
    onConnect({ source: ti2, target: vol, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: ti2, target: out, sourceHandle: 'out0', targetHandle: 'in0' });
    onConnect({ source: ax, target: vp, sourceHandle: 'out0', targetHandle: 'in4' });

    fit();
  }, [addNode, onConnect, updateNodeParams, toggleExposed, fitView]);

  // 节点执行引擎:仅在结构/参数变更(structureVersion)或手动触发(runVersion)时执行全图重算。
  // 位置拖拽/选择/折叠等纯视觉变更不触发 —— getState() 读取最新数据但不订阅,避免拖拽时每帧重算
  useEffect(() => {
    if (!autoRun) return;
    const { nodes, edges } = useGraph.getState();
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
  }, [structureVersion, autoRun, runVersion, setResults]);

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

  const openMenu = (x: number, y: number, nodeId?: string, pendingConn?: MenuRequest['pendingConn']) => {
    setMenu({ x, y, flowPos: screenToFlowPosition({ x, y }), nodeId, pendingConn });
  };

  return (
    <div className="nf-app">
      <Toolbar
        boxSelect={boxSelect}
        setBoxSelect={setBoxSelect}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
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
          pendingConn={menu.pendingConn}
          onClose={() => setMenu(null)}
        />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {shortcutsOpen && <ShortcutsPanel onClose={() => setShortcutsOpen(false)} />}
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
