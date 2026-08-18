# 安全模型

[English](security.md)

Veil Loom 采用 local-first 设计，但 localhost 本身并不是 authentication boundary。Web app 与 daemon 绑定到
`127.0.0.1`，daemon 还会同时检查严格 Origin 与 process-scoped session credential。我们不支持 remote binding，
也不支持用户自行配置 network proxy。

## 浏览器 handshake

daemon 启动时生成 256-bit random token，不把它写入 log 或 API body。只有配置中指定的 Web Origin 可以调用
`POST /v0/auth/bootstrap`；包括 `null` 在内的其他 Origin 都不能 bootstrap。response 把 token 设为 host-only
session cookie，并使用以下属性：

- `HttpOnly`：browser JavaScript 无法读取；
- `SameSite=Strict`：cross-site request 不会携带；
- `Path=/v0`：只用于 daemon API path；
- 不设置 `Max-Age` 或 `Expires`：daemon 不要求浏览器持久保存。

acknowledgement 只有 `{ "format": "loom.auth.v0", "status": "ready" }`。原生 EventSource 无法设置 Authorization
header，因此会以 credentials enabled 方式连接。token 绝不会进入 query string、URL fragment、local storage、
browser history 或 Referer header。

v0 transport 是 loopback 上的 plain HTTP，所以 cookie 不会虚假声明 `Secure` attribute。HTTPS 或任何 non-loopback
transport 都需要单独设计并使用 Secure cookie；目前不属于受支持配置。

## Request checks

health route 无需 credential，方便本地 process supervision。其他 browser route 都要求精确 configured Origin 与有效
session cookie。CORS response 只 echo 该 Origin、允许 credentials，永远不使用 wildcard。daemon 重启会轮换 token，
使旧 cookie 失效；Web client 必须重新 bootstrap，之后才能从原 event cursor 重连。

这些控制用来阻止无关网站访问用户的 loopback daemon。它们不试图防御已经以同一个操作系统用户身份运行的恶意进程。

## 受保护的值

浏览器不得收到：

- provider credentials 或未受限制的 environment values；
- absolute private data roots；
- arbitrary host file paths；
- private child-process diagnostics；
- 未经显式 bounded view 授权的 raw data；
- 把 evidence 标记为 verified 的 authority。

session log 只接受版本化、JSON-safe event envelope。public API failure 使用稳定 error code，不返回 storage path 或
private filesystem diagnostic。

Project root 属于 daemon configuration，不是 request data。daemon 启动时把 portable project ID 绑定到一个 canonical、
非 filesystem root 的目录。浏览器可以查询该 ID 的 readiness，但不能提交、替换或 traverse host path。public summary
只含经过测试的 Veil version、formats、capabilities 与 aggregate counts。Veil 公开 diagnostic 在 Loom boundary 会
再次限制长度并移除 registered root，之后才可能到达浏览器。

已安装的 `veil-quant` package 是受信任 daemon code，以当前用户权限运行；装了它并不等于有 sandbox。Loom 在加载前
检查固定 minor range 与公开 API shape。不兼容 runtime 或无效 project 会使 Veil profile unavailable，但 Raw Pi 仍可
使用。Capability readiness 绝不会授予 verified assurance。

Promotion 不会把浏览器变成 filesystem 或 evidence authority。request 只接受 owned view ID、一个 normalized
project-relative artifact reference 和有长度上限的 hypothesis。daemon 在 registered canonical root 内解析文件；只有
最终 canonical path 仍在该 root 内才允许跟随，并限制为 1 MiB，随后用 bytes hash 核对 source view，再创建 target
session。浏览器不能选择 dataset、Veil request file、protocol、cost model、gates、expected result 或 assurance。
所选文件必须是 regular file，不能是 symlink。

生成的 promotion request 位于已经验证过的 project `.veil` directory，使用 daemon-generated、exclusive attempt
filename。内容只包括新的 Veil read-set ID 和 daemon-owned adapter recipe，不含 Raw chart metrics。写入 request 前，
所选 artifact 会再次计算 hash。Veil 在 framed child artifact runtime 中执行它；Loom 只接收 public tool result，不
echo child path 或 stderr。Process framing 不是 OS sandbox。

source Raw log 不会被修改。独立 Veil session 拥有私有 hypothesis/data/run ledger 与 public task events。只有 Veil
公开 archive loader 验证 Experiment，并且其中 hash 与 tool result 一致后，Loom 才接受 non-exploratory assurance。
child failure、malformed archive、cancellation 或 interrupted task 都不会暴露 rejected/accepted state。public event
只携带 portable artifact/evidence identity，不含 project root 或 archive path。

Experiment review 仍是一条 projection boundary。project index 只含 durable portable identities。打开 Experiment 时，
daemon 重新加载并验证 archive，再返回有大小限制的 summary，其中包括 method/data identities、aggregate metrics、
gate reason codes、limitations 与 hashes。浏览器永远不会收到 captured artifact code、raw Arrow/pricing series、
snapshot contents、archive references 或 project root。

reproduction request 只有 owned session 与 Experiment identities。浏览器不能提供 expected metrics、desired verdict、
snapshot paths、code、pricing settings 或 gates。Veil 在 daemon 现有本地权限内重放 archive；只有所有返回 identity
通过验证时，Loom 才发布 `matched`。Error、cancellation、retention deletion 与 restart 都不产生 match。Reproduction
确认的是一致性，没有权限修改 Experiment 原始 verdict。

clean-machine acceptance runner 使用显式 environment allowlist 启动 production services。它只携带启动 Node 所需的
operating-system variables，以及 loopback、project、temporary-state configuration；provider keys 与无关 CI secrets
不会传给 daemon 或 Web process。runner 只操作 copied public fixture，运行结束后核对 copy 的 committed input hashes，
并在 `finally` 中删除隔离 project 与 state。这是 reference workflow 的 acceptance boundary，不是 OS sandbox，也不
表示 arbitrary user tools 已被隔离。

Pi event stream 是 internal input，不是 public passthrough。Loom 发布 visible assistant text 与 coarse lifecycle facts，
但会丢弃 thinking blocks、tool arguments、tool result bodies 和 provider error messages。committed CI/development
provider 是 Pi in-memory faux provider，关闭了 network refresh；它唯一的 Loom reference tool 没有 filesystem、shell
或 network access。

Pi conversation file 属于 private daemon state，不是第二套 public source of truth。daemon 重启后，必须先核对保存的
Loom ownership marker 与精确 public runtime fingerprint，才会使用该文件。Pi transcript 可以恢复 conversation
context，但只有 append-only Loom log 能宣布 task completion。任何缺少 durable terminal event 的 Loom task 都会变成
`task.interrupted`。没有 Pi file 的 legacy session 只能根据最近的 public user messages 与 completed assistant text
重建；tool data、deltas、diagnostics 与 raw series 一律排除。

reference tool 不会把任意 model/tool JSON 当作 chart data。它只调用一个显式 adapter；adapter 在任何 resource 可见
以前验证完整 import 与 size limits。session log 只记录最终 view descriptor。series 存放在 immutable
content-addressed records 中，读取时必须匹配 descriptor 的 project、session、view 与 blob association。浏览器在
渲染前会再次验证每个 record。committed market fixture 刻意使用公开数据；private project data 仍留在浏览器之外，
直到未来有单独授权的 bounded-view design。

Chart selection 不会扩大这条 view boundary。浏览器不能提交 selection metrics 或 agent context，只能提交 owned
view ID、精确 time range 与 visible series keys。daemon 重载 canonical blobs，把范围限制在 1,024 observations 内，
计算 summary，并先写入 owned session log，之后才能在 prompt 中使用。Pi 通过 selection command 只获得 bounded
summary 与 portable view reference，不获得 raw series。Forged、out-of-range、mixed-unit、unavailable-series 与
cross-session selection 都会 fail closed。

## 非目标

首个版本不防御蓄意恶意的本地用户、dependency 或 project configuration，也不提供 operating-system sandbox。
Pi tools、Veil tools 和 user backtests 都以当前用户权限运行。选择 project-relative artifact 不等于 OS sandbox，
也不代表我们审查了代码意图。Remote daemon binding 与 multi-user access 均不受支持。
