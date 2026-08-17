import { describe, expect, it } from "vitest";
import {
  applyViewportUpdate,
  createViewportState,
  orderedRange,
  panViewport,
  zoomViewport,
} from "../src/lib/viewport-controller";

const times = Array.from({ length: 10 }, (_, index) => ({
  epoch: `${1_700_000_000_000 + index * 86_400_000}`,
  unit: "ms" as const,
}));

describe("synchronized viewport controller", () => {
  it("owns one shared visible range, crosshair, selection, and resolution", () => {
    const state = createViewportState(times);
    const result = applyViewportUpdate(state, {
      originId: "market-1",
      source: "market",
      visible: { from: timeAt(2), until: timeAt(7) },
      crosshair: times[5],
      selection: orderedRange(timeAt(6), timeAt(3)),
      seriesResolution: 6,
    });
    expect(result).toMatchObject({
      outcome: "applied",
      state: {
        visible: { from: times[2], until: times[7] },
        crosshair: times[5],
        selection: { from: times[3], until: times[6] },
        seriesResolution: 6,
        revision: 1,
        lastOrigin: { id: "market-1", source: "market" },
      },
    });
  });

  it("de-duplicates chart echoes and rejects ranges outside the canonical domain", () => {
    const state = createViewportState(times);
    const applied = applyViewportUpdate(state, {
      originId: "equity-1",
      source: "equity",
      crosshair: times[4],
    });
    expect(
      applyViewportUpdate(applied.state, {
        originId: "equity-1",
        source: "market",
        crosshair: times[5],
      }),
    ).toMatchObject({ outcome: "duplicate", state: { revision: 1, crosshair: times[4] } });
    expect(
      applyViewportUpdate(applied.state, {
        originId: "market-2",
        source: "market",
        selection: {
          from: { epoch: "1", unit: "ms" },
          until: timeAt(2),
        },
      }),
    ).toMatchObject({ outcome: "rejected", state: { revision: 1 } });
  });

  it("zooms around an anchor and pans without leaving the domain", () => {
    const domain = createViewportState(times).visible;
    const zoomed = zoomViewport(times, domain, 0.5, timeAt(5));
    expect(zoomed).toEqual({ from: times[3], until: times[7] });
    expect(panViewport(times, zoomed, 99)).toEqual({ from: times[5], until: times[9] });
    expect(panViewport(times, zoomed, -99)).toEqual({ from: times[0], until: times[4] });
    expect(zoomViewport(times, zoomed, 99, timeAt(5))).toEqual(domain);
  });

  it("rejects mixed-unit and unordered timelines", () => {
    expect(() => createViewportState([timeAt(0), { ...timeAt(1), unit: "us" }])).toThrow(
      /strictly ordered/,
    );
    expect(() => createViewportState([timeAt(1), timeAt(0)])).toThrow(/strictly ordered/);
  });
});

function timeAt(index: number) {
  const time = times[index];
  if (time === undefined) throw new Error(`Missing test time ${index}`);
  return time;
}
