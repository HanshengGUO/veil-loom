import type {
  LoomBacktestImport,
  LoomOhlcvPoint,
  LoomScalarPoint,
  LoomTime,
} from "@veilquant/loom-protocol";

const epochs = [
  "1704153600000",
  "1704240000000",
  "1704326400000",
  "1704412800000",
  "1704672000000",
  "1704758400000",
  "1704844800000",
  "1704931200000",
  "1705017600000",
  "1705276800000",
  "1705363200000",
  "1705449600000",
] as const;

function time(epoch: string): LoomTime {
  return { epoch, unit: "ms" };
}

function market(
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): LoomOhlcvPoint {
  const epoch = epochs[index];
  if (epoch === undefined) throw new Error("The daily-factor market fixture is incomplete");
  return { time: time(epoch), open, high, low, close, volume };
}

function scalar(index: number, value: number): LoomScalarPoint {
  const epoch = epochs[index];
  if (epoch === undefined) throw new Error("The daily-factor scalar fixture is incomplete");
  return { time: time(epoch), value };
}

/** Committed normalized output for the first explicit Loom backtest adapter. */
export const DAILY_FACTOR_IMPORT: LoomBacktestImport = {
  format: "loom.backtest-import.v0",
  title: "Daily factor reference backtest",
  summary:
    "A deterministic 12-session daily fixture with next-session execution and net equity after a 10 bps round-trip cost.",
  timeUnit: "ms",
  market: [
    market(0, 100, 102, 99, 101, 100_000),
    market(1, 101, 103, 100, 102.5, 110_000),
    market(2, 102.8, 104, 101.8, 103.2, 105_000),
    market(3, 103.5, 104.2, 102, 102.4, 98_000),
    market(4, 102.2, 105, 101.9, 104.6, 120_000),
    market(5, 104.5, 105.1, 102.5, 103, 115_000),
    market(6, 102.8, 103.2, 99.8, 100.5, 145_000),
    market(7, 100.2, 101, 97.5, 98.2, 160_000),
    market(8, 98.5, 100.8, 98, 100.2, 132_000),
    market(9, 100.5, 102.5, 99.9, 101.8, 118_000),
    market(10, 101.9, 103.3, 101.1, 102.7, 109_000),
    market(11, 102.8, 105.2, 102.4, 104.8, 125_000),
  ],
  equity: [
    scalar(0, 100_000),
    scalar(1, 100_400),
    scalar(2, 100_180),
    scalar(3, 100_850),
    scalar(4, 101_100),
    scalar(5, 100_700),
    scalar(6, 99_650),
    scalar(7, 99_000),
    scalar(8, 99_500),
    scalar(9, 100_200),
    scalar(10, 100_600),
    scalar(11, 101_400),
  ],
  drawdown: [
    scalar(0, 0),
    scalar(1, 0),
    scalar(2, -0.002191),
    scalar(3, 0),
    scalar(4, 0),
    scalar(5, -0.003956),
    scalar(6, -0.014342),
    scalar(7, -0.020772),
    scalar(8, -0.015826),
    scalar(9, -0.008902),
    scalar(10, -0.004946),
    scalar(11, 0),
  ],
  trades: [
    { tradeId: "execution-1", time: time(epochs[2]), side: "buy", price: 102.8, quantity: 100 },
    { tradeId: "execution-2", time: time(epochs[4]), side: "sell", price: 102.2, quantity: 100 },
    { tradeId: "execution-3", time: time(epochs[6]), side: "buy", price: 102.8, quantity: 120 },
    { tradeId: "execution-4", time: time(epochs[9]), side: "sell", price: 100.5, quantity: 120 },
  ],
  metrics: [
    {
      key: "total_return",
      label: "Total return",
      value: 0.014,
      unit: "ratio",
      scale: "percent",
      sampleScope: "full-sample",
      method: {
        id: "endpoint-return-v0",
        description: "Net ending equity divided by starting equity minus one.",
      },
    },
    {
      key: "max_drawdown",
      label: "Maximum drawdown",
      value: -0.020772,
      unit: "ratio",
      scale: "percent",
      sampleScope: "full-sample",
      method: {
        id: "running-peak-drawdown-v0",
        description: "Minimum net equity relative to its prior running peak.",
      },
    },
    {
      key: "annualized_sharpe",
      label: "Annualized Sharpe",
      value: 1.12,
      unit: "ratio",
      scale: "linear",
      sampleScope: "full-sample",
      method: {
        id: "daily-sharpe-252-v0",
        description:
          "Mean daily net return divided by sample standard deviation and annualized by sqrt(252).",
      },
    },
    {
      key: "execution_count",
      label: "Executions",
      value: 4,
      unit: "count",
      scale: "linear",
      sampleScope: "full-sample",
      method: {
        id: "execution-row-count-v0",
        description: "Number of normalized execution rows.",
      },
    },
  ],
  regions: [
    {
      regionId: "maximum-drawdown",
      kind: "drawdown",
      label: "Maximum drawdown window",
      start: time(epochs[4]),
      end: time(epochs[7]),
    },
  ],
  source: {
    dataId: "daily-factor-market-v0",
    dataDigest: "sha256:bd71d76f73d2f6d0ec62059acab4c60b4101b60d0b9da2dc7fa2a00ec946b8b3",
    artifactId: "daily-factor-v0",
    artifactDigest: "sha256:b990daf38ee553988d6299e636e3363bb0204298f1b0d508a94be3d904bea5ed",
  },
  run: {
    protocolId: "next-session-open-v0",
    signalLagSessions: 1,
    executionPrice: "open",
    equityBasis: "net",
    costModel: "10 bps round trip, deducted from net equity",
  },
};

/** Golden identities for the committed demo project/session/task context. */
export const DAILY_FACTOR_EXPECTED_IDENTITIES = {
  view: "view_77ff60190d8f20b3c5732d295c319dac6915f326ffb01653de963c6502c2c1d1",
  market: "blob_e8cb20ea645d2c6e1d9333f7262823c277d6513156c5b44c51a7ceb7b35326aa",
  equity: "blob_0370f6f805a2660eafc8a33ce03653bd1514d3189390596e915608b019219d7f",
  drawdown: "blob_b33a2b5eaf6f219ef8921dbef83364ca58cacb42084cf8d07b8288000651d358",
  trades: "blob_684a2421bcfe23b215b9e716661cb965efabe54fbd9708cdf8d5e44916a1627b",
} as const;
