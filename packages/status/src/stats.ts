// the arithmetic the status methods share, written to match R where ecoidx relies on it: mean() with R's second
// refinement pass, sd() as the sample standard deviation, quantile() type 7, and the change of an lm() fit over a
// window (predict at the last point minus predict at the first).

/** R's mean(): the sum over n, refined by the mean of the residuals (src/main/summary.c) */
export function mean(xs: number[]): number {
  const n = xs.length
  if (n === 0) return NaN
  let s = 0
  for (const x of xs) s += x
  let m = s / n
  if (Number.isFinite(m)) {
    let t = 0
    for (const x of xs) t += x - m
    m += t / n
  }
  return m
}

/** R's sd(): sample standard deviation (n - 1), NA (NaN) below two values */
export function sd(xs: number[]): number {
  const n = xs.length
  if (n < 2) return NaN
  const m = mean(xs)
  let ss = 0
  for (const x of xs) ss += (x - m) * (x - m)
  return Math.sqrt(ss / (n - 1))
}

/** R's quantile(x, p, type = 7) */
export function quantile7(xs: number[], p: number): number {
  const n = xs.length
  if (n === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, n - 1)
  return s[lo] + (h - lo) * (s[hi] - s[lo])
}

/** R's median() */
export function median(xs: number[]): number {
  return quantile7(xs, 0.5)
}

/**
 * the change of the least-squares line through (x, y) over the points given: fitted(last x) - fitted(first x), as
 * ecoidx takes `pred[length(pred)] - pred[1]` from predict(lm(Y5 ~ X5)) (which drops NA rows). null below two points
 * or when every x is the same.
 */
export function fitDelta(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) * (xs[i] - mx)
  }
  if (sxx === 0) return null
  return (sxy / sxx) * (xs[n - 1] - xs[0])
}
