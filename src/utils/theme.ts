import { useCallback } from 'react';
import { useSettings, type Theme } from './settings';

export type { Theme };

/**
 * 亮/暗主题:以设置模块(sync -> settings.json)为唯一数据源。
 * 兼容旧调用方,保持 { theme, toggleTheme } API 不变。
 */
export function useTheme() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [theme, setTheme]);

  return { theme, toggleTheme };
}
