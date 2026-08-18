# 核心概念

[English](core-concepts.md)

只要先把几个容易混淆的词分开，Veil Loom 就不难理解。它的大部分设计，都是为了避免一张方便好看的研究图表，
不知不觉被说成证据并不支持的强结论。

## Local-first 不等于 sandbox

浏览器、daemon、Pi、Veil 与用户工具运行在同一台机器上。研究 state 默认留在本地，daemon 也只监听 loopback。
这是隐私与部署选择，不是 operating-system sandbox。Pi shell commands、Veil runtimes 和 user code 仍以当前用户权限
运行。

浏览器被视为不可信的展示层。它只接收有明确上限的 projections，不接收 provider credentials、无限制路径、private
process diagnostics，也没有权限宣布某个结果已经 verified。

## Project 与 readiness

**Project** 是 daemon 授权的本地 root；浏览器只通过 portable project ID 引用它，不能提交 filesystem path。支持
Veil 的 project 会包含 Veil declaration，以及已注册的 data/runtime configuration。

**Readiness** 只回答一个问题：经过测试的 Veil package 和这个 project 能否加载？它可能是 `ready`、`invalid` 或
`unavailable`。Ready 不代表 strategy、chart、metric 或 claim 已通过验证，只表示现在可以创建新的 verification
attempt。

## Session profiles

session 启动时会冻结一种 profile：

- **Raw Pi** 提供 Pi、Loom conversation、本地工作、charts、selections、cancellation 与 replay。所有研究结果仍是
  exploratory。
- **Veil** 增加固定版本的 `veil-quant` capability，可以执行 guarded data 与 promotion workflows；但 session 中的
  普通工作仍是 exploratory，直到真正产生 evidence。

改一个 UI badge 不能让 profile 互相转换。Promote Raw result 会创建新的 Veil session，拥有独立 task history 与
ledger。

## Assurance

Assurance 表示“现有证据允许 Loom 说到什么程度”，与数字看起来是否漂亮无关。

| State | Issuer | 含义 |
| --- | --- | --- |
| `exploratory` | Loom | 有研究价值，但没有独立 Veil evidence |
| `contract-verified-unverified` | Veil | 已有 contract record，但还没有最终、可引用的 Experiment verdict |
| `accepted` | Veil | verified Experiment 通过了适用的 decision path |
| `degraded` | Veil | 已有 evidence，但 limitations 或 gates 要求带条件地看待结果 |
| `rejected` | Veil | 真实 Experiment 已完成，其 decision path 拒绝了 claim |

`rejected` 不是“程序崩了”的另一种说法。Execution failure、cancellation、malformed evidence 与 restart interruption
只会产生 task terminal，不会产生 Experiment verdict。

## Task、event 与 recovery

**Task** 是由 daemon 管理的长时间工作。HTTP 只确认 task 已启动；progress 和 terminal result 由有序 session events
报告。

append-only Loom event log 是 public source of truth。event 会先 sync，再 broadcast。重启时，缺少 durable terminal
event 的工作会变成 `task.interrupted`；Loom 不会根据 model transcript 或 output file 猜测它已经成功。

Pi 还有一份私有 conversation file。runtime identity 一致时，它可以恢复 context，但不能创建或升级 Loom task result。

## View、blob 与 provenance

**View** 是经过验证的 research-result metadata。较大的 chart values 存放在 immutable content-addressed **blobs** 中，
session event 只保留有明确上限的 descriptor。每个 view 都绑定到创建它的 project、session、task、adapter、source
digest、artifact digest 与 run provenance。

reference backtest view 包含 market、net-equity、drawdown 与 trade resources。即使 import 在 schema 上完全有效，
metrics 仍然是 exploratory：格式正确不等于统计验证。

## Selection

**Selection** 是 owned chart 某个区间的 durable、bounded reference。浏览器提交 view ID、精确 endpoints 与 visible
series keys；daemon 重新加载 canonical blobs，并自行计算 summary。Pi 收到的是 range、portable view reference 与
derived summary，而不是通过这条 command 获得 raw series。

因此，“最大回撤期间发生了什么？”这类问题可以被可靠地 grounded 和 replay，又不必信任浏览器计算的 metrics。

## Promotion

**Promotion** 是从 exploration 显式交接到全新 verification attempt 的动作。浏览器只发送：

- owned Raw view ID；
- project-relative artifact reference；
- hypothesis statement。

daemon 会核对 ownership 与 artifact digest，创建独立 Veil session，重新读取注册数据，再执行固定的
contract/pricing/gate recipe。Raw Sharpe、returns、equity 等展示值绝不会被复制成 expected result。

## Experiment 与 evidence

**Experiment** 是 Veil 对独立执行流程的持久化结果。Loom 重新加载 archive 并验证 identity 后，才会投影 verdict。
evidence view 展示有界的 method、dataset、cost、sample、metric、gate、limitation 和 lineage details；artifact source、
raw pricing data、snapshots、private paths 与 diagnostics 则留在 daemon。

project Experiment index 只是为刷新和审阅提供方便。它指向 evidence，本身不会签发新 evidence。

## Reproduction

**Reproduction** 会重放归档 artifact、immutable read-set snapshots、pricing 与 gates，不会重新运行 model conversation。
`matched` 表示 Experiment、pricing、gate-evaluation、metric 与 reproduction identities 均与 archive 一致。

Match 证明的是 identity parity。它不会把 `rejected` 变成 `accepted`，不会抹去 limitation，也不会追认 source Raw
chart 已通过验证。

## 一个好用的心智模型

```text
Raw exploration
  → owned view and artifact identity
  → explicit promotion
  → independent Veil execution
  → archive-validated Experiment
  → optional exact reproduction
```

每一个箭头都代表新 record 与新 evidence，不是在同一份可变结果上换一个好看的状态。
