# 纯净环境验收

[English](clean-machine-acceptance.md)

Veil Loom 为 reference workflow 保留了一条面向发布的统一验收路径。它和 unit tests 是两回事：runner 会真正启动
production build，并且只通过公开 HTTP routes 与产品交互。

请在仓库根目录、Node 22.19 或更高版本中运行：

```bash
npm ci
npm run accept:clean-machine
```

`accept:clean-machine` 会先构建所有 workspaces，再启动 runner。CI 在 `npm run check` 阶段已经完成构建，因此矩阵使用
`npm run accept:clean-machine:built`，避免重复 build。

## 它证明了什么

runner 会分配空闲的 loopback ports，启动构建后的 Next.js app，并确认 product shell 可以访问。随后，它针对
committed daily-factor project 的临时副本启动 daemon，按顺序完成：

1. bootstrap 一个与 Origin 绑定的 daemon session，并确认 Veil project readiness；
2. 通过 Pi 的 offline faux provider 创建 Raw Pi session；
3. 发布 reference backtest view，读取 market、equity、drawdown 与 trade resources；
4. 根据 canonical resources 创建 full-range selection，再把 selection 交回 Pi；
5. 将 owned Raw view promote 到独立 Veil session，并等待真实 Experiment；
6. 重启 daemon，拒绝旧 browser cookie，再恢复两个 durable sessions；
7. 重新打开 project history 与经 archive 校验的 Experiment evidence；
8. 在新的 Raw task 中继续使用重启前创建的 selection；
9. reproduce Experiment，并要求 Experiment、pricing、gate 与 verdict 完全一致。

runner 还会检查：promotion 没有修改 Raw event log；重启保留了原 event prefix；reproduction 没有改变 archive verdict；
public evidence 不含 private path 或 archive payload；所有 committed fixture inputs 的 SHA-256 digest 均保持不变。

## 矩阵与边界

GitHub Actions 在 Ubuntu、macOS、Windows 的当前 Node 24 上运行 built-product acceptance。另有一条 Ubuntu Node 22
lane，在声明的最低 Node 系列上运行完整 lint、typecheck、test 与 build gate，但不会重复较长的纵向 smoke。

runner 不依赖 shell utilities、browser automation、provider network 或 external credentials。子服务只会收到一小组
allowlisted environment variables；无论成功失败，复制出来的 project/state 都会被删除。这条验收证明的是 committed
reference adapter 与本地进程边界，不代表 arbitrary user tools、third-party adapters、真实 model providers、desktop
packaging 或 remote access 已获得认证。
