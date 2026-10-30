# opencode-gui 设计文档

> 日期：2026-10-25
> 状态：已确认（阶段 1a 视觉方案定稿；阶段 1b 待实施）
> 目标版本：opencode v2.1.4（Windows / amd64）

## 1. 背景与原因

官方 opencode 桌面版（Electron）的界面不满足使用需求。最具体的一条是：**推理过程、工具调用、最终答案三者的视觉权重几乎相同**，读一段回答时分不清哪里是"它在想"、哪里是"它在干活"、哪里是"它给我的结论"。工具调用卡片和正文混在一起，看着像同一段话。

这属于信息层级问题，不是皮肤问题。而官方 UI 的样式藏在编译产物里，插件机制也够不到渲染层，所以只能整体替换渲染层。

### 为什么必须保住官方后端

opencode 的模型请求由官方 `opencode-cli.exe` 进程发出。OpenCode Zen 的免费层会校验客户端身份，任何第三方 HTTP 客户端直接请求都会得到 `403 FreeTierError`。因此：

> **本项目不改 opencode 源码，只替换 UI 层。后端始终是官方二进制。**

这条是硬前提，优先级高于任何 UI 需求。

## 2. 目标

- **阶段 0（打通链路）**：Electron 壳负责发现/拉起官方后台服务，并直接加载官方 server 自带的 web UI。目标是验证"双击启动 → 后端起来 → 认证通过 → 界面能出"这条链路，零 UI 代码。
- **阶段 1a（视觉原型，已完成）**：用静态 HTML 验证"思考 / 工具调用 / 答案"的三级层次，确定视觉语言。产物在 `docs/mockups/`。
- **阶段 1b（自建渲染层）**：用 SolidJS 重写渲染层，接入 `@opencode/client` 与 `@opencode/ui`，落地 1a 的视觉方案，并补齐输入、发送、中断、权限回复、会话创建等交互，成为可日常使用的客户端。
- **阶段 2（按需演进）**：多会话、diff 视图、成本统计等，由实际使用中的痛点驱动，不预先排期。

三个阶段之间，Electron 主进程代码几乎不变，换的只是渲染层。

## 3. 非目标

- 不 fork 或重新编译 opencode server
- 不做 TUI / CLI 前端
- 不自建 OS 级沙箱（opencode 本身没有，前端也做不了）
- 阶段 0 不追求任何视觉改动
- 阶段 1 不复制官方 `packages/app` 的全部功能（导入导出、voice、pairing 等都不做）

## 4. 反目标（怎样算失败）

- 为了 UI 灵活而绕开官方 server，导致免费模型不可用 —— 这是最严重的失败
- 把服务口令写进任何持久化文件、日志或截图
- 渲染层直接读文件系统或持有 Node 能力，破坏 Electron 安全模型
- 阶段 0 的临时方案（加载官方 web UI）被误当作最终形态长期保留却不更换
- **退出时误停别人启动的服务**（例如用户同时开着官方桌面版）
- 用 `taskkill /IM opencode-cli.exe` 这类按镜像名终止的方式停服务

## 5. 约束

| 项 | 值 |
|---|---|
| 平台 | Windows（本机），不考虑跨平台 |
| 主题 | **浅色为主**，暗色保留但次要；新组件先满足浅色 |
| opencode | v2.1.4，`C:\Users\gf09\AppData\Local\Programs\@opencode-aidesktop\resources\opencode-cli.exe` |
| 服务发现 | `%USERPROFILE%\.local\state\opencode\service.json` |
| Node | v24.15.0 |
| Electron 运行时 | **必须在工作区外**：放在 `D:\Z_UserZYH\opencode-runtime`，`node_modules/electron/dist` 是指向它的目录联接（junction）。工作区内的文件带 Low 完整性标签，Electron 从工作区内启动会以 `0xc0000005` 崩溃 |
| 启动环境 | 启动前必须清除 `ELECTRON_RUN_AS_NODE`（本机环境里有，会让 Electron 退化成纯 Node） |
| 凭证 | Basic auth，username `opencode`，password 在 `service.json`，**每次重启都变** |

## 6. 已确定的架构

```
Electron main
  ├─ Service.ensure() / Service.discover()   ← 发现或拉起后台服务
  ├─ 持有 { baseUrl, auth }                  ← 凭证只在主进程与 preload 中
  └─ 创建 BrowserWindow
        ├─ 阶段 0：loadURL(serverUrl) + 注入 Authorization
        └─ 阶段 1：loadFile(renderer) + preload 暴露 { baseUrl, headers }

renderer
  ├─ contextIsolation: true, nodeIntegration: false
  └─ 阶段 1：SolidJS + @opencode/client/solid
```

### 关键决策

1. **用 `@opencode/client/service` 而非自己 spawn 进程**。它提供 `discover()`（只查不启动）与 `ensure()`（没有就启动），正好匹配"像桌面版一样双击即用"的体验。注意默认命令是 `opencode serve --service`，但本机 PATH 里没有 `opencode`，必须显式传 `command`。
2. **凭证通过 preload 交给 renderer，而不是让 renderer 自己拿**。浏览器环境读不到 `service.json`，这是"纯静态前端方案不成立"的唯一原因。
3. **阶段 0 加载 server 自带 web UI**，因为它是同一份 SPA、浏览器可运行、不依赖 Electron 私有协议，是验证链路成本最低的方式。
4. **生命周期由本应用接管（替代模式）**：应用启动时发现或拉起服务，退出时停止——但**只停自己启动的**。官方桌面版不再作为运行依赖，只在缺少二进制时作为可选的来源。

## 7. 阶段 0：打通链路

### 启动流程

1. 主进程启动，调用 `Service.discover()` 先看有没有已在运行的服务。
   - **已有服务**：直接复用，并记录 `owned = false`（不是我们启动的，退出时不停）
   - **没有服务**：调用 `Service.ensure()` 启动一个，记录 `owned = true`

   ```ts
   const endpoint = await Service.ensure({
     command: [OPCODE_CLI_PATH, 'serve', '--service'],
   })
   ```

   - `OPCODE_CLI_PATH` 的解析顺序：设置项 → 项目内自带的二进制（未来） → PATH 中的 `opencode` → 官方桌面版 resources 目录 → 报错并提示用户指定。
2. 用 `Service.headers(endpoint)` 生成认证头。
3. 创建 `BrowserWindow`，加载 `endpoint.url`，并通过 session 的 `webRequest.onBeforeSendHeaders` 为该 URL 前缀的所有请求注入 `Authorization`。

   选择 `onBeforeSendHeaders` 而不是 `loadURL(extraHeaders)` 的原因：后者只作用于主文档，SPA 后续的 fetch 与 SSE 不会带上认证头。

4. 窗口加载完成即视为阶段 0 成功。

### 生命周期所有权

**应用退出时，只停止由自己启动的服务**（`owned = true`）。

- 如果是复用了别人的服务（例如官方桌面版先开着），退出时不停，避免误伤
- 停服务用 `Service.stop()`，或按 `service.json` 里的 pid 定向终止；不使用 `taskkill /IM` 这类按镜像名杀的粗暴方式（会连带杀掉别的实例）
- 正常退出、崩溃退出都要处理：崩溃时下一次启动靠 `discover()` 判断服务是否还活着

### 版本策略

`service.json` 里的 `version` 与二进制文件版本可能不一致（本机实测：exe `FileVersion 1.4.4`，`service.json` 写 `2.1.4`）。所以：

- 以 **服务上报的 `/api/info` 版本**为准，不以文件名或 `service.json` 为准
- 启动时校验主版本为 `2.x`；不满足则弹窗提示，不静默继续
- 发现的服务版本与预期不符时，选择"复用但警告"，不强行重启（重启会打断别的客户端）

### 验收标准

- 冷启动（没有后台服务在跑）时，应用能自行拉起服务并显示界面
- 热启动（桌面版或上次的服务还在跑）时，复用而不重复启动
- **应用退出后，由它启动的服务已停止**（通过 `service.json` 的 pid 已不存在来验证）
- **如果服务是别人启动的，退出后它仍然存在**
- 界面内的会话列表、消息发送、工具调用卡片均正常（即官方 web UI 的完整功能）

### 阶段 0 明确不做

- 不隐藏/改造任何官方 UI
- 不处理窗口自定义（标题栏、菜单）
- 不做自动更新、托盘

## 8. 阶段 1：自建渲染层

### 技术栈（已定）

- **SolidJS**：官方 UI 与 client 绑定都是 Solid，选 React 等于放弃现成的 `@opencode/ui` 与 `@opencode/client/solid`
- **`@opencode/client@2.1.4`**：HTTP 客户端 + 事件流，浏览器可用
- **`@opencode/ui@2.1.4`**：官方组件库（button、dialog、accordion、tabs、segmented-control、diff-changes 等）+ 设计令牌
- **构建**：优先 `electron-vite`；包管理优先 pnpm（待确认，见第 11 节）

### 视觉层次：本阶段的核心（1a 已定稿）

目标是把三类内容做成三个明确的层级。三者使用**不同的视觉形式**，避免"都有容器"导致再次混淆：

| 层级 | 视觉形式 | 具体规范 |
|---|---|---|
| 推理 | **一根线** | 左侧 2px 竖线，字号 13px，颜色降一档，默认折叠成一行「思考了 N 秒」 |
| 工具调用 | **一个框** | 透明背景 + 1px 边框 + 10px 圆角，状态点（绿=成功 / 红=失败 / 蓝=运行中），默认折叠成单行（图标 + 工具名 + 参数摘要 + 状态） |
| 答案 | **一块底** | 纯白气泡 + 16px 圆角 + 双层阴影，无边框 |

浅色主题色值（已定稿，项目默认主题）：

- 页面背景 `#f7f7f9`
- 答案气泡 `#ffffff`，阴影 `0 1px 2px rgba(20,20,30,.06), 0 6px 20px rgba(20,20,30,.06)`
- 工具卡片背景透明，边框 `#e5e5ea`
- 推理文字 `#5f5f68`，竖线 `#d4d4da`

主题策略：**浅色为主，暗色保留但次要**。所有新组件先满足浅色，暗色可后补。

判定标准：**一段包含十次工具调用的回答，滚动时视线应能立刻找到答案气泡的起点。**

已验证产物：`docs/mockups/phase1a-visual.html`（可交互原型）、`docs/mockups/compare.png`（官方现状 vs 新方案对比）。

### 组件边界（初稿）

- `SessionView`：消息列表 + 滚动锚定
- `MessageBlock`：按 message part 类型分派
- `ReasoningBlock`：折叠/展开、耗时
- `ToolCallCard`：状态机（pending / running / done / error）、参数与输出折叠
- `AnswerBlock`：markdown 渲染、代码块高亮
- `PermissionDialog`、`FormDialog`：必须实现的交互回路

### 事件与状态

- 事件流用 `client.event.subscribe()`（async iterable），不手写 SSE 解析
- 必须处理重连：官方明确 SSE 会导致消费者断流、断线期间事件丢失；重连后需重新拉取消息历史补齐状态
- `permission` / `form` 的请求来源（事件流 vs 轮询全局端点）开工第一步实测确认

### 凭证、恢复与目录（默认方案）

- **渲染层持有** `{ baseUrl, headers }`，由 preload 注入；渲染层不接触文件系统
- 渲染模型输出时**禁用 raw HTML**，并设 CSP，避免注入脚本读取凭证后调用本地 API
- **服务重启恢复**：检测 401 或 SSE 断开 → 主进程重新 `discover()` → 通知渲染层重连并重拉历史；不做"重启应用"的兜底
- **项目目录**：启动时用系统目录选择器 + 最近列表；不读官方桌面版的项目数据（避免耦合）

## 9. 已查证的技术事实

| 项 | 结论 |
|---|---|
| CORS | localhost / 127.0.0.1 任意端口回显放行，外部域名不放行 |
| 认证 | 无凭证 `GET /api/info` → 401；Basic auth → 200 |
| SSE | `GET /api/event`，需 Authorization 头，`server.connected` 正常 |
| 凭证 | 只在 `service.json`，浏览器无法读取 |
| `@opencode/client` | 2.1.4 已发布，主入口 browser-compatible，含 `./solid`、`./service` |
| `@opencode/ui` | 2.1.4 已发布，Solid 组件库（MIT） |
| `@opencode/session-ui`、`@opencode/app` | 未发布，会话渲染层需自写 |
| 官方 asar renderer | rolldown 产物 + 私有 `bootstrap` 协议，不可当源码复用 |
| 服务自带 web UI | `GET /` 返回完整 SPA，可直接加载 |

## 10. 风险与未验证项

| 风险 | 说明 | 处理 |
|---|---|---|
| `serve --service` 行为未实测 | 不知道它是"发现已有服务"还是"强制新起"；错误地并发启动可能覆盖 `service.json`，打断正在运行的桌面版 | 开工前在停掉桌面版的环境里验证，绝不能在桌面版运行时乱试 |
| 桌面版退出是否停服务 | 影响阶段 0 的冷/热启动判断 | 同上，实测 |
| 官方 API 漂移 | v2 API 标注 experimental，2.1.2→2.1.3 已从 119→121 paths | 锁定版本，升级时重跑验证 |
| SSE 有损 | 慢消费者断流、断线丢事件 | 重连 + 状态重拉 |
| 端口/口令每次变 | 硬编码必然连不上 | 每次启动重新读 service.json |
| **后端归属未最终确认** | 已定：**替代模式**，本应用管理生命周期 | 退出时只停自己启动的服务，见 §7「生命周期所有权」 |
| `ELECTRON_RUN_AS_NODE=1` | 环境里已设置，会让 Electron 退化成 Node，报 `Cannot read properties of undefined (reading 'whenReady')` | 启动脚本里显式清除 |
| 工作区 Low 完整性标签 | 工作区内的 exe 启动即 `0xc0000005` 崩溃，且 `icacls` 改不动 | 运行时放工作区外，用 junction 指向 |

## 11. 留给 builder 的决定

- 包管理器：pnpm 还是 npm
- Electron 构建工具：electron-vite / electron-forge / 手写 Vite 配置
- 目录结构：`src/main`、`src/preload`、`src/renderer` 的具体划分
- 阶段 1 的 markdown 渲染方案（用官方 `@opencode/ui` 里的能力，还是自带 marked + 高亮）
- 窗口外观：是否自定义标题栏

## 附：本机可用路径

```
opencode-cli.exe: C:\Users\gf09\AppData\Local\Programs\@opencode-aidesktop\resources\opencode-cli.exe
service.json:     %USERPROFILE%\.local\state\opencode\service.json
工作区:            D:\Z_UserZYH\Projects\opencode-gui
```
