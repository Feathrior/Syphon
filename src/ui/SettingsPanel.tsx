import { useEffect } from 'react';
import { useSettings, type Theme } from '../utils/settings';

interface Props {
  onClose: () => void;
}

/** VSCode 风格"设置"弹出页:集中管理常用配置,修改实时写入配置文件 */
export default function SettingsPanel({ onClose }: Props) {
  const autoRun = useSettings((s) => s.autoRun);
  const setAutoRun = useSettings((s) => s.setAutoRun);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="nf-settings-overlay" onClick={onClose}>
      <div className="nf-settings" onClick={(e) => e.stopPropagation()}>
        <header className="nf-settings-head">
          <h2 className="nf-settings-title">设置</h2>
          <button className="nf-settings-close" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </header>

        <div className="nf-settings-body">
          <aside className="nf-settings-nav">
            <div className="nf-settings-nav-item nf-settings-nav-active">常用设置</div>
          </aside>

          <div className="nf-settings-content">
            <div className="nf-settings-section">
              <h3 className="nf-settings-section-title">通用</h3>

              <div className="nf-settings-row">
                <div className="nf-settings-info">
                  <span className="nf-settings-label">自动执行</span>
                  <span className="nf-settings-desc">图元或连线变更后自动重新执行整个数据流</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoRun}
                  className={`nf-switch${autoRun ? ' nf-switch-on' : ''}`}
                  onClick={() => setAutoRun(!autoRun)}
                >
                  <span className="nf-switch-thumb" />
                </button>
              </div>

              <div className="nf-settings-row">
                <div className="nf-settings-info">
                  <span className="nf-settings-label">主题</span>
                  <span className="nf-settings-desc">界面亮暗模式,切换后立即生效并持久化保存</span>
                </div>
                <div className="nf-segmented">
                  <button
                    type="button"
                    className={`nf-seg-btn${theme === 'light' ? ' nf-seg-active' : ''}`}
                    onClick={() => setTheme('light' satisfies Theme)}
                  >
                    亮色
                  </button>
                  <button
                    type="button"
                    className={`nf-seg-btn${theme === 'dark' ? ' nf-seg-active' : ''}`}
                    onClick={() => setTheme('dark' satisfies Theme)}
                  >
                    暗色
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="nf-settings-foot">
          <span className="nf-settings-foot-hint">修改自动保存至 settings.json</span>
          <button type="button" className="nf-btn nf-btn-primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
