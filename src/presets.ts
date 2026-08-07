/**
 * 内置画布预设:火山图 / 热力图 / 箱线图 / 小提琴图 / 桑基图。
 * 每种预设是一张完整的图(数据表 → 图表节点 + 连线 + 节点位置),
 * 以"保存画布"的 JSON 格式(syphon-graph v1)内嵌打包进应用(保存在 exe 中),
 * 可在"文件 → 预设"菜单随时调取,加载后替换当前画布。
 */

interface PresetNode {
  id: string;
  configId: string;
  params?: Record<string, unknown>;
  exposed?: string[];
  collapsed?: boolean;
  position: { x: number; y: number };
}

interface PresetEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  mid?: { x: number; y: number } | null;
}

/** 按"保存画布"的 JSON 结构组装一张图 */
function buildGraph(nodes: PresetNode[], edges: PresetEdge[]): string {
  return JSON.stringify(
    {
      format: 'syphon-graph',
      version: 1,
      nodes: nodes.map((n) => ({
        id: n.id,
        configId: n.configId,
        params: n.params ?? {},
        exposed: n.exposed ?? [],
        collapsed: !!n.collapsed,
        position: n.position,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? 'out0',
        targetHandle: e.targetHandle ?? 'in0',
        mid: e.mid ?? null,
      })),
    },
    null,
    2
  );
}

/** 常见结构:表格输入(左) → 单个图表节点(右),数据列直接透传 */
function tableToChart(
  tableParams: Record<string, unknown>,
  chartConfigId: string,
  chartParams: Record<string, unknown>,
  y: number
): string {
  return buildGraph(
    [
      { id: 't', configId: 'table_input', params: tableParams, position: { x: 40, y } },
      { id: 'v', configId: chartConfigId, params: chartParams, position: { x: 420, y } },
    ],
    [{ id: 't-v', source: 't', target: 'v' }]
  );
}

export interface Preset {
  /** 菜单显示名称 */
  name: string;
  /** 一句话说明 */
  desc: string;
  /** 完整画布 JSON(与"保存画布"格式一致,可直接 loadGraph) */
  json: string;
}

export const PRESETS: Preset[] = [
  {
    name: '火山图',
    desc: '基因差异表达:以 log2FC 与 p 值两列绘制火山图,自动标注显著点',
    json: tableToChart({ preset: 'volcano' }, 'viz_volcano', {}, 60),
  },
  {
    name: '热力图',
    desc: '鸢尾花数值矩阵热力图(每个数值列一条色带)',
    json: tableToChart({ preset: 'iris' }, 'viz_heatmap', {}, 60),
  },
  {
    name: '箱线图',
    desc: '鸢尾花四组数值分布的箱线图',
    json: tableToChart({ preset: 'iris' }, 'viz_box', {}, 60),
  },
  {
    name: '小提琴图',
    desc: '鸢尾花四组数值分布的小提琴图(核密度估计)',
    json: tableToChart({ preset: 'iris' }, 'viz_violin', {}, 60),
  },
  {
    name: '桑基图',
    desc: '收支流程桑基图:按 来源→去向 聚合流量',
    json: tableToChart(
      {
        mode: 'manual',
        dataText: [
          '来源,去向,流量',
          '收入,工资,4200',
          '收入,兼职,1500',
          '收入,理财,800',
          '支出,房租,1800',
          '支出,餐饮,1350',
          '支出,出行,640',
          '支出,娱乐,420',
          '储蓄,银行,3800',
          '储蓄,基金,1200',
        ].join('\n'),
      },
      'viz_sankey',
      { sourceCol: '来源', targetCol: '去向', valueCol: '流量', title: '收支流程' },
      60
    ),
  },
];
