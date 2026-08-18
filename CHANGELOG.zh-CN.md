# 变更日志

[English](CHANGELOG.md)

Veil Loom 的重要变化都会记录在这里。

首个 package 发布后，项目将遵循 semantic versioning。Protocol format version 独立于 package version 管理。

## 尚未发布

### 新增

- 建立初始仓库骨架：Next.js、Tailwind、Node daemon 与共享 protocol package。
- 加入 Raw Pi 和 Veil profile descriptors，并明确二者之间的 assurance boundary。
- 加入版本化 session event envelopes 与经过脱敏的 API errors。
- 为每个 session 提供 append-before-broadcast 的 durable log，并支持重启后 replay。
- 提供基于 cursor 的 JSON replay 与可重连的 server-sent event stream。
- 浏览器 projection 能识别 sequence gap、精确 duplicate，并进行显式 cursor recovery。
- 在双栏开发界面中展示 idempotent、durable 的 Raw Pi demo session。
- daemon 每个进程生成独立的 256-bit session，通过 Origin-gated HttpOnly cookie handshake 交付。
- 加入带 credential 的 direct SSE、严格 CORS response、token rotation 与真实 loopback binding tests。
- 接入真实 Raw Pi `AgentSession` host，使用 deterministic offline provider 与 inline Loom extension。
- 加入版本化 session、message、cancellation commands，以及 durable、redacted 的 Pi event projection。
- 记录 Pi package/provider/model fingerprints，覆盖取消场景，并测试 provider-error redaction。
- 实现严格的 `loom.backtest-import.v0` reference adapter，支持 bigint-safe time，并明确 metric、execution、
  assurance 与 provenance semantics。
- 以原子方式发布 content-addressed view/blob resources；read API 绑定 ownership，并固定 JSON size limits。
- Web canvas 真实展示 OHLC、trades、net equity、drawdown、metrics 与 provenance。
- 统一 chart viewport，支持 crosshair、selection、zoom、pan 与 origin de-duplication。
- selection 与 view ownership 绑定，summary 由 daemon 派生，并可受限地回传 Raw Pi context。
- daemon 启动时发现 durable Raw Pi sessions，并以 fail-closed 方式 reconciliation。
- 持久保存 Pi conversation continuity；通过 ownership marker、精确 runtime match 和受限 public-transcript
  reconstruction 兼容旧 session。
- 对 daemon 停止时没有 durable result 的工作写入明确的 `task.interrupted` terminal。
- 固定 `veil-quant` runtime 版本范围，加入 daemon-authorized project registry 与不含路径的精确
  `loom.project-readiness.v0` response。
- Veil Pi sessions 可在重启后恢复；它们加载公开 Veil extension，但在投影独立证据前，Loom views 始终保持 exploratory。
- Web readiness client 对伪造 ownership、malformed data 与 oversized response 默认拒绝，只为 ready project 开启
  Veil profile。
- 加入精确的 `loom.promotion.create.v0` handoff，只接受 owned view、project-relative artifact 与 hypothesis，
  不接受 Raw metrics 或 expected-result fields。
- 创建独立 Veil verification sessions，记录私有 hypothesis/data/run chronology，执行 guarded data reads 与可取消的
  independent re-execution，并保持 restart-safe task semantics。
- 加入经 archive 校验的 `veil.verification_started`、coarse stage 与 `veil.experiment_recorded` projections，
  明确区分 execution failure 与 rejected Experiment。
- 提交一个 Veil-compatible 的 two-session momentum artifact，以及用于端到端 promotion fixture 的 35-session、
  four-entity panel。
- Web 加入 **Promote with Veil**，在展示新 attempt 的真实 task 与 Experiment outcome 时仍保留 Raw view 的
  exploratory label。
- 加入受限的 project Experiment index，以及经 archive 复核的 `loom.experiment-evidence.v0` projection，展示
  method、dataset、cost、metric、gate、limitation 与 lineage details。
- 通过 Veil 公开 archive/snapshot replay API 提供显式、可取消的 reproduction task；只有 fail-closed 的
  matched-identity event 才表示成功，且永远不会改变原 verdict。
- 加入 Experiment evidence drawer 与已完成 attempt 的刷新恢复，同时避免向浏览器暴露 artifact code、原始 pricing
  payload、snapshot content 或 private path。
- 加入零额外依赖的 clean-machine runner，启动构建后的 Web app 与 daemon，在 Linux、macOS、Windows CI 上验证
  完整 reference workflow、restart recovery 与 reproduction。
- 为全部公开文档补齐简体中文版本和双向语言入口，英文仍是 canonical default。
- 增加双语快速开始、研究工作流、核心概念与故障排查指南，内容以当前 developer preview 的真实能力为准。

### 修复

- demo project 改为根据 daemon module 位置解析，不再依赖 npm workspace working directory；文档中的
  `npm run dev:daemon` 现在会返回真实 Veil readiness。
