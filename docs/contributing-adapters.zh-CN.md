# 贡献 backtest adapter

[English](contributing-adapters.md)

第一个 adapter boundary 已经围绕 committed daily-factor fixture 实现。它目前刻意保持狭窄：在这份 contract 获得真实
用户反馈以前，我们不会急着加入 framework-specific discovery。

adapter 需要把输出规范化为 `loom.backtest-import.v0`。记录中包括有序 OHLCV、net equity、drawdown、normalized
executions、带 unit/scale/scope/method 的 metrics、source 与 artifact digests，以及明确的 execution/cost semantics。
导入成功后会创建 exploratory `loom.backtest-view.v0`，绝不会由 adapter 直接产生 Veil assurance。

validator 会拒绝 unknown fields、non-finite values、重复或倒序 timestamp、混用 time units、非法 OHLC ranges、
未对齐的 equity/drawdown、越界 trades 与 regions、重复 metric keys、schema drift，以及过大的 JSON resources。
只有完整输出通过验证后，content-addressed resources 才会被原子发布。

请把 [`examples/daily-factor/reference-import.json`](../examples/daily-factor/reference-import.json) 当作可执行的 contract
fixture。它的 source data 与 factor artifact 一同提交，测试会核对两者的 SHA-256 digest 和预期 view/blob identities。
不要根据文件名猜测“最新结果”，不要解析任意 Pi tool output，不要绕过 validator，也不要给 imported view 贴上
verified 标签。
