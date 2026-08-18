# Daily factor 示例

[English](README.md)

这个目录是 Loom 第一个 backtest adapter 的 deterministic reference input：

- [`market.csv`](./market.csv) 是一份小型、公开的日频 OHLCV 样本；
- [`factor.ts`](./factor.ts) 定义了用于说明流程的 two-session momentum signal；
- [`artifact/daily-factor.mjs`](./artifact/daily-factor.mjs) 通过 Veil framed
  `compute(table, context)` artifact runtime contract 暴露同一条规则；
- [`reference-import.json`](./reference-import.json) 是规范化后的 `loom.backtest-import.v0` 输出，包含
  next-session-open execution、net equity、10 bps round-trip cost、trades、metrics 与 provenance；
- [`.veil/project.yaml`](./.veil/project.yaml) 注册 readiness check 使用的小型 Veil project；
- [`adapter.yaml`](./adapter.yaml) 与 [`veil-prices.csv`](./veil-prices.csv) 共同组成公开的 35-session、
  four-entity point-in-time verification fixture。

daemon 不会靠文件名发现这些文件，也不会在浏览器里执行 factor。显式 reference adapter 负责导入 committed normalized
record，完成验证，保存 immutable resources，再发布 exploratory view。

对于 demo ownership tuple `daily-factor-demo / raw-pi-demo / demo-task-1`，预期 view ID 为
`view_77ff60190d8f20b3c5732d295c319dac6915f326ffb01653de963c6502c2c1d1`。测试还会固定四个 blob identities，
并用 committed bytes 核对 source/artifact digests。

成功加载 Veil declaration 只说明 profile 已经 ready。脚本化 Pi response 仍不会自动 promote 任何内容。独立 Web action
会核对选中 artifact digest，创建新的 Veil session，重新读取注册 panel，并在完整 contract/pricing/gate 流程后决定是否
签发 Experiment。它绝不会把 Raw chart metrics 当成 targets。这个 fixture 仅用于说明产品流程，不构成投资建议。
evidence drawer 会展示经验证的 OOS metrics 与 gate reasons；reproduction action 则从 immutable snapshots 重放归档
artifact。两者都不会改变 Raw view 或 Experiment 的原始 verdict。
