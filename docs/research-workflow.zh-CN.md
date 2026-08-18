# 研究工作流

[English](research-workflow.md)

这份 walkthrough 使用仓库自带的 deterministic daily-factor project。它不需要模型账号，也不需要 private market
data，但会完整展示产品边界。请先完成[快速开始](getting-started.zh-CN.md)，并保持两个开发进程运行。

## 1. 先确认本地边界正常

打开 `http://127.0.0.1:3000`。在解释任何结果前，先看 header：

- **Daemon live** 表示经过鉴权的 event stream 已连接；
- **Offline Pi fixture** 表示没有访问 model provider；
- **Veil 0.1.0 ready** 表示注册的 demo project 可以创建 Veil attempt；
- **EXPLORATORY · UNVERIFIED** 表示 source chart 尚无 independent assurance。

如果 readiness 不可用，或者 stream 不是 live，请先停下来查看[故障排查](troubleshooting.zh-CN.md)。屏幕上出现一张图，
并不足以证明支撑它的本地 authority 正常。

## 2. 阅读 Raw research view

demo daemon 会创建 idempotent Raw Pi session，并让 reference tool 发布 committed backtest。左侧展示用户可见的 Pi
conversation 与 task lifecycle；右侧展示：

- 日频 market OHLC bars；
- execution markers；
- net equity 与 drawdown；
- exploratory metrics；
- source、artifact、execution 与 cost provenance。

这些是实际 fixture data，不是画出来的 placeholder。但 assurance 仍然是 exploratory，因为成功导入并渲染一份有效
record，不等于完成了独立验证。

## 3. 用图表区间 grounding 问题

在任意一张同步图表上拖出范围，或者选择 committed maximum-drawdown range。两张图共用 visible window 与 selection。

点击 **Create selection context**。浏览器只发送 owned view ID、精确 range 和 visible series keys。daemon 会对照
canonical resources 验证范围，再返回 market return、net return、maximum drawdown、execution count 等 summary。

点击 **Ask Pi about selection**。新 task 会收到 durable selection reference 与 daemon-derived summary，不会收到
浏览器自造 metrics，也不会得到一份无上限的 chart copy。public session log 会记录 selection ID，因此重启后仍可恢复
这次交互。

## 4. 创建独立 verification attempt

在 **Promote with Veil** 中检查两个可编辑字段：

- **Project-relative artifact** 默认为 `artifact/daily-factor.mjs`；
- **Hypothesis** 默认为 committed cross-sectional trend statement。

artifact reference 必须相对于 project。Absolute path、traversal、backslash、symlink、unknown field，以及 digest 与
source view 不一致的文件都会被拒绝。

点击 **Promote with Veil**。Loom 在创建任何内容前先验证 handoff，随后打开新的 Veil session。Raw session 与 chart
保持不变。新 attempt 记录自己的 chronology，重新读取注册数据，capture artifact，再执行 contract、pricing、cost、
statistical gate 与 Experiment 流程。

当前 committed fixture 会产生一个真实的 `rejected` Experiment。这是预期结果，而且很有价值：它证明 UI 可以诚实
报告不理想的 verified result，不会把它说成 execution error，也不会悄悄保留一个更好看的 Raw metric。

## 5. 区分不同 outcome

promotion panel 可能以几种本质不同的方式结束：

- **accepted**、**degraded** 或 **rejected**：存在经 archive 校验的 Experiment；
- **execution failed**：artifact/runtime 未产生可验证的成功结果，没有推断 Experiment verdict；
- **cancelled**：用户停止了 task，不存在 Experiment claim；
- **interrupted**：daemon 在 durable terminal result 前重启，这项工作必须重试。

只有第一组带有 Veil assurance。无论结果如何，source Raw chart 都保持 **EXPLORATORY · UNVERIFIED**。

## 6. 审阅 evidence

Experiment 存在时，不要只看 headline verdict。evidence drawer 还包括：

- dataset 与 pricing-method identity；
- OOS sample size 和 periods per year；
- 带 basis 与 scope 的 verified metrics；
- 每个 gate 的 outcome 与 reason code；
- rationale、limitations 与受限 lessons；
- archive、artifact、contract、pricing、gate 与 read-set identities。

这些内容来自重新验证过的 archive，并经过大小限制。Captured code、raw pricing series、snapshot contents、archive
paths 与 private diagnostics 都不会进入浏览器。

## 7. Reproduce Experiment

点击 **Reproduce Experiment**。Veil 会从 immutable snapshots 重放 archived artifact，并重新计算 pricing、metrics 与
gates，全程不访问模型。

reference workflow 的成功结果是 **matched**，表示 replay identities 与原 archive 一致。它不会改变原来的
`rejected` verdict。可以点击 **Reproduce again** 再跑一次；正在运行的 reproduction 也可以像普通 task 一样取消。

## 8. 测试 restart recovery

保留两个已完成 session，只在 daemon 终端按 `Ctrl+C`，然后用同一个 `LOOM_STATE_DIR` 重新启动。必要时刷新浏览器。

旧 browser cookie 会被拒绝，并在 bootstrap 时换新。已经完成的 Raw/Veil event prefixes、selection、Experiment
index 与 evidence 都会保留。停机时缺少 durable terminal 的工作会显示 interrupted，而不是 completed。

## 应该记住什么

这条 workflow 刻意做成不对称：

- exploration 追求速度与交互；
- promotion 为 independent execution 支付成本；
- evidence 来自 validated records，而不是 model prose；
- reproduction 核对 identity parity，但不改写历史。

这些边界背后的术语，见[核心概念](core-concepts.zh-CN.md)。
