// 数值计算工具:拟合、求导、积分、平滑、直方图等

export function linspace(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  if (n <= 1) return [a];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

export function arange(a: number, b: number, step = 1): number[] {
  const out: number[] = [];
  for (let v = a; v < b; v += step) out.push(v);
  return out;
}

// 高斯随机数(Box-Muller)
export function gaussRand(mean = 0, std = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 数值求导:中心差分
export function derivative(
  points: [number, number][]
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    if (i === 0 && n > 1) {
      const [x1, y1] = points[1];
      out.push({ x: x0, y: (y1 - y0) / (x1 - x0 || 1e-9) });
    } else if (i === n - 1 && n > 1) {
      const [xm, ym] = points[n - 2];
      out.push({ x: x0, y: (y0 - ym) / (x0 - xm || 1e-9) });
    } else {
      const [xp, yp] = points[i + 1];
      const [xm, ym] = points[i - 1];
      out.push({ x: x0, y: (yp - ym) / (xp - xm || 1e-9) });
    }
  }
  return out;
}

// 数值积分:梯形法则累积
export function cumulativeIntegral(
  points: [number, number][]
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let acc = 0;
  out.push({ x: points[0][0], y: 0 });
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    acc += ((y0 + y1) / 2) * (x1 - x0);
    out.push({ x: x1, y: acc });
  }
  return out;
}

// 高斯消元解线性方程组 Ax = b
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) continue;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) if (Math.abs(M[i][i]) > 1e-12) x[i] = M[i][n] / M[i][i];
  return x;
}

// 多项式最小二乘拟合 y = c0 + c1*x + ... + cd*x^d
export function polyFit(
  xs: number[],
  ys: number[],
  degree: number
): number[] {
  const d = degree + 1;
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    let pw = 1;
    const powers: number[] = [];
    for (let p = 0; p < d; p++) {
      powers.push(pw);
      pw *= xs[i];
    }
    for (let r = 0; r < d; r++) {
      b[r] += ys[i] * powers[r];
      for (let c = 0; c < d; c++) A[r][c] += powers[r] * powers[c];
    }
  }
  return solveLinear(A, b);
}

export function polyEval(coeffs: number[], x: number): number {
  let y = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) y = y * x + coeffs[i];
  return y;
}

// 线性拟合 y = a + b*x
export function linearFit(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const b = sxx !== 0 ? sxy / sxx : 0;
  const a = my - b * mx;
  const r2 = sxx !== 0 && syy !== 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { a, b, r2 };
}

// 指数拟合 y = a * exp(b*x),取对数后线性拟合
export function exponentialFit(
  xs: number[],
  ys: number[]
): { a: number; b: number; r2: number } | null {
  const ok: number[] = [];
  const lx: number[] = [];
  const ly: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] > 0) {
      ok.push(xs[i]);
      lx.push(xs[i]);
      ly.push(Math.log(ys[i]));
    }
  }
  if (ok.length < 2) return null;
  const fit = linearFit(lx, ly);
  return { a: Math.exp(fit.a), b: fit.b, r2: fit.r2 };
}

// 滑动平均平滑
export function movingAverage(
  points: [number, number][],
  window: number
): [number, number][] {
  const w = Math.max(1, Math.floor(window));
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    let lo = i - w;
    let hi = i + w;
    let sum = 0;
    let cnt = 0;
    for (let j = lo; j <= hi; j++) {
      if (j >= 0 && j < points.length) {
        sum += points[j][1];
        cnt++;
      }
    }
    out.push([points[i][0], cnt > 0 ? sum / cnt : 0]);
  }
  return out;
}

// 直方图
export function histogram(
  values: number[],
  bins: number
): { x0: number; x1: number; count: number }[] {
  if (values.length === 0) return [];
  const b = Math.max(2, Math.floor(bins));
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const width = mx - mn;
  if (width === 0) return [{ x0: mn - 0.5, x1: mn + 0.5, count: values.length }];
  const step = width / b;
  const counts = new Array(b).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - mn) / step);
    if (idx >= b) idx = b - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  return counts.map((c, i) => ({ x0: mn + i * step, x1: mn + (i + 1) * step, count: c }));
}

export function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return String(v);
  return Number(v.toFixed(digits)).toString();
}

// 简单数学表达式求值(支持 x/y/pi/e/sin/cos/tan/exp/log/sqrt/abs/^)
export function compileFormula(src: string): ((x: number, y: number) => number) | null {
  let s = src
    .replace(/\^/g, '**')
    .replace(/sin/g, 'Math.sin')
    .replace(/cos/g, 'Math.cos')
    .replace(/tan/g, 'Math.tan')
    .replace(/exp/g, 'Math.exp')
    .replace(/log10/g, 'Math.log10')
    .replace(/log/g, 'Math.log')
    .replace(/sqrt/g, 'Math.sqrt')
    .replace(/abs/g, 'Math.abs')
    .replace(/pi/gi, 'Math.PI')
    .replace(/e/g, 'Math.E');
  s = s.replace(/(\d)\s*\*\s*/g, '$1*');
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('x', 'y', `"use strict"; return (${s});`);
    return (x: number, y: number) => {
      const v = fn(x, y);
      return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    };
  } catch {
    return null;
  }
}
