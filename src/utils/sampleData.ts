import type { Column, DataObject } from '../types/data';
import { gaussRand, linspace } from './math';

// 示例数据集预设
export function presetTable(preset: string): Column[] {
  switch (preset) {
    case 'volcano': {
      // 火山图风格:基因差异表达数据
      const columns: Column[] = [
        { name: 'gene', values: [] as (number | string | null)[] },
        { name: 'log2FC', values: [] as number[] },
        { name: 'pvalue', values: [] as number[] },
        { name: 'exprA', values: [] as number[] },
        { name: 'exprB', values: [] as number[] },
      ];
      for (let i = 0; i < 200; i++) {
        const fc = gaussRand(0, 1.4);
        const p = Math.exp(-Math.abs(gaussRand(0, 3.2)) * 1.1);
        columns[0].values.push(`基因${i + 1}`);
        columns[1].values.push(Number(fc.toFixed(3)));
        columns[2].values.push(Number(p.toFixed(5)));
        columns[3].values.push(Number((50 + fc * 6 + gaussRand(0, 4)).toFixed(2)));
        columns[4].values.push(Number((50 + fc * 6 + gaussRand(0, 4)).toFixed(2)));
      }
      return columns;
    }
    case 'sales': {
      const columns: Column[] = [
        { name: '月份', values: [] as string[] },
        { name: '销量', values: [] as number[] },
        { name: '利润', values: [] as number[] },
      ];
      for (let m = 1; m <= 24; m++) {
        columns[0].values.push(`${m}月`);
        columns[1].values.push(Number((120 + 40 * Math.sin(m / 3) + m * 3 + gaussRand(0, 12)).toFixed(0)));
        columns[2].values.push(Number((30 + 15 * Math.sin(m / 2.5) + m * 1.2 + gaussRand(0, 5)).toFixed(1)));
      }
      return columns;
    }
    case 'iris': {
      const columns: Column[] = [
        { name: 'sepal_length', values: [] as number[] },
        { name: 'sepal_width', values: [] as number[] },
        { name: 'petal_length', values: [] as number[] },
        { name: 'petal_width', values: [] as number[] },
        { name: 'species', values: [] as string[] },
      ];
      const centers = [
        { sl: 5.0, sw: 3.4, pl: 1.5, pw: 0.2, s: 'setosa' },
        { sl: 5.9, sw: 2.8, pl: 4.3, pw: 1.3, s: 'versicolor' },
        { sl: 6.6, sw: 3.0, pl: 5.6, pw: 2.0, s: 'virginica' },
      ];
      for (let i = 0; i < 150; i++) {
        const c = centers[i % 3];
        columns[0].values.push(Number((c.sl + gaussRand(0, 0.35)).toFixed(1)));
        columns[1].values.push(Number((c.sw + gaussRand(0, 0.3)).toFixed(1)));
        columns[2].values.push(Number((c.pl + gaussRand(0, 0.4)).toFixed(1)));
        columns[3].values.push(Number((c.pw + gaussRand(0, 0.25)).toFixed(1)));
        columns[4].values.push(c.s);
      }
      return columns;
    }
    default: {
      // phys:带噪声的物理曲线数据
      const n = 200;
      const xs = linspace(0, 6 * Math.PI, n);
      const ys = xs.map((x) => Number((Math.sin(x) + 0.12 * gaussRand(0, 1)).toFixed(4)));
      return [
        { name: 'x', values: xs.map((v) => Number(v.toFixed(4))) },
        { name: 'y', values: ys },
      ];
    }
  }
}

export function presetSeries(preset: string): DataObject {
  const n = 200;
  if (preset === 'random-walk') {
    let v = 0;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      v += gaussRand(0, 0.6);
      pts.push([i, Number(v.toFixed(4))]);
    }
    return { kind: 'series', name: '随机游走', points: pts };
  }
  if (preset === 'sin-noise') {
    const xs = linspace(0, 4 * Math.PI, n);
    return {
      kind: 'series',
      name: '正弦+噪声',
      points: xs.map((x) => [Number(x.toFixed(4)), Number((Math.sin(x) + 0.15 * gaussRand(0, 1)).toFixed(4))]),
    };
  }
  const xs = linspace(0, 10, n);
  return {
    kind: 'series',
    name: '二次曲线',
    points: xs.map((x) => [Number(x.toFixed(4)), Number((0.5 * x * x - 3 * x + 2 + gaussRand(0, 1.2)).toFixed(4))]),
  };
}

export function presetScatter(preset: string): DataObject {
  const n = 300;
  if (preset === 'cluster') {
    const pts: [number, number, number?][] = [];
    const centers = [
      [0, 0],
      [4, 3],
      [-2, 5],
    ];
    for (let i = 0; i < n; i++) {
      const c = centers[i % 3];
      pts.push([
        Number((c[0] + gaussRand(0, 0.9)).toFixed(3)),
        Number((c[1] + gaussRand(0, 0.9)).toFixed(3)),
        i % 3,
      ]);
    }
    return { kind: 'scatter', name: '聚类散点', points: pts };
  }
  // 3D 螺旋
  const pts: [number, number, number?][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 8 * Math.PI;
    pts.push([
      Number((Math.cos(t) * t * 0.4).toFixed(3)),
      Number((Math.sin(t) * t * 0.4).toFixed(3)),
      Number((t * 0.5).toFixed(3)),
    ]);
  }
  return { kind: 'scatter', name: '螺旋散点', points: pts };
}
