import { describe, expect, it } from 'vitest';
import { CHART_HEIGHT, CHART_WIDTH, chartGeometry } from '../ui/chart';

const PADDING = 10;

function pairs(points: string): Array<[number, number]> {
  return points.split(' ').map((pair) => {
    const [x, y] = pair.split(',');
    return [Number(x), Number(y)];
  });
}

describe('chartGeometry', () => {
  it('is empty for no values', () => {
    expect(chartGeometry([])).toEqual({ points: '', min: 0, max: 0, count: 0 });
  });

  it('places a single value in the horizontal centre', () => {
    const geometry = chartGeometry([200]);
    expect(geometry.count).toBe(1);
    expect(geometry.min).toBe(200);
    expect(geometry.max).toBe(200);
    expect(pairs(geometry.points)).toEqual([[CHART_WIDTH / 2, CHART_HEIGHT / 2]]);
  });

  it('spreads values across the padded width, oldest first', () => {
    const geometry = chartGeometry([10, 20, 30]);
    const coordinates = pairs(geometry.points);
    expect(coordinates).toHaveLength(3);
    expect(coordinates[0]?.[0]).toBe(PADDING);
    expect(coordinates[2]?.[0]).toBe(CHART_WIDTH - PADDING);
  });

  it('puts the maximum at the top and the minimum at the bottom', () => {
    const geometry = chartGeometry([10, 50]);
    const coordinates = pairs(geometry.points);
    expect(coordinates[0]?.[1]).toBe(CHART_HEIGHT - PADDING);
    expect(coordinates[1]?.[1]).toBe(PADDING);
  });

  it('draws a flat series down the middle rather than on an edge', () => {
    const geometry = chartGeometry([42, 42, 42]);
    for (const [, y] of pairs(geometry.points)) {
      expect(y).toBe(CHART_HEIGHT / 2);
    }
  });

  it('scales to the data it is given, not to an absolute range', () => {
    const geometry = chartGeometry([300, 310]);
    const coordinates = pairs(geometry.points);
    expect(coordinates[0]?.[1]).toBe(CHART_HEIGHT - PADDING);
    expect(coordinates[1]?.[1]).toBe(PADDING);
  });

  it('rounds coordinates to two decimals so the attribute stays readable', () => {
    const geometry = chartGeometry([1, 3, 7]);
    for (const [x, y] of pairs(geometry.points)) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(String(x).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
      expect(String(y).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });
});
