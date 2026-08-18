# 架构

[English](architecture.md)

Veil Loom 由浏览器应用、本地 daemon 和一个零额外依赖的 protocol package 组成。

```text
Next.js browser app
  │ validated HTTP commands and ordered SSE events
  ▼
Node daemon
  ├── Pi host
  │   ├── Loom extension
  │   └── optional veil-quant extension
  ├── durable session/task events
  ├── local project capabilities
  └── chart and evidence projection
```

这样的拆分首先是一条安全边界，不只是部署偏好。本地文件、子进程、模型 credentials 与 Veil evidence 留在 daemon；
浏览器只负责渲染 projection，并提交有明确上限的 command。

## 本地传输

Web app 与 daemon 都绑定到固定 loopback 地址。访问受保护 route 前，浏览器会从配置中指定的精确 Origin 发起一个
空的 bootstrap POST。daemon 只通过 HttpOnly、SameSite session cookie 返回 process-scoped secret，JSON response
只确认 handshake 成功，不包含 secret。随后，EventSource 会带上 credentials 直接连接 daemon。

这样一来，bearer material 不会进入 JavaScript、local storage、query parameters、browser history、Referer header，
也不需要写进 Next.js proxy configuration。daemon 重启会轮换 secret；client 重连时先重新 bootstrap，再从 durable
cursor 继续接收事件。

## Profiles

Raw Pi 与 Veil 是同一个 Pi host 上的两种 profile，并不是两个互不相干的 backend。session 启动时会冻结 profile。
从 Raw Pi 转到 Veil 必须创建新的 verification attempt，因为 Veil 需要重新登记 chronology，并独立重执行 artifact。

daemon 在启动时注册 project roots，浏览器只提交 portable project ID。Raw Pi 使用 daemon 解析后的 canonical root。
Veil session 启动前，daemon 还会通过已发布的 `veil-quant` API 加载 project，确认它符合受支持的公开结构。package
缺失、版本不支持、root 不可读或 project declaration 无效时，流程会在写入任何 session event 之前失败。

`veil-quant` 目前发布的是 TypeScript source，因此 daemon 使用它声明的 `tsx` runtime 加载公开入口。Loom 固定支持
经过测试的 `>=0.1.0 <0.2.0` 范围，检查预期 tool 与 project formats，不 import Veil engine internals。加载后的
extension 会为 Veil Pi session 提供 Veil data、backtest 和 memory tools。普通 Pi view 仍然是 exploratory；只有单独的
promotion task 才可能投影 non-exploratory state，而且必须先通过 Veil 公开 API 重新加载并验证 Experiment archive。

### Project readiness

Readiness 对外只有三种状态：

- `ready`：经过测试的 Veil runtime 与 project declaration 均成功加载；
- `invalid`：runtime 已加载，但 project 无法加载；
- `unavailable`：runtime 或 daemon 授权的 project root 不可用。

response 包含已安装/支持的版本、探测到的 project format、capabilities，以及 datasets、runtimes、cost models 和
null generators 的汇总数量。它绝不包含 project root、source locator、dataset ID 或 environment name。Web app 会
严格验证完整 response，只有 `ready` project 才能启用 Veil profile。Readiness 表示能力可用，不是 evidence，更不是
assurance。

## 长时间运行的工作

研究 task 不归 Next.js request handler 或 Server Action 所有。daemon 接受 command、持久化 task state，再通过 event
stream 报告 progress 或 terminal result。浏览器断开不会取消 task。

## Verification attempts

v0 的 promotion boundary 有意保持精简。浏览器只提交 owned Raw view ID、一个规范化的 project-relative artifact
reference 和一段有长度上限的 hypothesis。它不能提交 Raw metrics、expected result、data path、promotion request
file、gate settings 或 assurance label。

创建任何内容前，daemon 会确认：source session 是 Raw Pi；view 由 completed task durable publish；它属于显式
daily-factor adapter；project 已 Veil-ready；所选文件的 hash 与 view artifact digest 相同。检查全部通过后才创建新的
Veil session，旧 event log 不会被修改。

target Pi session 的私有 append-only branch 就是 Veil ledger。Loom 会记录 hypothesis，通过 `veil-data` 重新读取注册
panel，再写入 daemon-owned promotion request，其中包含新 read-set ID 与固定 adapter recipe。Veil 随后完成 artifact
capture、walk-forward execution、pricing、costs、statistical gates 和 Experiment persistence。取得 identity 后，Loom
调用 `loadProjectExperiment()`，再次核对所有将要投影的 hash，最后才 append `veil.experiment_recorded`。

Veil 当前公开 backtest call 是原子的，所以 public stream 只提供粗粒度阶段：development-data read 完成、independent
verification 运行/完成，以及最终 Experiment identity。panel read 是 exploration-grade chronology context，本身不是
verification evidence；真正的 independent run 会执行 point-in-time guarded reads。Loom 不会编造每个 fold 或 gate 的
进度。`ok: false`、exception、cancellation 或 daemon restart 分别产生 failed、cancelled 或 interrupted task，绝不会
被推断成 rejected Experiment。Accepted、degraded 与 rejected 只用于真实且验证过的 archive。

## Experiment 审阅与复现

project Experiment index 是一个有数量上限的 identity index，来源是 durable Veil session events。它让 Web app 能在
刷新后重新打开最近完成的 attempt，但不能代替 archive verification。打开一项记录时，daemon 会再次调用
`loadProjectExperiment()`，核对 session、attempt、hypothesis、verdict、assurance 与 structural hashes，然后才返回
`loom.experiment-evidence.v0`。

这份 review projection 最大 128 KiB，包含经验证的 method、dataset、cost、sample、metric、gate、limitation 与
lineage identities。Artifact source、Arrow bytes、pricing payloads、snapshot contents、archive paths 和 private
diagnostics 都留在 daemon。较长的 lesson list 会明确提供 total 和 truncation flag。

Reproduction 是 owning Veil session 上的新 cancellable task。daemon 用 Experiment ID 与 project runtime 调用 Veil 的
公开 `reproduceProjectExperiment()`；Veil 重新加载 archive，materialize captured artifact，重放 immutable read-set
snapshots，再计算 pricing 与 gates。只有返回精确的 `matched`，并且 Experiment、pricing、gate-evaluation、metric 和
reproduction hashes 全部通过验证时，Loom 才会发出 `veil.reproduction_completed`。Failure、cancellation 或 restart
都不会产生 matched record。Match 只确认可复现性，绝不改变原始 verdict。

## Pi host

daemon 通过 Pi 公开的 programmatic `AgentSession` API 嵌入 Pi。每个 session 由 runtime adapter 管理；adapter 订阅
Pi events，只把用户可见文本和粗粒度 tool/task lifecycle 转成 Loom events。Thinking blocks、tool arguments、tool
result bodies、provider errors、environment values 和 local paths 都不会公开。每个 session 会记录 Pi package version
与不含 secret 的 provider/model fingerprint，但不会保存 credential。

当前纵向切片只启用 deterministic offline provider、一个 reference-backtest Loom tool，以及 ready project 可加载的
固定版本 Veil extension。脚本化 response 只调用 committed reference adapter；promotion 是独立、显式的 browser
action。Loom reference tool 没有 shell、filesystem 或 network authority。Veil tools 仍保留 Veil 文档所述的本地权限。
真实 provider configuration 与 local coding tools 将保持 opt-in，并且始终位于 daemon，而不是浏览器。

## Research views

reference adapter 只接受精确的 `loom.backtest-import.v0` record。在写入任何内容之前，它会验证 ordered time、统一
units、有限的 OHLCV/equity/drawdown values、trades、metric methods、execution semantics 与 source identities。
导入成功后生成四个小型 JSON resources 和一个 `loom.backtest-view.v0` record。Resource ID 是 canonical JSON 的
SHA-256 identity。

Resources 是 immutable 的。Blob 按 content identity 保存；view 与 project、session、task、adapter、source、
artifact 和 run provenance 绑定。daemon 先写入并 sync 临时文件，再以原子 hard-link 方式发布，最后才 append
`view.published`。如果 event append 失败，最多留下一个没有引用的 immutable object，不会暴露半成品 view。

event log 只保存 `loom.view-published.v0` metadata，不重复存放 series。浏览器根据 durable descriptor 请求 view 和
每个 referenced blob，再次检查 schema 与 ownership，然后绘制 chart projection。联动交互与这条 storage boundary
保持分离。

## 同步 selection

Market、equity 与 drawdown charts 共用一个 browser-side viewport state。它统一管理 visible range、crosshair、
selected range、series resolution，以及每次 zoom/pan 的 origin。Origin ID 只在一个有界窗口内保留，避免图表把反射
回来的 update 再次送进 controller，形成交互循环。

浏览器 selection 只是针对 owned view 的请求：view ID、精确 range endpoints 与 visible series keys。daemon 重新加载
canonical resources，检查 time unit、domain、endpoint alignment、ownership、requested series 与 1,024-point limit，
再按情况计算 market return、net return、maximum drawdown 和 execution count。只有精确的 `selection.created` event
成功 append 后，command 才会收到 acknowledgement。

Pi 只会收到 portable view reference、selected range 与 daemon-derived metrics，不会通过这条路径取得底层 series。
public user event 保留原始问题和 selection ID；raw chart data 与 hidden model context 不进入 event log。

## Event recovery

每个 session 都有自己的 append-only JSONL event log，sequence 连续且相互独立。daemon 会先把新 record 写入并 sync
到磁盘，再让 SSE subscriber 看见。重启后，它会验证完整 log 并重建 in-memory tail；partial 或 reordered record 会
fail closed，不会被静默丢弃。

daemon 接受 command 以前，会发现所有使用 portable project/session ID 的日志，并 reconciliation 最后的 durable
state。Loom event log 是 public lifecycle 与 task outcome 的唯一权威。如果 task 已有 `task.started`，却没有 durable
terminal event，恢复过程先 append `session.status_changed: recovering`，再写入 `task.interrupted`，之后才尝试重新
打开 runtime。它不会根据 model history、文件或 provider response 猜测 task 已完成。没有到达 `session.ready`、
topology 损坏或无法恢复 recorded runtime 的 session 会保持 unavailable，并留下 durable failed state。

Pi 另外保存一份私有 session file，用于恢复对话连续性。Loom 用 hashed project/session identity 与 ownership marker
绑定它，只有 package、provider、model、mode 和 fingerprint 仍与 public runtime descriptor 精确一致时才会重新打开。
runtime 真正可用并写入新的 durable ready status 后才会注册。这份文件可以恢复 model context，但不能创建、修改或
升级 Loom task result。

在 Pi persistence 出现以前创建的 session 有一条很窄的兼容路径：Loom 最多取最近 32 条 public user messages 与
assistant completions，总量不超过 32 KiB，用它们创建新的 Pi session，并把 recovery 标记为 `reconstructed`。
Deltas、thinking、tool arguments、tool results、raw series 与 private diagnostics 都不会复制。context 会明确提醒：
被省略或中断的工作没有成功。

浏览器重连时会带上最后成功应用的 sequence。subscription 与 replay 在同一个 serialized operation 中注册，因此
event 不可能落在 replay snapshot 与 live stream 之间。

browser reducer 会独立检查 protocol envelope、project/session ownership、SSE ID、sequence、event identity 与
duplicate content。完全相同的 duplicate 没有影响；sequence gap 会关闭 stream，并从最后应用的 sequence 发起显式
replay。内容冲突的 duplicate 或 malformed event 会 fail closed，并作为 connection error 留在界面上。

State 使用各平台正常的 per-user application-state directory：

- Linux：`$XDG_STATE_HOME/veil-loom`，未设置时为 `~/.local/state/veil-loom`；
- macOS：`~/Library/Application Support/Veil Loom`；
- Windows：`%LOCALAPPDATA%\\Veil Loom`。

开发和打包时可以用 `LOOM_STATE_DIR` 显式覆盖。

## 开发 fixture

`npm run dev:daemon` 会通过真实 Pi session 与 Pi offline faux provider 执行一条脚本化请求，然后导入 committed
daily-factor reference output。生成的 event projection 与 content-addressed view 会持久保存，重启时重新验证，并拒绝
冲突 identity。demo root 含有效的 Veil project declaration，因此 Web app 也会展示不含路径的 readiness summary。
显式 promotion action 使用 committed Veil-compatible momentum artifact 和一个 35-session、four-entity
point-in-time panel；Raw chart metrics 从不作为 target。`npm run dev:web` 直接向 loopback daemon 鉴权并渲染真实
fixture series。Production build 不会启用 demo stream。

## 纯净环境验收

面向发布的 acceptance runner 是一个零额外依赖的 Node program，不是另一套 test-only runtime。它在空闲 loopback
ports 上启动 built Next.js server 与 built daemon，把 committed daily-factor example 复制进隔离的临时 project，
再通过 public HTTP protocol 驱动产品。路径覆盖 Raw view publication、四种 chart resources、daemon-derived chart
selection、selection-grounded Pi work、独立 Veil promotion、daemon restart 与 session reconciliation、Experiment
history/evidence，以及精确 reproduction。

daemon child 只收到一小组 allowlisted operating-system environment variables 和显式 Loom configuration；provider
credentials 与无关 CI environment values 不会继承。runner 会检查 promotion 没有改变 Raw event log、restart 保留
旧 event prefix、reproduction 不改 verdict、public evidence 不含 private path/archive payload，以及 committed fixture
inputs 的 hash 未变。即使某项检查失败，临时 project 与 state 也会被删除。

CI 在 Linux、macOS、Windows 的 Node 24 上，先跑普通 full check，再执行同一条 built-product path。Linux Node 22
lane 继续验证声明的最低 runtime，但不重复较长的纵向验收。

## 依赖方向

`apps/web` 只依赖 protocol package。`apps/daemon` 依赖 protocol，也可以依赖 Pi 和公开发布的 Veil packages。
Veil 永远不依赖 Loom。
