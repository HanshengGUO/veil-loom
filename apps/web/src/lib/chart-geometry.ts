export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartScale {
  points: readonly ChartPoint[];
  minimum: number;
  maximum: number;
}

export function scaleChartValues(
  values: readonly number[],
  width: number,
  height: number,
  padding = 12,
): ChartScale {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("Chart values must be a non-empty finite series");
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const innerWidth = Math.max(0, width - padding * 2);
  const innerHeight = Math.max(0, height - padding * 2);
  return {
    minimum,
    maximum,
    points: values.map((value, index) => ({
      x: values.length === 1 ? width / 2 : padding + (index / (values.length - 1)) * innerWidth,
      y: span === 0 ? height / 2 : padding + ((maximum - value) / span) * innerHeight,
    })),
  };
}

export function svgLinePath(points: readonly ChartPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`)
    .join(" ");
}

export function svgAreaPath(points: readonly ChartPoint[], baseline: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return "";
  return `${svgLinePath(points)} L${round(last.x)} ${round(baseline)} L${round(first.x)} ${round(baseline)} Z`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
