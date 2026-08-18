# 快速开始

[English](getting-started.md)

Veil Loom 目前还是 developer preview，并不是已经打包好的桌面应用，也没有发布 npm CLI。现阶段支持的首次体验，是
仓库里那条 deterministic daily-factor workflow。整个过程在本地运行，使用 Pi 的 offline faux provider，不需要任何
模型 API key。

## 开始之前

请准备：

- Git；
- Node.js 22.19 或更高版本；
- npm 11，或兼容 Node 版本自带的 npm；
- 两个终端窗口；
- 能打开精确 loopback 地址的浏览器。

安装前先确认 runtime：

```bash
node --version
npm --version
```

## 安装仓库

```bash
git clone https://github.com/HanshengGUO/veil-loom.git
cd veil-loom
npm ci
```

想严格复现仓库测试过的 dependency tree，请使用 `npm ci`。只有在确实要调整依赖或更新 lockfile 时，才使用
`npm install`。

准备提交 pull request 前，贡献者应运行完整 gate：

```bash
npm run check
```

完整 gate 包含 formatting checks、TypeScript、tests 和 production builds。在 Windows 上可能需要几分钟；只改文档时
不必每写几行就重复运行。

## 启动 developer preview

在仓库根目录打开第一个终端，启动 daemon：

```bash
npm run dev:daemon
```

这条命令会先构建共享 protocol package，再于 `http://127.0.0.1:43120` 启动本地 daemon，注册 committed
daily-factor project，并通过 offline provider 创建一个 idempotent Raw Pi demo session。

在第二个终端启动 Web app：

```bash
npm run dev:web
```

请打开这个精确地址：

```text
http://127.0.0.1:3000
```

不要把 `127.0.0.1` 换成 `localhost`。daemon 会刻意校验精确 browser Origin；在这条安全边界上，两者不是同一个
地址。

## 正常的首次运行是什么样

页面连接成功后，你应该看到：

- header 中的 **Offline Pi fixture** 与 **Daemon live**；
- 类似 **Veil 0.1.0 ready** 的无路径提示；
- 已恢复的 `raw-pi` session，以及完成的 reference-backtest tool call；
- 真实 market、net-equity、drawdown、trade、metric 和 provenance views；
- source chart 下方的 **EXPLORATORY · UNVERIFIED**；
- Raw view 与 readiness checks 完成后，可用的 **Promote with Veil** panel。

demo session 在浏览器连接前就已经创建，因此 profile selector 会展示可用 profiles，但当前 session 的选择已经冻结。
Promotion 会创建新的 Veil session，不会修改 Raw session。

接着阅读[研究工作流](research-workflow.zh-CN.md)，完成 chart selection、向 Pi 提问、promote artifact、审阅
Experiment 和 reproduction。

## 使用隔离的 state directory

Loom 默认把 durable state 存在各平台标准的 per-user application-state directory。若只是临时体验或照文档演示，
可以在启动 daemon 前指定一个全新的目录。

macOS 或 Linux：

```bash
LOOM_STATE_DIR=/tmp/veil-loom-walkthrough npm run dev:daemon
```

Windows PowerShell：

```powershell
$env:LOOM_STATE_DIR = "$env:TEMP\veil-loom-walkthrough"
npm run dev:daemon
```

用同一目录重启，可以观察 session recovery；改用另一个空目录，则会得到互不干扰的新历史。已有 state directory 应
当作用户数据看待，不要为了绕过无关的启动问题就随手删除。

## 运行面向发布的 smoke

修改了平台相关代码或准备发布时，请运行：

```bash
npm run accept:clean-machine
```

它会构建 production app 与 daemon，把 reference project 复制到临时空间，再通过 HTTP 驱动完整 public workflow，
结束后清理临时 project 和 state。精确验收 contract 见[纯净环境验收](clean-machine-acceptance.zh-CN.md)。

## 当前范围

这个 preview 只演示一个 committed adapter 与一份 public fixture。它还没有通用 project picker、真实 provider
credential UI、任意框架自动发现、打包桌面应用或 remote access。想接入其他 backtest format，请从
[贡献 backtest adapter](contributing-adapters.zh-CN.md)开始，不要让浏览器直接读取本地文件。

使用结束后，在两个终端中按 `Ctrl+C` 停止开发进程。如果首次运行与上面描述不符，请查看
[故障排查](troubleshooting.zh-CN.md)。
