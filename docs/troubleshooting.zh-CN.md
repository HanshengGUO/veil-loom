# 故障排查

[English](troubleshooting.md)

这份指南面向仓库内 committed developer-preview workflow。为让错误“消失”而削弱 Origin、cookie、path 或 evidence
checks，不属于解决方案。

## 安装失败

先确认 runtime：

```bash
node --version
npm --version
```

Veil Loom 需要 Node 22.19 或更高版本。请从公开 npm registry 安装，并保持 committed lockfile 不变：

```bash
npm ci --registry=https://registry.npmjs.org
```

如果错误指向陌生的 registry mirror，请检查用户或机器级 npm configuration。不要修改 package-lock URL，也不要把
private registry workaround 提交进仓库。

## 端口已被占用

开发 Web app 使用 `127.0.0.1:3000`，daemon 使用 `127.0.0.1:43120`。先停止占用对应端口的进程，再重启命令。
当前 developer preview 假定这两个默认值成对使用；只修改一侧，会破坏 configured Origin 或 daemon URL。

## 页面能打开，但显示“Connecting daemon”

确认 `npm run dev:daemon` 仍在运行，并输出了：

```text
Veil Loom daemon listening on http://127.0.0.1:43120 with the offline Pi fixture
```

请打开 `http://127.0.0.1:3000`，不要打开 `http://localhost:3000`。精确 Origin 是 daemon security check 的一部分。
会重写 Origin 的 browser extension 或 proxy 也可能导致拒绝。

daemon 重启后，旧 HttpOnly cookie 会按设计失效。Web client 通常会自动重新 bootstrap；如果浏览器曾休眠，或者保留
了失败的旧 connection，请手动刷新一次精确 loopback 页面。

## Veil readiness 是 invalid 或 unavailable

Readiness failure 不表示 research claim 被拒绝，只表示 Veil capability 或 project 无法加载。

对于 committed demo，请确认：

- 两条命令都从仓库根目录启动；
- `npm ci` 完成，且没有漏装 workspace dependencies；
- `examples/daily-factor/.veil/project.yaml` 仍存在；
- 已安装 `veil-quant` 仍在测试过的 `0.1.x` 系列；
- dependency 或 project 改动后已经重启 daemon。

public message 会刻意省略 private path。开发时请在受信任的 daemon diagnostics 中查看细节，不要把 raw filesystem
error 加进 browser response。

## Chart 一直没有出现

Raw demo task 必须先完成，浏览器才能加载 owned view。检查左侧 pane 是否有 failed/interrupted task，再查看 daemon
terminal 是否报告 startup failure。

要区分 stale state 与当前代码问题，请使用新的空 state directory 启动 daemon，不要先删除旧目录：

```bash
LOOM_STATE_DIR=/tmp/veil-loom-fresh-state npm run dev:daemon
```

Windows PowerShell：

```powershell
$env:LOOM_STATE_DIR = "$env:TEMP\veil-loom-fresh-state"
npm run dev:daemon
```

如果 clean state 可以运行，请保留原目录用于诊断。corrupt durable log 本来就应该 fail closed，而不是静默丢弃 events。

## Selection buttons 无法点击

**Create selection context** 需要已加载的 view 与非空 range。先在任一 chart 上拖动，或使用 maximum-drawdown shortcut。

**Ask Pi about selection** 需要已经成功创建 selection。如果创建失败，请清除 range，再选择对齐 chart observations 的
区间。daemon 会拒绝 view 外范围、mixed time units、unavailable series、cross-session ownership，以及超过 1,024
market points 的范围。

## “Promote with Veil”无法点击

以下条件必须同时成立：

- source session 是 Raw Pi 且处于 ready；
- owned view 已 durable publish；
- project readiness 为 `ready`；
- artifact reference 与 hypothesis 都非空；
- 当前没有打开的 promotion attempt。

默认 reference 是 `artifact/daily-factor.mjs`，它相对于 registered project，而不是 repository process 或 browser。
如果刷新后打开了一个已完成 attempt，请先点击 **New attempt** 再创建下一次尝试。

## Promotion 显示 execution failed

Execution failure 与 `rejected` Experiment 是两件事。前者表示 child artifact/runtime 没有产生可验证的成功结果，因此
Loom 不会签发 verdict。请在本地检查 trusted daemon diagnostics 与 artifact。不要把 failure 重新解释为 rejection，
也不要把 Raw metrics 作为 expected values 填进 request。

## 重启后 task 变成 interrupted

如果 `task.started` 已 durable，而关机前没有 terminal event，这是预期行为。Loom 会写入带 `DAEMON_RESTART` 的
`task.interrupted`，不会根据 Pi history 或 output file 猜测成功。请重新执行 action；已完成 task 与 event prefix 应
保持不变。

## Reproduction 没有显示 matched

matched reproduction 要求 archived Experiment、captured artifact、immutable snapshots、pricing、metrics 与 gate
identities 全部一致。Failure、cancellation、retention deletion 和 restart 都不会产生 match，也都不能改变原始 verdict。

## Windows 上完整检查很慢

Windows 会在 integration tests 与 built-product acceptance 中启动真实 child processes，因此通常比 Linux/macOS 慢。
开发时运行定向检查，交接前再跑一次完整 gate：

```bash
npm run check
npm run accept:clean-machine:built
```

只有 build 已成功时才直接使用 `accept:clean-machine:built`。独立运行应使用会先 build 的
`accept:clean-machine`。

## 报告 bug 之前

请提供 operating system、Node/npm versions、执行命令、public error code，以及新 state directory 能否复现。公开发布
前，请移除 provider keys、cookies、local paths、raw market data、private daemon diagnostics 与 archive contents。
安全问题请按照[安全说明](../SECURITY.zh-CN.md)，使用 GitHub private vulnerability reporting。
