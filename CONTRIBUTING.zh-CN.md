# 参与贡献

[English](CONTRIBUTING.md)

Veil Loom 仍处于 pre-alpha 阶段。只要不破坏进程边界与可信度边界，我们很欢迎范围清楚、容易审阅的小改动。

## 本地准备

请使用 Node 22.19 或更高版本。

```bash
npm install
npm run check
```

机械性的格式调整请交给 `npm run lint:fix`。公开代码、schema、错误信息、issue 和 pull request 统一使用英语；
中文只出现在对应的 `.zh-CN.md` 文档中。修改公开文档时，请在同一个 pull request 里同步更新英文原文和中文版本，
尤其不要让命令、协议字段或安全边界在两个版本中产生不同含义。英文文件仍是默认入口与 canonical source。

## 必须守住的边界

- Web app 不得 import Pi、Veil、filesystem 或 process API。
- 本地权限归 daemon 所有；daemon 只发布经过校验和脱敏的 protocol events。
- 新增 daemon route 默认必须鉴权，并补上 wrong-Origin 与 missing-cookie 测试。
- Raw Pi output 永远是 exploratory。
- Accepted、degraded、rejected assurance 只能从经过验证的 Veil evidence 派生。
- 新增 backtest adapter 时，必须同时提供 deterministic fixture 与 failure tests。
- 浏览器提交的 selection metrics 不可信；summary 必须由 daemon 根据 owned resources 计算，并保持有界。
- 升级 Pi SDK 后，`npm audit` 必须继续保持干净，public event redaction tests 也必须通过。

提交 pull request 前，请说明这个改动触及了哪条边界，以及是否改变了文档或 protocol compatibility。
