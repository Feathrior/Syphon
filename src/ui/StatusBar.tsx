import { useGraph } from '../store/useGraph';

export default function StatusBar() {
  const nodeCount = useGraph((s) => s.nodes.length);
  const edgeCount = useGraph((s) => s.edges.length);
  const autoRun = useGraph((s) => s.autoRun);
  const hasCycle = useGraph((s) => s.hasCycle);

  return (
    <div className="nf-status">
      <span>节点数: {nodeCount}</span>
      <span>连接数: {edgeCount}</span>
      <span>{hasCycle ? '回路警告' : '拓扑正常'}</span>
      <span>{autoRun ? '自动执行:开' : '自动执行:关'}</span>
      <span className="nf-status-right">
        右键 / Shift+A 新建节点 · 删除键移除 · Ctrl+拖拽连线 · 滚轮缩放 · 中键平移
      </span>
    </div>
  );
}
