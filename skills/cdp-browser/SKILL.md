---
name: cdp-browser
description: 使用 cdp_browser 工具或随包 agent-browser CLI 操作浏览器。适用于打开网页、读取内容、快照、点击、填表、截图、多步任务、登录态页面和错误恢复；重点是避免 args/job/qa/semanticAction/script/electron 的字段拼写与互斥错误，并正确使用页面引用 @eN、远程 CDP 端点和 CLI 直调。
---

# cdp-browser 使用技能

本技能解决两类高频问题：**参数形状写错**，以及**页面引用（`@eN`）失效后继续乱猜**。

开始前先做两个判断：

1. 走哪个入口：`cdp_browser` 工具，还是 `bash` 里的 `agent-browser`。
2. 走哪个输入模式：`args`、`job`、`qa`、`semanticAction`、`script`、`electron`。

---

## 一、先选入口

| 场景 | 入口 |
| --- | --- |
| 常规浏览、点击、填写、提取、截图 | `cdp_browser` 工具 |
| 需要结构化 `details`、`nextActions`、产物校验 | `cdp_browser` 工具 |
| 需要原始上游参数、管道、`jq`、循环、复现上游问题 | `bash` 执行 `agent-browser` |
| 一次调用完成多步线性流程 | `cdp_browser` 的 `job` 或 `batch` |
| 需要按角色/文本/标签定位 | `semanticAction`，或 `args` 里的 `find` |

工具会自动补充 `--json`、配置好的 `--cdp` 和受管会话；**CLI 直调不会**。

CLI 直调必须自己做三件事：

```bash
agent-browser --cdp http://127.0.0.1:9222 --session cli-debug open https://example.com
agent-browser --cdp http://127.0.0.1:9222 --session cli-debug snapshot -i
agent-browser --cdp http://127.0.0.1:9222 --session cli-debug close
```

- 显式传 `--cdp`；
- 用独立的 `--session`，避免与工具受管会话抢占同一页面；
- 完成后 `close`。

详细 CLI 说明见 [references/cli-direct-use.md](references/cli-direct-use.md) 和插件包内 `docs/AGENT_BROWSER_CLI.md`。

---

## 二、工具输入模式：只选一个

同一次调用只能出现一个模式字段。以下字段互斥：

```text
args | job | qa | semanticAction | script | electron | sourceLookup | networkSourceLookup
```

同时传两个会直接失败，例如 `args` + `job`。

### 2.1 `args`：最常用

`args` 是**二进制之后的 argv 数组**，不是一整条命令字符串。

正确：

```json
{ "args": ["open", "https://example.com"] }
{ "args": ["snapshot", "-i"] }
{ "args": ["click", "@e3"] }
{ "args": ["fill", "@e1", "user@example.com"] }
```

错误：

```json
{ "args": "open https://example.com" }
{ "args": ["agent-browser", "open", "https://example.com"] }
{ "args": ["open https://example.com"] }
{ "args": ["--json", "open", "https://example.com"] }
```

规则：

- 不要包含可执行文件名 `agent-browser`；
- 不要把多个 token 合成一个字符串；
- 不要传 `--json`，工具会注入；
- 全局参数放在命令前，如 `["--profile", "Default", "open", "..."]`；
- `eval --stdin` 的代码放顶层 `stdin`，不要塞进 `args`。

### 2.2 `job`：受限多步流程

```json
{
  "job": {
    "steps": [
      { "action": "open", "url": "https://example.com" },
      { "action": "assertText", "text": "Example Domain" },
      { "action": "fill", "selector": "#email", "text": "user@example.com" },
      { "action": "click", "selector": "#continue" },
      { "action": "assertUrl", "url": "**/next" },
      { "action": "screenshot", "path": "/tmp/step.png" }
    ]
  }
}
```

规则：

- `assertText` 只收 `text`，不写 `selector`；
- `assertUrl` 要能区分目标页，不要写成起始页；
- 点击/选择/提交可能导航，之后先断言再操作；
- 动态页面把长流程拆短，重新快照；
- 默认 `batch --bail`，`failFast: false` 只在后续步骤安全时使用。

### 2.3 `qa`：页面体检

```json
{ "qa": { "url": "https://example.com", "expectedText": "Example Domain", "screenshotPath": "/tmp/qa.png" } }
```

已连接会话用：

```json
{ "qa": { "attached": true, "expectedText": "Dashboard" } }
```

规则：

- 不要同时传 `stdin`；
- `qa.attached` 不接受 `sessionMode: "fresh"`；
- 控制台/网络检查是可选开关，默认不主动读旧缓冲；
- 失败时先看 `details.qaPreset` 与 `nextActions`，不要直接重跑。

### 2.4 `semanticAction`：按角色/文本/标签操作

```json
{ "semanticAction": { "action": "click", "locator": "role", "role": "button", "name": "Continue" } }
{ "semanticAction": { "action": "fill", "locator": "label", "value": "Email", "text": "user@example.com" } }
{ "semanticAction": { "action": "select", "selector": "#flavor", "value": "chocolate" } }
```

规则：

- `locator` 是 `role|text|label|placeholder|alt|title|testid`；
- 角色定位用 `role` + `name`，或 `value`；
- `fill` 必须有 `text`；
- 不提供 `uncheck`，用 `args` 的 `uncheck`；
- 需要命名会话时在对象内加 `"session": "<name>"`，不要加在顶层。

### 2.5 `script`：一次性编排

```json
{
  "script": "const a = await browser({ args: ['open', 'https://example.com'] }); emit({ ok: a.ok });"
}
```

规则：

- 仅用于循环、条件分支、多页聚合；
- 调 `await browser({ args, stdin?, timeoutMs? })`；
- 每个返回信封检查 `ok`；
- 用 `emit(value)` 输出一个 JSON 值；
- 脚本在隔离会话运行，不能直接访问宿主文件系统、网络或进程；
- 需要持久化 Pi 会话，`--no-session` 下不可用；
- 一次批准最多 25 次内部调用。

### 2.6 `electron`

```json
{ "electron": { "action": "list", "query": "code" } }
{ "electron": { "action": "launch", "appName": "Visual Studio Code" } }
{ "electron": { "action": "probe", "launchId": "<id>" } }
{ "electron": { "action": "cleanup", "launchId": "<id>" } }
```

规则：

- 只用于桌面 Electron 应用；
- 不接受 `stdin`；
- 启动后默认带快照交接；需要先看目标时用 `handoff: "tabs"` 或 `"connect"`；
- 用完必须 `cleanup`。

---

## 三、固定工作循环

```text
open → snapshot -i → 用最新 @eN 操作 → 页面变化后再 snapshot -i
```

必须重新快照的时机：

- 导航、前进、后退、刷新；
- 点击导致路由变化；
- 提交表单；
- 切换标签页；
- 展开/折叠、加载更多、无限滚动；
- 任何明显的重新渲染。

`@eN` 只在生成它的那次快照和那个页面上有效。**不要跨页面复用，不要凭记忆猜编号。**

需要稳定定位时优先：

```json
{ "args": ["find", "role", "button", "click", "--name", "Save"] }
```

而不是猜一个 CSS 选择器。

---

## 四、远程 CDP 边界

工具通过 CDP 控制浏览器：

- 端点 IP 不是 Pi 主机地址时，浏览器在远端；
- **不要**假设页面里的 `localhost`、文件路径、桌面窗口属于 Pi 主机；
- 代理和 SSH 隧道会让端点看起来像 `127.0.0.1`，但浏览器仍可能在远端；
- 需要浏览器侧文件时，先把内容通过页面能力传入，不要直接引用 Pi 本地路径；
- CDP 无认证，不要把端口暴露到不可信网络。

---

## 五、高频参数错误对照

| 现象 | 原因 | 正确写法 |
| --- | --- | --- |
| `args` 被当成字符串 | 写成了 `"open https://..."` | `"args": ["open", "https://..."]` |
| 找不到命令 | 把 `agent-browser` 放进了 `args` | 去掉可执行文件名 |
| JSON 解析失败或结果异常 | 手动传了 `--json` | 删除，工具会注入 |
| `stdin` 被拒绝 | 在 `electron` 或单命令模式用了 `stdin` | 只在 `batch`、`eval --stdin`、`auth save --password-stdin` 用 |
| `eval` 拿到 `{}` | 传了函数本身 | 调用它：`(() => ({ title: document.title }))()` |
| `eval` 报重复声明 | 顶层 `const` 跨调用保留 | 用 IIFE 包裹 |
| `fill` 没生效 | 框架控件只认真实按键 | 先聚焦，再 `keyboard type`，用 `get value` 验证 |
| `select` 没变化 | 点了 option ref | 用 `select <selector> <value>` |
| 点击成功但页面没动 | 被遮挡或事件未处理 | 检查 `details.overlayBlockers`，重新快照 |
| `stale-ref` | 页面变了，ref 过期 | 重新 `snapshot -i` |
| `No active page` | 没有活动标签页 | `tab list` → `tab <id>` → `snapshot -i` |
| 启动参数被忽略 | 会话已存在，启动参数只在新启动生效 | 用 `sessionMode: "fresh"` |
| `--session-mode` 无效 | 它不是上游参数 | 用顶层 `sessionMode` |
| 两个模式冲突 | 同时传了 `args` 和 `job` 等 | 每次只保留一个模式 |

更多错误见 [references/error-catalog.md](references/error-catalog.md)。

---

## 六、失败后的恢复顺序

1. 读可见错误和 `details.nextActions`。
2. 有 `stale-ref`：重新 `snapshot -i`，用新 ref。
3. 有 `selector-not-found`：用 `find` 的角色/文本/标签，或更具体的选择器。
4. 页面目标不明：`get url`，必要时 `tab list`。
5. 点击无效果：检查遮罩、`pageChangeSummary`、截图。
6. 超时：看 `details.timeoutPartialProgress`，不要盲目重放会改变状态的步骤。
7. 产物相关：看 `details.artifactVerification`，不要只看命令成功。

**不要**在未确认原因时连续重试同一个失败调用。

---

## 七、产物与安全

- 用户给了路径就严格使用该路径；
- 截图、下载、PDF、录像完成后验证文件存在；
- 录像需要 `ffmpeg`，`record start` 只是挂起状态；
- 关闭浏览器不删除已保存文件；
- 不要把 Cookie、Authorization、HAR、state 文件内容原样输出；
- 购买、生产控制、破坏性操作、账号/安全/隐私变更需要明确授权。

---

## 八、按需读取的资料

先读最小必要部分，不要一次加载整份命令手册。

| 需要 | 位置 |
| --- | --- |
| 工具字段完整说明 | [references/tool-parameters.md](references/tool-parameters.md) |
| CLI 直调用法 | [references/cli-direct-use.md](references/cli-direct-use.md) |
| 错误目录与修复 | [references/error-catalog.md](references/error-catalog.md) |
| 包内 CLI 详细文档 | `../../docs/AGENT_BROWSER_CLI.md` |
| 包内完整命令清单 | `../../docs/COMMAND_REFERENCE.md` |
| 结果字段契约 | `../../docs/TOOL_CONTRACT.md` |
| 上游版本匹配技能 | `cdp_browser` 调 `{ "args": ["skills", "get", "core", "--full"] }` 或 bash `agent-browser skills get core --full` |

上游内置技能：`core`、`electron`、`slack`、`dogfood`、`derive-client`、`webmcp-gen`、`vercel-sandbox`、`protected-vercel-deployments`、`agentcore`。

`skills` 子命令不需要浏览器，也不会占用受管会话。
