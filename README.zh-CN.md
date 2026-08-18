# Veil Loom

[English](README.md)

Veil Loom 是一个本地优先的量化研究可视化工作台，建立在
[Pi](https://github.com/earendil-works/pi) 和 [Veil](https://github.com/HanshengGUO/veil) 之上。

它围绕一条很朴素的边界来设计：**探索应该足够快，结论则必须诚实。** Raw Pi session 可以对话、写代码、
运行本地工具，也可以发布可交互的研究视图；Veil session 在此基础上加入受保护的数据读取、promotion contract、
统计 gates、Experiment memory 与 reproduction。

> 当前状态：pre-alpha。Raw Pi 与 Veil session 已可在重启后恢复，支持同步回测图表、范围受限的图表选择、
> project 级 Veil readiness，以及从 Raw 到 Veil 的独立验证尝试、可审阅证据与精确复现。模型路径仍完全离线，
> Loom 本身尚未发布到 npm。

## Session profiles

| Profile | 提供什么 | 可信度 |
| --- | --- | --- |
| Raw Pi | Pi 加上 Loom 的对话与可视化工具 | 所有结果都是 exploratory、unverified |
| Veil | Raw Pi 的能力加上 `veil-quant` | 独立重执行后，Veil 可以签发 contract 或 Experiment evidence |

Raw Pi 的结果不能靠换一个 badge 就“升级”。点击 **Promote with Veil** 会创建独立的 Veil session 与 ledger，
重新读取注册数据，再执行一次选中的 artifact。无论新尝试的结果如何，原始视图始终保持 exploratory。

daemon 目前固定使用经过测试的 `veil-quant` `0.1.x` 系列，通过它的公开 project API 加载项目，并报告当前项目是否
ready。Ready 只表示 Veil tools 能正常加载，不代表任何结果已经通过验证。Loom 会展示新尝试的粗粒度生命周期、
经 archive 校验的 Experiment identity、受限的 evidence summary，以及精确 reproduction 的结果。

## 架构

```text
Browser (Next.js + Tailwind)
  │ HTTP commands + SSE events
  ▼
Loom daemon (Node.js)
  ├── Pi host + Loom extension
  ├── optional veil-quant extension
  ├── project/session/task store
  └── view and evidence projection
          ▼
      user tools + Veil public APIs
```

浏览器不持有本地进程、文件系统、provider credential 或 evidence authority。daemon 默认只监听 loopback。
Pi 的普通 shell 以当前用户权限运行；Loom 和 Veil 都不会把它包装成所谓的 sandbox。

## 仓库结构

```text
apps/web/          Next.js App Router 与 Tailwind UI
apps/daemon/       本地 Node 服务与进程管理
packages/protocol/ 浏览器和 daemon 共用的版本化 schema
docs/              公开的架构、协议与安全文档
```

## 文档

- [快速开始](docs/getting-started.zh-CN.md)
- [研究工作流](docs/research-workflow.zh-CN.md)
- [核心概念](docs/core-concepts.zh-CN.md)
- [故障排查](docs/troubleshooting.zh-CN.md)
- [架构](docs/architecture.zh-CN.md)
- [协议](docs/protocol.zh-CN.md)
- [安全模型](docs/security.zh-CN.md)
- [纯净环境验收](docs/clean-machine-acceptance.zh-CN.md)
- [贡献 backtest adapter](docs/contributing-adapters.zh-CN.md)
- [贡献指南](CONTRIBUTING.zh-CN.md)、[安全问题报告](SECURITY.zh-CN.md)与[变更日志](CHANGELOG.zh-CN.md)

英文是默认文档语言。每一份文档的标题下方都有语言切换入口，中文版本不是摘要，而是完整内容。

## 开发

需要 Node 22.19 或更高版本。

```bash
npm install
npm run check
```

发布前，或者修改了平台相关代码后，请运行 built-product acceptance：

```bash
npm run accept:clean-machine
```

这条命令会构建整个仓库，在空闲的 loopback 端口上启动 production Web app 和 daemon，把 daily-factor fixture
复制到临时 project，然后依次验证图表导入、selection、Veil promotion、daemon 重启、evidence review 与精确复现。
runner 使用 Pi 的离线 faux provider，不会把 provider credentials 传给子进程，结束后也会清理临时 project 和 state。
CI 在 Linux、macOS、Windows 的 Node 24 上运行同一条 built-product 路径，同时保留 Linux Node 22 的最低版本
full check。冻结的验收约定见[纯净环境验收](docs/clean-machine-acceptance.zh-CN.md)。

开发时请在两个终端中分别启动：

```bash
npm run dev:daemon
npm run dev:web
```

两个进程都只监听 loopback。开发模式下，daemon 会通过 Pi 的真实 programmatic session 与 Loom extension 执行一条
脚本化请求，模型由 Pi 的离线 faux provider 提供。extension 只调用 committed daily-factor output 对应的显式 adapter。
Loom 会验证输出，以原子方式保存 content-addressed series，并且只把受限的 view metadata 写入 durable event stream。

请使用精确地址 `http://127.0.0.1:3000` 打开 Web app。页面会经过 Origin gate 完成 bootstrap，并取得 HttpOnly
daemon-session cookie；不需要把 token 复制到 UI，也不会把 token 放进 URL。daemon 默认监听
`http://127.0.0.1:43120`。

Web app 会加载属于当前视图的资源，真正绘制 OHLC、execution markers、net equity、drawdown、metrics 与 provenance。
两张图共享 crosshair、时间范围、缩放、平移和选择状态。拖出一个区间，或者直接选择最大回撤窗口，即可创建受限的
selection context，再继续向 Pi 提问。浏览器只提交 view ID、时间范围和可见 series keys；summary 由 daemon 校验
ownership 后根据 canonical resources 重新计算。

daemon 重启后，已完成的工作会保留，可用的 Raw Pi 与 Veil session 会在接受新命令前恢复。如果某个 task 当时仍在
运行，它会被明确记为 interrupted，用户需要重新执行；恢复流程绝不会把未完成的 task 猜成成功。

开发用 project 里还包含一个小型 `.veil/project.yaml`。daemon 会解析它的 root，通过已发布的 Veil API 加载项目，
然后只向 Web app 返回不含路径的 readiness summary。project path、dataset identifier、environment value 和 source
locator 始终留在 daemon 内。Veil session 遵循与 Raw Pi 相同的重启规则，在出现独立证据前仍显示为
**EXPLORATORY · UNVERIFIED**。

Web shell 已为 committed Raw view 提供 **Promote with Veil**。请求里只有 owned view ID、project-relative
artifact reference 和 hypothesis。daemon 会核对 artifact digest，创建新的 Veil session，记录 chronology，
通过 `veil-data` 读取注册 panel，并完整执行 contract、pricing、gate 与 Experiment 流程。Raw 图表里的 equity、
Sharpe 等展示指标不会被复制进请求，也不会被当作 expected result。

目前这里只有一个 deterministic adapter fixture，不是通用回测引擎，也不会连接模型服务。Raw view 始终保持
**EXPLORATORY · UNVERIFIED**。Accepted、degraded 或 rejected 只属于独立执行后的 Veil attempt；如果执行本身失败，
则不会产生任何 Experiment label。

完成的 Experiments 会进入一个有数量上限的 project index，因此页面刷新后可以直接重新打开最近的尝试，无需重放
模型对话。evidence drawer 展示经验证的 dataset 与 method identity、OOS metrics、cost model、gate outcomes、
limitations 和 content hashes，但不会把 artifact code、原始 pricing payload、snapshot content 或本地路径发到浏览器。
点击 **Reproduce Experiment** 会用 immutable snapshots 重新执行归档 artifact、pricing 和 gates。Matched reproduction
证明 identity 一致，并不会改写原来的 accepted、degraded 或 rejected verdict。

## 首个里程碑

第一个纵向切片，是把一个 deterministic daily-factor 示例完整走通：

1. 打开本地 project；
2. 创建 Raw Pi 或 Veil session；
3. 渲染 market、equity、drawdown、trades 和明确的 assurance——reference adapter 已实现；
4. 把图表中选中的区间交回 Pi——live offline fixture 已实现；
5. 创建新的 Veil verification attempt——minimal portable handoff 已实现；
6. 审阅 Experiment 并复现——bounded evidence 与 matched-identity replay 已实现。

L2/L3 数据、框架自动识别、自主巡航模式和多 agent pattern scanning 都明确不在这个里程碑内。

## License

MIT。
