import { useMemo, useState } from 'react';
import type { Category } from '../types/data';
import { CATEGORY_INFO } from '../types/data';
import { nodeConfigs } from '../nodes/registry';
import { useGraph } from '../store/useGraph';

interface Props {
  x: number;
  y: number;
  flowPos: { x: number; y: number };
  nodeId?: string;
  onClose: () => void;
}

const CATS: Category[] = ['input', 'clean', 'compute', 'transform', 'visualize'];

export default function ContextMenu({ x, y, flowPos, nodeId, onClose }: Props) {
  const addNode = useGraph((s) => s.addNode);
  const removeNodes = useGraph((s) => s.removeNodes);
  const duplicateNodes = useGraph((s) => s.duplicateNodes);
  const [hovered, setHovered] = useState<Category>('input');
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodeConfigs.filter((c) => c.category === hovered);
    return nodeConfigs.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
  }, [hovered, query]);

  const handleAdd = (configId: string) => {
    addNode(configId, flowPos);
    onClose();
  };

  const left = Math.min(x, window.innerWidth - 480);
  const top = Math.min(y, window.innerHeight - 460);

  return (
    <>
      <div className="nf-menu-overlay" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="nf-menu" style={{ left, top }}>
        {nodeId && (
          <div className="nf-menu-actions">
            <button
              className="nf-menu-action"
              onClick={() => {
                duplicateNodes([nodeId]);
                onClose();
              }}
            >
              复制节点
            </button>
            <button
              className="nf-menu-action nf-menu-action-danger"
              onClick={() => {
                removeNodes([nodeId]);
                onClose();
              }}
            >
              删除节点
            </button>
          </div>
        )}
        <div className="nf-menu-title">新建节点</div>
        <input
          className="nf-menu-search"
          autoFocus
          placeholder="搜索节点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && items.length > 0) handleAdd(items[0].id);
            if (e.key === 'Escape') onClose();
          }}
        />
        {query.trim() ? (
          <div className="nf-menu-flat">
            {items.map((c) => (
              <div key={c.id} className="nf-menu-item" onClick={() => handleAdd(c.id)}>
                <span className="nf-cat-dot" style={{ background: CATEGORY_INFO[c.category].color }} />
                <span className="nf-menu-item-label">{c.label}</span>
                <span className="nf-menu-item-cat">{CATEGORY_INFO[c.category].label}</span>
              </div>
            ))}
            {items.length === 0 && <div className="nf-menu-empty">无匹配节点</div>}
          </div>
        ) : (
          <div className="nf-menu-body">
            <div className="nf-menu-cats">
              {CATS.map((cat) => (
                <div
                  key={cat}
                  className={`nf-menu-cat ${cat === hovered ? 'nf-menu-cat-active' : ''}`}
                  onMouseEnter={() => setHovered(cat)}
                  onClick={() => setHovered(cat)}
                >
                  <span style={{ color: CATEGORY_INFO[cat].color }}>{CATEGORY_INFO[cat].icon}</span>
                  <span>{CATEGORY_INFO[cat].label}</span>
                </div>
              ))}
            </div>
            <div className="nf-menu-items">
              {items.map((c) => (
                <div key={c.id} className="nf-menu-item" onClick={() => handleAdd(c.id)} title={c.description}>
                  <span className="nf-cat-dot" style={{ background: CATEGORY_INFO[c.category].color }} />
                  <span className="nf-menu-item-label">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="nf-menu-hint">单击添加 · Enter 快捷添加</div>
      </div>
    </>
  );
}
