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
        右键新建节点 · 删除键移除 · Ctrl+拖拽连线 · Ctrl+滚轮缩放画布 · 滚轮在预览窗内缩放 · Alt+悬停曲线拆分
      </span>
    </div>
  );
}
