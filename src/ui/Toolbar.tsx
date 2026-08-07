import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useGraph } from '../store/useGraph';
import { pickJsonFile, saveTextFile } from '../utils/tauri';
import { isTauri } from '../utils/tauri';
import { useTheme } from '../utils/theme';

interface Props {
  boxSelect: boolean;
  setBoxSelect: (v: boolean) => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
}

/* ---------------- Fluent 线性图标(24 viewBox) ---------------- */
function Icon({ d, fill = false, sw = 1.6 }: { d: React.ReactNode; fill?: boolean; sw?: number }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d}
    </svg>
  );
}

const SunIcon = () => (
  <Icon
    d={
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    }
  />
);

const MoonIcon = () => <Icon d={<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />} />;

const GearIcon = () => (
  <Icon
    d={
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </>
    }
  />
);

const PlayIcon = () => <Icon fill d={<path d="M6 4.5 19 12 6 19.5V4.5Z" />} />;

const SaveIcon = () => (
  <Icon
    d={
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M17 21v-8H7v8M7 3v5h8" />
      </>
    }
  />
);

const FolderOpenIcon = () => (
  <Icon
    d={
      <>
        <path d="M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      </>
    }
  />
);

const TrashIcon = () => (
  <Icon
    d={
      <>
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
        <path d="M10 11v6M14 11v6" />
      </>
    }
  />
);

const UndoIcon = () => (
  <Icon
    d={
      <>
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5A5.5 5.5 0 0 1 14.5 20H11" />
      </>
    }
  />
);

const RedoIcon = () => (
  <Icon
    d={
      <>
        <path d="m15 14 5-5-5-5" />
        <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13" />
      </>
    }
  />
);

const BoxSelectIcon = () => (
  <Icon
    d={
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="5 3" />
        <path d="M3 9h3M3 15h3M18 9h3M18 15h3M9 3v3M15 3v3M9 18v3M15 18v3" />
      </>
    }
  />
);

const FitViewIcon = () => (
  <Icon
    d={
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      </>
    }
  />
);

const LayoutIcon = () => (
  <Icon
    d={
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </>
    }
  />
);

const InfoIcon = () => (
  <Icon
    d={
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </>
    }
  />
);

const KeyboardIcon = () => (
  <Icon
    d={
      <>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
      </>
    }
  />
);

const CheckIcon = () => <Icon d={<path d="M20 6 9 17l-5-5" />} sw={2} />;

/* ---------------- 窗口控制图标(最小化/最大化/还原/关闭) ---------------- */
const WinMinIcon = () => <Icon d={<path d="M5 12h14" />} sw={1.4} />;
const WinMaxIcon = () => <Icon d={<rect x="5.5" y="5.5" width="13" height="13" rx="1" />} sw={1.4} />;
const WinRestoreIcon = () => (
  <Icon
    sw={1.4}
    d={
      <>
        <rect x="7" y="7" width="12" height="12" rx="1" />
        <path d="M4 13V5a1 1 0 0 1 1-1h8" />
      </>
    }
  />
);
const WinCloseIcon = () => <Icon d={<path d="m6 6 12 12M18 6 6 18" />} sw={1.4} />;

/* ---------------- 菜单项 ---------------- */
type MenuItem =
  | { kind: 'item'; label: string; shortcut?: string; icon: React.ReactNode; danger?: boolean; action: () => void }
  | { kind: 'sep' };

export default function Toolbar({ boxSelect, setBoxSelect, onOpenSettings, onOpenShortcuts }: Props) {
  const { fitView } = useReactFlow();
  const { theme, toggleTheme } = useTheme();
  const bumpRun = useGraph((s) => s.bumpRun);
  const clearAll = useGraph((s) => s.clearAll);
  const saveGraph = useGraph((s) => s.saveGraph);
  const loadGraph = useGraph((s) => s.loadGraph);
  const autoLayout = useGraph((s) => s.autoLayout);
  const undo = useGraph((s) => s.undo);
  const redo = useGraph((s) => s.redo);
  const nodeCount = useGraph((s) => s.nodes.length);

  const [open, setOpen] = useState<string | null>(null);
  // 记录当前菜单是通过"点击"还是"悬停"打开的:
  // 悬停切换菜单后再点击不应关闭(避免 hover→click 连续操作时菜单闪关)
  const openedByClick = useRef<string | null>(null);

  // 自定义窗口控制:最大/还原图标随窗口状态切换
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const w = getCurrentWindow();
    void w.isMaximized().then(setMaximized);
    let unlisten: (() => void) | null = null;
    void w.onResized(() => {
      void w.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // 拖拽移动窗口:按住顶栏空白区域拖动(按钮与菜单遮罩除外)
  const onToolbarMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !isTauri()) return;
    const t = e.target as Element | null;
    if (!t) return;
    if (t.closest('button') || t.closest('.nf-menubar-overlay') || t.closest('.nf-window-controls')) return;
    void getCurrentWindow().startDragging();
  };

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

  const handleAbout = () => {
    window.alert('Syphon v0.1.3\n节点化数据处理工作台\n数据加载 → 变换 → 可视化,全部可视化连线完成。');
  };

  const fileMenu: MenuItem[] = [
    { kind: 'item', label: '保存画布', icon: <SaveIcon />, action: handleSave },
    { kind: 'item', label: '加载画布', icon: <FolderOpenIcon />, action: handleLoad },
    { kind: 'sep' },
    { kind: 'item', label: '清空画布', icon: <TrashIcon />, danger: true, action: handleClear },
  ];
  const editMenu: MenuItem[] = [
    { kind: 'item', label: '撤销', shortcut: 'Ctrl+Z', icon: <UndoIcon />, action: undo },
    { kind: 'item', label: '重做', shortcut: 'Ctrl+Y', icon: <RedoIcon />, action: redo },
    { kind: 'sep' },
    {
      kind: 'item',
      label: '框选模式',
      icon: boxSelect ? <CheckIcon /> : <BoxSelectIcon />,
      action: () => setBoxSelect(!boxSelect),
    },
  ];
  const viewMenu: MenuItem[] = [
    { kind: 'item', label: '适应视图', icon: <FitViewIcon />, action: () => fitView({ padding: 0.25 }) },
    { kind: 'item', label: '一键整理', icon: <LayoutIcon />, action: handleAutoLayout },
  ];
  const helpMenu: MenuItem[] = [
    { kind: 'item', label: '快捷键', icon: <KeyboardIcon />, action: onOpenShortcuts },
    { kind: 'sep' },
    { kind: 'item', label: '关于 Syphon', icon: <InfoIcon />, action: handleAbout },
  ];

  const menus: { id: string; label: string; items: MenuItem[] }[] = [
    { id: 'file', label: '文件', items: fileMenu },
    { id: 'edit', label: '编辑', items: editMenu },
    { id: 'view', label: '视图', items: viewMenu },
    { id: 'help', label: '帮助', items: helpMenu },
  ];

  return (
    <div className="nf-toolbar" onMouseDown={onToolbarMouseDown}>
      <div className="nf-brand">
        <img className="nf-brand-mark" src="syphon.png" alt="Syphon" draggable={false} />
        <span className="nf-brand-text">Syphon</span>
      </div>

      {open && <div className="nf-menubar-overlay" onClick={() => setOpen(null)} />}

      <nav className="nf-menubar">
        {menus.map((m) => (
          <div key={m.id} className="nf-menu-wrap">
            <button
              className={`nf-menubar-btn${open === m.id ? ' nf-menubar-btn-open' : ''}`}
              onClick={() => {
                // 仅当"点击打开"的当前菜单再次被点击时才关闭;悬停切换打开的菜单点击后保持展开
                if (open === m.id && openedByClick.current === m.id) {
                  setOpen(null);
                  openedByClick.current = null;
                } else {
                  setOpen(m.id);
                  openedByClick.current = m.id;
                }
              }}
              onMouseEnter={() => {
                if (open) {
                  setOpen(m.id);
                  openedByClick.current = null;
                }
              }}
            >
              {m.label}
            </button>
            {open === m.id && (
              <div className="nf-dropdown">
                {m.items.map((it, i) =>
                  it.kind === 'sep' ? (
                    <div key={`sep${i}`} className="nf-dropdown-sep" />
                  ) : (
                    <button
                      key={it.label}
                      className={`nf-dropdown-item${it.danger ? ' nf-dropdown-danger' : ''}`}
                      onClick={() => {
                        setOpen(null);
                        it.action();
                      }}
                    >
                      <span className="nf-dropdown-icon">{it.icon}</span>
                      <span className="nf-dropdown-label">{it.label}</span>
                      {it.shortcut && <span className="nf-dropdown-shortcut">{it.shortcut}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="nf-toolbar-right">
        <button
          className="nf-icon-btn nf-icon-btn-rotate"
          onClick={toggleTheme}
          title={theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'}
        >
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
        <button className="nf-icon-btn" onClick={onOpenSettings} title="设置">
          <GearIcon />
        </button>
        <button className="nf-icon-btn nf-icon-btn-run" onClick={bumpRun} title="运行数据流">
          <PlayIcon />
        </button>
      </div>

      {isTauri() && (
        <div className="nf-window-controls">
          <button className="nf-win-btn" onClick={() => void getCurrentWindow().minimize()} title="最小化">
            <WinMinIcon />
          </button>
          <button
            className="nf-win-btn"
            onClick={() => void getCurrentWindow().toggleMaximize()}
            title={maximized ? '还原' : '最大化'}
          >
            {maximized ? <WinRestoreIcon /> : <WinMaxIcon />}
          </button>
          <button className="nf-win-btn nf-win-btn-close" onClick={() => void getCurrentWindow().close()} title="关闭">
            <WinCloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}
