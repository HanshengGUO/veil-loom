# 安全说明

[English](SECURITY.md)

## 报告安全问题

请使用本仓库 **Security** 页面中的 GitHub private vulnerability reporting。对于可被利用的漏洞，请不要提交公开 issue。

## 当前安全边界

Veil Loom 是一个本地应用，会访问用户明确授权的 project 与本地进程。daemon 默认只监听 loopback。浏览器属于不可信的
展示层，不应收到 provider credentials、原始 environment values、无限制路径或 evidence authority。

Pi 的普通 shell 以当前用户权限执行。pre-alpha 版本既没有容器，也没有操作系统级 sandbox。请勿把 daemon 暴露给
其他主机。

第一个安全实现里程碑覆盖：loopback binding、启动鉴权、严格 Origin checks、project path 与 symlink boundaries、
child environment allowlisting、output limits 和 event-payload redaction。
