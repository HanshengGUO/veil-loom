# 协议

[English](protocol.md)

protocol package 是浏览器和 daemon 之间唯一共享的 contract。它只包含精确的 TypeBox schemas 与 TypeScript types，
不依赖 network、filesystem、React、Pi 或 Veil。

初始 contract 定义了：

- session profiles 与 capabilities；
- Veil runtime 和 project readiness；
- 最小化的 Raw-to-Veil promotion commands 与精确 verification records；
- assurance states，以及每种状态允许的 issuer；
- daemon health 与 profile discovery responses；
- 有序 session events、replay responses 与经过脱敏的 errors。

## Daemon session

bootstrap route 要求配置中指定的精确 Origin。bootstrap 之后，除 health 与 CORS preflight 外，所有 browser-facing
route 都同时要求该 Origin 和有效的 daemon-session cookie。浏览器从这里开始：

```text
POST /v0/auth/bootstrap
Origin: http://127.0.0.1:3000
```

成功的 JSON response 不含 credential：

```json
{ "format": "loom.auth.v0", "status": "ready" }
```

启动 secret 只通过 HttpOnly、SameSite session cookie 交付。每个 daemon process 都使用 256-bit randomness 生成新
secret；query parameter 永远不接受它，重启后旧 secret 立即失效。credential 缺失或无效时返回 `AUTH_REQUIRED`；
Origin 缺失或不匹配时返回 `ORIGIN_FORBIDDEN`。daemon 永远不会使用 `Access-Control-Allow-Origin: *`。

## Project readiness

受保护且不可缓存的 readiness route 为：

```text
GET /v0/projects/:projectId
```

ready project 返回精确的 `loom.project-readiness.v0` record：

```json
{
  "format": "loom.project-readiness.v0",
  "projectId": "daily-factor-demo",
  "profile": "veil",
  "status": "ready",
  "runtime": {
    "package": "veil-quant",
    "installedVersion": "0.1.0",
    "supportedRange": ">=0.1.0 <0.2.0",
    "detectedFormats": ["veil.project.v0"]
  },
  "capabilities": [
    "chat",
    "local-code",
    "loom-chart",
    "loom-selection",
    "task-cancel",
    "session-replay",
    "veil-data",
    "veil-promotion",
    "veil-experiment",
    "veil-reproduction"
  ],
  "project": {
    "format": "veil.project.v0",
    "datasetCount": 1,
    "runtimeCount": 1,
    "promotionConcurrency": 2,
    "costModelCount": 1,
    "nullGeneratorCount": 1
  }
}
```

`invalid` 与 `unavailable` response 不含 project summary 或 capabilities，只携带一项有长度上限的 public issue，字段为
`code`、`message` 和 `remedy`。response 永远不包含 absolute root、source locator、dataset ID、environment name 或
raw data。Unknown fields、伪造 ownership、重排 capabilities 或互相矛盾的 status fields 都无法通过 protocol validation。

Readiness 只说明 Veil profile 可以加载。它不会创建 verification attempt、Experiment、evidence reference 或
non-exploratory assurance。project 尚未 ready 时创建 Veil session，会返回 `PROJECT_NOT_READY`，也不会留下 durable
session。

## Veil verification attempts

Promotion 从 Raw Pi session 发起：

```text
POST /v0/sessions/:sourceSessionId/promotions?projectId=:projectId
```

精确 request 有意比 Veil promotion request 更小：

```json
{
  "format": "loom.promotion.create.v0",
  "viewId": "view_<sha256>",
  "artifactReference": "artifact/daily-factor.mjs",
  "hypothesis": {
    "statement": "The factor remains positive out of sample after costs."
  }
}
```

`artifactReference` 必须是 daemon-owned project root 下规范化、可移植的路径。Absolute path、backslash、空 segment、
`.` segment、control character 和 unknown field 都会被拒绝。schema 没有 Raw metrics、expected values、data
locators、protocol settings、gates 或 assurance 字段。

daemon 核对 source view、task topology、adapter identity 与 artifact digest 后，返回
`loom.promotion.accepted.v0`。其中 `sourceSessionId` 指向保持不变的 Raw session；`sessionId` 指向新创建的 Veil
session，两者必须不同。response 还包括新 task ID 与 attempt ID。

target stream 使用三种精确 payload：

- `loom.veil-verification-started.v0` 记录 `derived-from-exploration`、source view/session、所选 artifact identity
  与 Veil hypothesis reference；
- `loom.veil-stage-changed.v0` 只报告已完成的 development-data read，以及 running/completed independent
  verification。panel read 建立的是已观察到的 development read-set，仍属于 exploration-grade，本身不是
  verification evidence；
- `loom.veil-experiment-recorded.v0` 记录 Experiment/archive identity、structural hashes、execution count、
  registration status、verdict、claim status 与精确 Veil assurance。

最终 payload 只允许 `accepted → verified`、`degraded → degraded` 或 `rejected → rejected`，它的 assurance evidence
必须恰好是 Experiment ID 加 verified archive hash。Events 必须按 attempt/stage 顺序到达，并与 target task 匹配。
遇到 malformed、reordered、cross-attempt 或 forged evidence，browser reducer 会停止应用。

Veil 返回 `ok: false` 或抛出 execution exception 时，task 以 `task.failed` 结束；不会产生
`veil.experiment_recorded`，UI 也不能把它渲染为 rejected。取消产生 `task.cancelled`。重启时没有 terminal 的 task
按普通 `task.interrupted` 规则处理，绝不会恢复执行或猜测成功。

## Experiment evidence 与 reproduction

无需打开 private archive，也可以发现已经完成的 Experiment identities：

```text
GET /v0/projects/:projectId/experiments
GET /v0/sessions/:sessionId/experiments/:experimentId?projectId=:projectId
```

`loom.project-experiments.v0` 最多包含最新 50 个不重复 Experiment identities，并报告 `totalCount` 与 `truncated`。
每一项把 target session/attempt/task 绑定到 Raw source、hypothesis、verdict、assurance、archive hash 与 recorded time。
它只是刷新和审阅用的 index，不是新的 evidence issuer。

第二个 route 会重新加载 immutable Veil archive，并返回精确的 `loom.experiment-evidence.v0`。这份有界 projection
包含 dataset 与 method identities、cost model、OOS sample、verified metrics、每个 gate 的 outcome 与 reason code、
rationale、受限的 lesson summary，以及 structural/series/read-set lineage identities。Artifact contents、pricing
series、snapshot bytes、filesystem references 与 private diagnostics 都不会出现在 response 中。Session、attempt、
Experiment、archive、hypothesis、verdict 与 assurance ownership 必须全部一致。

Reproduction 必须显式发起：

```text
POST /v0/sessions/:sessionId/experiments/:experimentId/reproductions?projectId=:projectId
{ "format": "loom.experiment.reproduce.v0" }
```

body 不接受 expected metric、verdict、gate、path 或 runtime。command 成功后会启动普通 cancellable task。只有 Veil
精确的 `veil.experiment-reproduction.v0` `matched` result 才能产生
`loom.veil-reproduction-completed.v0`，而且 original/reproduced Experiment ID 必须相同。event 还携带 pricing、
gate-evaluation、metric 与 reproduction hashes。`matched` 表示可以复现，不会升级或替换 archive verdict。Failure、
cancellation 与 interruption 使用普通 task terminal，不产生 reproduction-completed event。

## Session events

每个 event 使用 `loom.event.v0` envelope：

```json
{
  "format": "loom.event.v0",
  "eventId": "evt_1d36db79-e557-4f65-aea5-b12313bc7671",
  "projectId": "demo-project",
  "sessionId": "session-1",
  "sequence": 1,
  "occurredAt": "2026-08-17T10:00:00.000Z",
  "type": "session.created",
  "payload": { "profile": "raw-pi" }
}
```

sequence 在每个 session 中从 1 开始并保持连续。daemon 会验证 payload 可以安全表示为 JSON，先写入并 sync event，
之后才通知 subscriber。truncated、corrupt 或 non-contiguous log 会被拒绝打开。Project、session 与 event ID 使用
portable character set，避免它们演变成 filesystem path。

read API 使用 cursor：

```text
GET /v0/sessions/:sessionId/events?projectId=:projectId&afterSequence=:sequence
GET /v0/sessions/:sessionId/stream?projectId=:projectId&afterSequence=:sequence
```

第一个 route 返回 `loom.events.v0` JSON，第二个发送 `loom.event` server-sent events，并以 session sequence 作为
SSE `id`。重连时可以用 `Last-Event-ID` 代替 `afterSequence`。cursor 超过 durable tail 会返回
`EVENT_CURSOR_AHEAD`；daemon 不会猜测位置或偷偷向前跳。

consumer 只应用 `lastSequence + 1`。完全相同的 duplicate 可以忽略，但同一个 sequence 或 event ID 如果对应不同内容，
就是 protocol conflict。假如 sequence 10 之后直接收到 12，consumer 不能应用 12，也不能让浏览器隐式 SSE cursor
越过缺失的 11。它必须关闭 connection，再显式请求 sequence 10 之后的 replay。

Chart series 使用 immutable blob reference，不会反复写进无限增长的 event log。`view.published` event 携带精确
`loom.view-published.v0` descriptor，而不是 series values。

### 重启 reconciliation

决定 task 是否完成的是 event log，而不是 Pi 私有 conversation file。daemon 启动时，仍处于 open 状态的 durable
session 会按顺序写入：

1. `session.status_changed`，其中 `status: "recovering"`；
2. 每个缺少 durable terminal event 的 task 各写一条 `task.interrupted`；
3. runtime 确认重新可用后，写入 `session.status_changed`，其中 `status: "ready"`，`recovery: "resumed"` 或
   `"reconstructed"`。

`task.interrupted` 是 terminal。稳定错误码 `DAEMON_RESTART` 表示不存在 successful terminal record，用户必须重试。
如果 session 在第一次 `session.ready` 前崩溃，则以 `SESSION_START_INTERRUPTED` 结束，不再恢复为可执行状态。
runtime restore failure 以 `PI_RECOVERY_FAILED` 结束；public record 可以提供 remedy，但不含 provider diagnostics 或
local path。

`reconstructed` compatibility mode 只使用最近且有上限的 public user events 与 completed assistant messages。
partial deltas、tools、views、selections 和 hidden model context 都不会 replay。两种 recovery mode 都不能合成
`task.completed`。

## Chart selections

浏览器通过以下 route 创建 selection context：

```text
POST /v0/sessions/:sessionId/selections?projectId=:projectId
```

精确的 `loom.selection.create.v0` body 包含 `viewId`、`from`、`until`，以及一个或多个 visible `seriesKeys`，
没有 summary 字段。Unknown fields、混用 time units、重复 keys、不是 series observation 的 endpoints、超出 owned view
的 range，以及超过 1,024 个 market observations 的 range 都会被拒绝。

daemon 根据 canonical blobs 重新计算 `loom.selection.v0` record，再通过精确的 `loom.selection-created.v0` payload
durable publish。`visibleSummary` 中的 metrics 使用 `sampleScope: "selection"`；普通 backtest metrics 仍是
`full-sample`。record 与 project、session、view 绑定，不含 raw series values。command 成功时，receipt 会返回
selection ID。

后续 prompt 如果需要使用这份 context，`loom.message.send.v0` 可以携带 selection ID。daemon 从 owned durable log
解析它，只向 Pi 提供 portable view reference、range 与 daemon-derived summary。未知或跨 session ID 返回
`SELECTION_NOT_FOUND`。

## Backtest views

第一个 adapter boundary 是 `loom.backtest-import.v0`。ordered market、equity、drawdown、trade 与 region values
必须使用同一个 time unit。时间表示为带符号的十进制 epoch string，配合 `ms`、`us` 或 `ns`；consumer 比较它时不能
经过不安全的 JavaScript number 转换。每个 metric 都提供稳定 key、value 或 text、unit、scale、sample scope 和
method。

有效 import 会变成：

- 带 exploratory assurance 与 project/session/task provenance 的 `loom.backtest-view.v0` metadata；
- 包含 `loom.series.v0` OHLCV 或 scalar data 的 `loom.blob.v0` envelopes；
- 一个包含 `loom.table.v0` trade table 的 `loom.blob.v0` envelope。

Blob ID 是 canonical content bytes 的 SHA-256 hash。View ID 是附加 ID 之前 canonical view content 的 hash。v0 JSON
path 限制为：每个 series 最多 4,096 items、每个 blob 最多 256 KiB、每个 view 的 references 最多 1 MiB、view
metadata 最多 64 KiB。Arrow IPC 以及更大的 paged/ranged resources 不会被静默接受，必须等待后续 protocol version。

受保护 read 会把每个 resource 绑定到 durable view ownership tuple：

```text
GET /v0/views/:viewId?projectId=:projectId&sessionId=:sessionId
GET /v0/blobs/:blobId?projectId=:projectId&sessionId=:sessionId&viewId=:viewId
```

blob route 只会提供该 owned view 明确引用的 blob。Unknown、cross-session、corrupt 或 identity-mismatched resource
都会 fail closed。reference adapter 只能签发没有 evidence 的 exploratory assurance；普通 Pi tool output 永远不会被
推断为 view。

## Commands

mutation 使用精确、版本化的 JSON body，并返回带 generated command ID 的 `202 Accepted`：

```text
POST /v0/projects/:projectId/sessions
POST /v0/sessions/:sessionId/messages?projectId=:projectId
POST /v0/sessions/:sessionId/selections?projectId=:projectId
POST /v0/sessions/:sessionId/promotions?projectId=:projectId
POST /v0/sessions/:sessionId/experiments/:experimentId/reproductions?projectId=:projectId
POST /v0/sessions/:sessionId/tasks/:taskId/cancel?projectId=:projectId
```

对应 body formats 分别是 `loom.session.create.v0`、`loom.message.send.v0`、`loom.selection.create.v0`、
`loom.promotion.create.v0`、`loom.experiment.reproduce.v0` 与 `loom.task.cancel.v0`。Unknown fields、blank
messages、oversized bodies、non-portable IDs 与 unavailable profiles 都会 fail closed。普通 command 使用
`loom.command.accepted.v0`；promotion 使用 `loom.promotion.accepted.v0`，明确区分 source 与新 target session。
Message、reproduction 和 cancellation response 携带 task ID，selection creation 携带 selection ID。Completion
不依赖 HTTP connection，而是通过有序 event stream 报告。

Raw Pi adapter 映射 public text deltas、assistant completion 与粗粒度 tool/task state，不暴露 model thinking、tool
arguments、tool result bodies 或 provider diagnostics。`loom.pi-runtime.v0` descriptor 记录 package version、provider、
model、mode 与不含 secret 的 fingerprint，确保 replay 仍可追溯。

## Assurance

Loom 只能签发 `exploratory` assurance。Contract 与 Experiment states 必须从经过验证的 Veil records 独立派生。
对于 v0 完整 promotion recipe，只有 Veil 重新加载并验证 immutable Experiment archive 后，Loom 才会发布 final state。
浏览器永远不会根据 metric、process exit code、model message、visual similarity、已加载的 Veil extension 或 `ready`
project response 推断 assurance。
