// 核心数据模型:节点配置、端口、数据对象
export type Category = 'input' | 'clean' | 'compute' | 'transform' | 'visualize';

export type SocketType =
  | 'table' // 表格
  | 'series' // 曲线/线(一维轴也可视作 series)
  | 'scatter' // 散点
  | 'mesh' // 面/网格体
  | 'grid' // 规则网格数据
  | 'distribution' // 分布
  | 'axes' // 坐标系
  | 'any'; // 任意

export interface Column {
  name: string;
  values: (number | string | null)[];
}

export type DataObject =
  | { kind: 'table'; columns: Column[] }
  | {
      kind: 'series';
      name: string;
      points: [number, number][];
      /** 线样式(由"表格转曲线"等源节点提供) */
      lineWidth?: number;
      lineColor?: string;
      lineStyle?: 'solid' | 'dashed';
      /** 逐点线宽/颜色(由暴露参数接入数据列驱动,逐段变化) */
      sizes?: number[];
      colors?: string[];
    }
  | {
      kind: 'scatter';
      name: string;
      points: [number, number, number?][];
      /** 点样式(由"表格转散点"等源节点提供) */
      pointSize?: number;
      pointColor?: string;
      pointShape?: 'circle' | 'square' | 'diamond' | 'triangle';
      /** 逐点大小/颜色(由暴露参数接入数据列驱动,与 points 一一对应) */
      sizes?: number[];
      colors?: string[];
      /** 逐点形状(由"聚合点输入"等节点提供,与 points 一一对应) */
      shapes?: ('circle' | 'square' | 'diamond' | 'triangle')[];
    }
  | { kind: 'mesh'; name: string; vertices: [number, number, number][]; faces: [number, number, number][] }
  | { kind: 'grid'; name: string; x: number[]; y: number[]; values: number[][] }
  | { kind: 'distribution'; name: string; bins: { x0: number; x1: number; count: number }[]; sampleCount: number }
  | {
      kind: 'axes';
      name: string;
      dim: 2 | 3; // 2D / 3D
      xLen: number; // X 轴长度(可拉伸,像素)
      yLen: number; // Y 轴长度(可拉伸,像素)
      zLen: number; // Z 轴长度(可拉伸,3D)
      xMin: number; // X 起始数字
      xMax: number; // X 结束数字
      yMin: number; // Y 起始数字
      yMax: number; // Y 结束数字
      zMin: number; // Z 起始数字(3D)
      zMax: number; // Z 结束数字(3D)
      grid: boolean; // 是否显示网格
      /** 坐标轴定位方式:以原点为中心(范围内有原点则过原点,否则贴边) / 总贴左边沿 */
      axisOrigin: 'origin' | 'left';
      /** 是否显示坐标系边界边框 */
      showBorder: boolean;
      labelX: string;
      labelY: string;
      labelZ: string;
    };

export type DataMap = Record<string, DataObject>;

export interface Socket {
  id: string;
  name: string;
  type: SocketType;
  /** 是否允许同时连接多个上游(如原理化输出的点/线/面) */
  multi?: boolean;
}

/** "聚合点输入"中的单个点:独立坐标 / 大小 / 形状 / 颜色 */
export interface PointInput {
  x: number | string;
  y: number | string;
  size: number | string;
  shape: 'circle' | 'square' | 'diamond' | 'triangle';
  color: string;
}

export type ParamSpec =
  | {
      key: string;
      label: string;
      type: 'text' | 'number' | 'select' | 'boolean' | 'color' | 'textarea' | 'range';
      default: unknown;
      options?: { value: string; label: string }[];
      min?: number;
      max?: number;
      step?: number;
      placeholder?: string;
      help?: string;
      /** 可暴露:在节点上生成同名输入口,接收表格/曲线等数据列,驱动逐点属性;无连接时使用侧边栏填写的默认值 */
      expose?: boolean;
    }
  | { key: string; label: string; type: 'button'; default: unknown; action: 'import-csv'; help?: string }
  | { key: string; label: string; type: 'points'; default: PointInput[]; help?: string };

export interface ExecContext {
  nodeId: string;
  params: Record<string, unknown>;
  inputs: Record<string, DataObject | undefined>;
}

export type ExecFn = (ctx: ExecContext) => DataMap;

export interface NodeConfig {
  id: string;
  label: string;
  category: Category;
  description: string;
  inputs: Socket[];
  outputs: Socket[];
  params: ParamSpec[];
  exec?: ExecFn;
  width?: number; // 节点宽度
  isViewer?: boolean; // 可视化类节点(带渲染区)
}

export const SOCKET_LABEL: Record<SocketType, string> = {
  table: '表格',
  series: '曲线/线',
  scatter: '散点',
  mesh: '面/网格',
  grid: '网格数据',
  distribution: '分布',
  axes: '坐标系',
  any: '任意',
};

export const SOCKET_COLOR: Record<SocketType, string> = {
  table: '#22c55e',
  series: '#f59e0b',
  scatter: '#3b82f6',
  mesh: '#ec4899',
  grid: '#14b8a6',
  distribution: '#a78bfa',
  axes: '#22d3ee',
  any: '#94a3b8',
};

export const CATEGORY_INFO: Record<
  Category,
  { label: string; color: string; icon: string }
> = {
  input: { label: '组输入', color: '#10b981', icon: '▣' },
  clean: { label: '数据初步', color: '#3b82f6', icon: '◈' },
  compute: { label: '数据运算', color: '#ef4444', icon: 'ƒ' },
  transform: { label: '数据转化', color: '#f59e0b', icon: '⇄' },
  visualize: { label: '数据可视化', color: '#8b5cf6', icon: '◉' },
};

export function isCompatible(from: SocketType, to: SocketType): boolean {
  // 仅同类型数据可互相传递('any' 可对接任意类型)
  if (from === to) return true;
  if (from === 'any' || to === 'any') return true;
  return false;
}

// ==================== 颜色预设 ====================
export interface ColorPreset {
  value: string;
  label: string;
  colors: {
    bg: string;
    point: string;
    line: string;
    face: string;
    dist: string;
    axis: string;
    grid: string;
  };
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    value: 'paper',
    label: '论文白(亮色)',
    colors: { bg: '#ffffff', point: '#1f77b4', line: '#ff7f0e', face: '#2ca02c', dist: '#9467bd', axis: '#333333', grid: '#d9dee4' },
  },
  {
    value: 'tech',
    label: '暗色科技',
    colors: { bg: '#0b1220', point: '#3b82f6', line: '#f59e0b', face: '#ec4899', dist: '#a78bfa', axis: '#f8fafc', grid: 'rgba(148,163,184,0.18)' },
  },
  {
    value: 'ocean',
    label: '海洋蓝',
    colors: { bg: '#02101f', point: '#38bdf8', line: '#818cf8', face: '#22d3ee', dist: '#7dd3fc', axis: '#e0f2fe', grid: 'rgba(125,211,252,0.14)' },
  },
  {
    value: 'sunset',
    label: '落日橙',
    colors: { bg: '#1c0f1c', point: '#fb923c', line: '#fde047', face: '#f472b6', dist: '#fb7185', axis: '#fef3c7', grid: 'rgba(253,224,71,0.12)' },
  },
  {
    value: 'forest',
    label: '森林绿',
    colors: { bg: '#06130c', point: '#4ade80', line: '#a3e635', face: '#2dd4bf', dist: '#86efac', axis: '#ecfccb', grid: 'rgba(163,230,53,0.12)' },
  },
  {
    value: 'neon',
    label: '霓虹紫',
    colors: { bg: '#0a0618', point: '#c084fc', line: '#22d3ee', face: '#f0abfc', dist: '#a5b4fc', axis: '#f5d0fe', grid: 'rgba(192,132,252,0.14)' },
  },
  {
    value: 'gray',
    label: '灰度',
    colors: { bg: '#0a0a0a', point: '#d4d4d8', line: '#a1a1aa', face: '#71717a', dist: '#3f3f46', axis: '#fafafa', grid: 'rgba(244,244,245,0.12)' },
  },
];

export function presetColors(params: Record<string, unknown>) {
  const preset = COLOR_PRESETS.find((p) => p.value === String(params.colorPreset ?? 'paper'));
  if (preset && preset.value !== 'custom') return preset.colors;
  return {
    bg: String(params.bgColor ?? '#ffffff'),
    point: String(params.pointColor ?? '#1f77b4'),
    line: String(params.lineColor ?? '#ff7f0e'),
    face: String(params.faceColor ?? '#2ca02c'),
    dist: String(params.distColor ?? '#9467bd'),
    axis: String(params.axisColor ?? '#333333'),
    grid: 'rgba(51,51,51,0.15)',
  };
}
