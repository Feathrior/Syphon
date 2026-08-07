/**
 * 窗口缩放守卫:解决 Tauri 打包后拖拽缩放 Windows 窗口时不跟手的问题。
 *
 * 原理:透明窗口 + Mica 效果在 Windows DWM 合成开销大,若每个 viewer 的
 * ResizeObserver 在窗口缩放期间都各自触发 ECharts.resize() / Canvas 重绘,
 * 会导致严重的帧堆积和延迟。本模块统一管控:
 *
 * 1. 窗口缩放期间(isResizing()=true):各 viewer 的 ResizeObserver 回调直接跳过
 * 2. 窗口缩放停止后(150ms 无新事件):统一触发所有注册的回调,一次性精确重绘
 *
 * 用法:
 *   // 在 ResizeObserver 回调中:
 *   if (isResizing()) return;
 *   // ... 原有重绘逻辑
 *
 *   // 注册缩放结束后的兜底重绘:
 *   useEffect(() => onResizeEnd(() => chart.resize()), []);
 */

let resizing = false;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
const endCallbacks = new Set<() => void>();

function handleResize() {
  if (!resizing) {
    resizing = true;
    document.body.classList.add('nf-window-resizing');
  }
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizing = false;
    document.body.classList.remove('nf-window-resizing');
    // 统一触发所有注册的兜底重绘回调
    endCallbacks.forEach((fn) => {
      try {
        fn();
      } catch {
        /* 忽略个别回调异常,不影响其他回调 */
      }
    });
  }, 150);
}

// 仅在浏览器环境注册(非 SSR)
if (typeof window !== 'undefined') {
  window.addEventListener('resize', handleResize, { passive: true });
}

/** 窗口是否正在缩放中(缩放期间 viewer 应跳过重绘) */
export function isResizing(): boolean {
  return resizing;
}

/** 注册窗口缩放结束后的兜底重绘回调,返回取消注册函数 */
export function onResizeEnd(fn: () => void): () => void {
  endCallbacks.add(fn);
  return () => {
    endCallbacks.delete(fn);
  };
}
