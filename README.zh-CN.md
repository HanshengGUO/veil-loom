# Loom

[English](README.md)

**一个面向量化研究的 AI 原生工作台。**

> 左边和研究 Agent 协作，右边直接看可交互回测。框选图表上的任意一段，接着往下研究。

Loom 让量化研究员可以在同一个地方与 coding agent 协作，并真正看懂它做出的结果。Agent 可以检查本地项目、
写代码、调用工具、运行回测；Loom 则把结果变成可交互的研究画布，展示行情、买卖点、净值、回撤、指标和运行历史。

图上出现值得关注的地方时，直接框选，然后继续追问。Agent 会收到准确的时间范围和结构化摘要，下一步分析从你正在
看的内容出发，不需要截图，也不需要把时间戳手工复制到聊天框里。

## Loom 长什么样

```text
┌─ 研究 Agent ─────────────────────┬─ 研究画布 ─────────────────────────┐
│                                 │                                    │
│  你：测试一下这个因子           │  行情 + 买卖点                     │
│  Agent：正在修改和运行……        │  ─────▲────▼────────▲────────        │
│                                 │                                    │
│  工具与任务进度                  │  净值 + 回撤                        │
│  研究笔记                        │  ╱╲____╱╲______                      │
│  之前的运行记录                  │                                    │
│                                 │  指标与来源                         │
│  你：这里为什么会失效？      ◀──┤  [ 已框选的回撤区间 ]              │
│                                 │                                    │
└─────────────────────────────────┴────────────────────────────────────┘
```

对话和画布是同一次研究的两个视角。Agent 发布的回测会出现在画布上；画布中选中的区间，又会成为 Agent 下一轮分析
的上下文。

## 一次研究如何进行

Loom 围绕下面这套工作方式设计：

1. **从想法开始。** 让 Agent 检查数据、修改因子，或者测试一条策略。
2. **让 Agent 在项目里完成工作。** 代码修改、工具调用和回测都在本地环境执行。
3. **直接看结果，而不是翻日志。** Loom 把行情、成交、净值、回撤、指标和来源放进同一个同步视图。
4. **用图表做研究。** 缩放、平移、对照买卖点，或者框选最大回撤这样的特殊区间。
5. **针对眼前的现象继续问。** 选中的范围会作为准确、可复用的上下文回到对话中。
6. **持续迭代，不丢失过程。** 重启之后，session、task、view 和 selection 仍然可以继续使用。

这就是 Loom：让真正能动手工作的 Agent，与需要观察、质疑和引导研究的使用者之间，形成更紧密的反馈循环。

## 为什么需要 Loom

Coding agent 已经很擅长修改研究代码、运行命令，但终端 transcript 并不是理解策略的好界面。量化研究天然依赖视觉：
你需要把成交和行情对齐，看净值从哪里开始变形，检查回撤，也要比较不同市场阶段的表现。

现在，这些事情通常分散在聊天窗口、终端、Notebook、静态图表和回测报告里。每切换一次工具，就可能丢掉一部分
上下文。Loom 把它们重新放进一个连续的工作区，也让图表第一次成为人与 Agent 沟通研究问题的正式方式。

Loom 不是新的回测引擎。它希望建立在研究团队已经使用的工具和框架之上，由 backtest adapter 把不同系统的结果
转换成 Loom 能呈现的视觉模型。

## 体验 developer preview

当前 preview 使用仓库内的 daily-factor 项目和 Pi 的离线测试 provider，不需要模型账户、API key 或私有行情数据。

需要 Node.js 22.19 或更高版本：

```bash
git clone https://github.com/HanshengGUO/veil-loom.git
cd veil-loom
npm ci
```

在两个终端中分别启动 daemon 和 Web app：

```bash
npm run dev:daemon
```

```bash
npm run dev:web
```

请使用精确地址 `http://127.0.0.1:3000` 打开页面。

Demo 会打开一段已经完成的研究会话和真实的可交互回测视图。你可以查看彼此同步的图表，选择最大回撤区间，创建
selection，让 Pi 分析这一段，然后重启 daemon，看看之前的 session 如何恢复。

完整的体验步骤见[快速开始](docs/getting-started.zh-CN.md)和[研究工作流](docs/research-workflow.zh-CN.md)。

## 现在已经能做什么

当前 developer preview 包含：

- 双栏的对话与研究画布；
- 使用离线 provider 的真实 Pi programmatic session；
- 一个面向 daily-factor 示例的严格 adapter；
- 彼此同步的行情、成交、净值与回撤视图；
- 可以交回 Pi 继续分析的图表选区；
- durable session、task、view 与 restart recovery；
- 对已完成结果发起独立审查的可选流程。

目前还没有通用 project picker、真实模型 provider 配置、回测框架自动发现、桌面安装包、远程访问、L2/L3 可视化
或自主研究。当前纵向切片的目的，是先把交互方式做实，再逐步支持更多 adapter 和真实用户项目。

## 可选的验证扩展

如果某个结果值得额外检查，Loom 可以把它交给
[Veil](https://github.com/HanshengGUO/veil)，发起独立的验证与复现。这只是工作流的一项可选扩展，并不定义 Loom。
Loom 的核心产品始终是前面描述的可视化 Agent 研究工作台。

## 文档

- [快速开始](docs/getting-started.zh-CN.md)
- [研究工作流](docs/research-workflow.zh-CN.md)
- [核心概念](docs/core-concepts.zh-CN.md)
- [故障排查](docs/troubleshooting.zh-CN.md)
- [架构](docs/architecture.zh-CN.md)
- [协议](docs/protocol.zh-CN.md)
- [安全模型](docs/security.zh-CN.md)
- [贡献 backtest adapter](docs/contributing-adapters.zh-CN.md)
- [纯净环境验收](docs/clean-machine-acceptance.zh-CN.md)
- [贡献指南](CONTRIBUTING.zh-CN.md)、[安全问题报告](SECURITY.zh-CN.md)与[变更日志](CHANGELOG.zh-CN.md)

英文是默认文档语言。每一份文档的标题下方都有完整的简体中文版本入口。

## 开发

提交 pull request 前请运行仓库检查：

```bash
npm run check
```

发布前，或者改动涉及平台差异时，请运行 built-product acceptance：

```bash
npm run accept:clean-machine
```

CI 会在 Linux、macOS 和 Windows 上运行同一套验收。详细约定见
[纯净环境验收](docs/clean-machine-acceptance.zh-CN.md)。

## License

MIT。
