import { useEffect } from 'react';

interface Props {
  onClose: () => void;
}

/** 快捷键分组清单(与各文件中的实际监听保持一致) */
const GROUPS: { title: string; items: { keys: string; desc: string }[] }[] = [
  {
    title: '编辑',
    items: [
      { keys: 'Ctrl+Z', desc: '撤销' },
      { keys: 'Ctrl+Y / Ctrl+Shift+Z', desc: '重做' },
      { keys: 'Delete / Backspace', desc: '删除选中的节点 / 连线 / 分割点' },
      { keys: 'Escape', desc: '关闭菜单、设置或快捷键面板' },
    ],
  },
  {
    title: '画布',
    items: [
      { keys: 'Ctrl+滚轮', desc: '任意位置缩放画布' },
      { keys: 'Ctrl+按住左键划过连线', desc: '切断连线' },
      { keys: 'Shift+拖拽节点到连线上', desc: '把节点插入连线中间(拆分连线)' },
      { keys: '右键空白处', desc: '打开"新建节点"菜单' },
      { keys: '右键节点', desc: '折叠 / 展开节点' },
    ],
  },
  {
    title: '曲线整理',
    items: [
      { keys: 'Alt+悬停曲线', desc: '预览拆分点位置' },
      { keys: 'Alt+点击曲线', desc: '插入分割点(小圆点),曲线外观分为两段' },
      { keys: '点击小圆点', desc: '单独选中分割点(显示高亮光环)' },
      { keys: 'Delete', desc: '删除选中的分割点,曲线恢复原始形状' },
      { keys: '拖拽小圆点', desc: '调整曲线外观' },
    ],
  },
];

/** "帮助 → 快捷键"面板:列出全部快捷键,复用设置页的模态框样式 */
export default function ShortcutsPanel({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="nf-settings-overlay" onClick={onClose}>
      <div className="nf-settings nf-shortcuts" onClick={(e) => e.stopPropagation()}>
        <header className="nf-settings-head">
          <h2 className="nf-settings-title">快捷键</h2>
          <button className="nf-settings-close" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </header>

        <div className="nf-settings-content nf-shortcuts-body">
          {GROUPS.map((g) => (
            <section key={g.title} className="nf-shortcuts-group">
              <h3 className="nf-settings-section-title">{g.title}</h3>
              {g.items.map((it) => (
                <div key={it.keys} className="nf-shortcuts-row">
                  <kbd className="nf-kbd">{it.keys}</kbd>
                  <span className="nf-shortcuts-desc">{it.desc}</span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <footer className="nf-settings-foot">
          <span className="nf-settings-foot-hint">Syphon v0.2.0</span>
          <button type="button" className="nf-btn nf-btn-primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
