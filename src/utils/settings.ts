import { create } from 'zustand';
import { BaseDirectory, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isTauri } from './tauri';

export type Theme = 'light' | 'dark';

export interface AppSettings {
  /** 图元变更后自动重新执行 */
  autoRun: boolean;
  /** 界面亮暗模式 */
  theme: Theme;
}

export const SETTINGS_DEFAULTS: AppSettings = {
  autoRun: true,
  theme: 'light',
};

const FILE_NAME = 'settings.json';
const LS_KEY = 'syphon-settings';

interface SettingsState extends AppSettings {
  /** 是否已从配置文件加载完成 */
  loaded: boolean;
  /** 启动时调用:从配置文件恢复偏好(Web 端回退 localStorage) */
  init: () => Promise<void>;
  setAutoRun: (v: boolean) => void;
  setTheme: (t: Theme) => void;
}

/** 读取设置:桌面端读取 应用配置目录/settings.json,Web 端读取 localStorage */
async function readSettingsFile(): Promise<string | null> {
  if (isTauri()) {
    try {
      return await readTextFile(FILE_NAME, { baseDir: BaseDirectory.AppConfig });
    } catch {
      return null; // 首次运行,文件尚不存在
    }
  }
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

/** 写入设置:用户修改后实时落盘,保证重启后生效 */
function writeSettingsFile(s: AppSettings): void {
  const json = JSON.stringify({ autoRun: s.autoRun, theme: s.theme }, null, 2);
  try {
    if (isTauri()) {
      void writeTextFile(FILE_NAME, json, { baseDir: BaseDirectory.AppConfig }).catch((e) =>
        console.error('保存设置失败:', e)
      );
    } else {
      localStorage.setItem(LS_KEY, json);
    }
  } catch {
    /* ignore */
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...SETTINGS_DEFAULTS,
  loaded: false,

  init: async () => {
    if (get().loaded) return;
    const raw = await readSettingsFile();
    const s: AppSettings = { ...SETTINGS_DEFAULTS };
    if (raw) {
      try {
        const j = JSON.parse(raw) as Partial<AppSettings>;
        if (typeof j.autoRun === 'boolean') s.autoRun = j.autoRun;
        if (j.theme === 'light' || j.theme === 'dark') s.theme = j.theme;
      } catch {
        /* 配置文件损坏,回退默认值 */
      }
    } else if (!isTauri()) {
      // 迁移旧版主题偏好(直接读写 localStorage syphon-theme 的时代)
      try {
        if (localStorage.getItem('syphon-theme') === 'dark') s.theme = 'dark';
      } catch {
        /* ignore */
      }
    }
    set({ ...s, loaded: true });
    writeSettingsFile(s);
  },

  setAutoRun: (v) => {
    set({ autoRun: v });
    writeSettingsFile(get());
  },

  setTheme: (t) => {
    set({ theme: t });
    writeSettingsFile(get());
  },
}));
