# 会话中断（Stop）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当前会话运行中时，把发送键变成停止键，点击可中断这一轮执行，并在消息流末尾留下可见标记。

**Architecture:** 运行状态按 `sessionID` 维护成一张表：启动时用 `session.active()` 初始化，之后由 `session.status` / `session.idle` / `execution.*` 事件增删，发送时乐观置忙。中断直接调用 `session.interrupt({ sessionID })`，成功后刷新消息并写入一条本地提示。

**Tech Stack:** SolidJS、@opencode/client、Electron、TypeScript。

**Spec:** 本会话确认的短设计（发送键变停止键、保留已生成内容、消息流末尾「已中断」标记）。

## Global Constraints

- 只改渲染层 `src/renderer/src/App.tsx` 与 `src/renderer/src/styles.css`，主进程与 opencode 源码不动
- 不引入新依赖，不新建测试框架
- 注释用中文、短语式、不加句号
- 视觉沿用现有浅色主题变量：背景 `#f7f7f9`、强调 `--accent`、错误 `--error`、次要文字 `--faint`

## Review Focus

- 后台会话完成时状态不能被“只处理当前会话”的过滤吃掉
- 中断请求失败时按钮不能卡在「停止中…」
- `session.active()` 不可用或失败时不能影响应用启动
- 切换会话后「已中断」标记不能残留到别的会话
- 运行中仍允许 Enter 发送排队消息，不能误变成停止

---

### Task 1: 按会话跟踪运行状态

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces:
  - `running(): Record<string, true>` —— 正在运行的会话表
  - `isRunning(): boolean` —— 当前会话是否在运行
  - `setSessionRunning(sessionID: string, on: boolean): void`
  - `handleRunningEvent(type: string, data: any): boolean` —— 命中状态事件返回 `true`
  - `refreshActiveSessions(): Promise<void>` —— 用 `session.active()` 做初始同步

- [ ] **Step 1: 加状态与辅助函数**

在 `App` 顶部 signal 区加 `const [running, setRunning] = createSignal<Record<string, true>>({})`，并实现 `setSessionRunning`、`handleRunningEvent`、`refreshActiveSessions` 三个函数。

`handleRunningEvent` 规则：
- `session.status`：`idle` 删除，`busy` / `retry` 置忙
- `session.idle`：删除
- `session.execution.started`：置忙
- `session.execution.succeeded` / `failed` / `interrupted`：删除
- 其余返回 `false`

- [ ] **Step 2: 启动时同步一次**

`onMount` 中在拿到会话列表后调用 `await refreshActiveSessions()`；接口不存在或失败时静默忽略。

- [ ] **Step 3: 事件里优先处理状态**

`subscribe()` 的循环开头先调 `handleRunningEvent(type, data)`；命中则按当前会话决定是否 `scheduleReload()`，然后 `continue`，放在「只处理当前会话」过滤之前。

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无报错

- [ ] **Step 5: 提交**

按用户确认的 message 提交（本会话不自动提交）。

---

### Task 2: 发送键切换为停止键

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: Task 1 的 `isRunning()`、`setSessionRunning`
- Produces: `interrupt(): Promise<void>`

- [ ] **Step 1: 实现 `interrupt()`**

取 `activeId()`，调 `client.session.interrupt({ sessionID })`；返回 `interrupted` 为真时清除运行态、写「已中断」、`refreshMessages()`。请求期间 `interrupting()` 为真，失败走 `errorText`，`finally` 复位。

- [ ] **Step 2: 发送时乐观置忙**

`send()` 在 `prompt` 成功后 `setSessionRunning(id, true)`，并清掉旧的「已中断」标记；`catch` 里清除运行态并恢复输入。

- [ ] **Step 3: 按钮切换**

发送按钮改为：运行中显示「停止」，加 `stop` 类，点击调 `interrupt()`；请求期间文案「停止中…」并禁用。非运行态维持现有「发送 / 发送中…」与禁用逻辑。

- [ ] **Step 4: 样式**

`.send.stop` 背景用 `var(--error)`；`:disabled` 继续沿用现有透明度。

- [ ] **Step 5: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无报错

---

### Task 3: 中断标记

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Produces: `interruptNotice(): string | null`

- [ ] **Step 1: 加标记状态**

`const [interruptNotice, setInterruptNotice] = createSignal<string | null>(null)`。`openSession()` 切换会话时清空。

- [ ] **Step 2: 渲染标记**

消息列表末尾（`For` 之后）加 `<Show when={interruptNotice()}>`，输出 `<div class="interrupted-note">`。

- [ ] **Step 3: 样式**

`.interrupted-note` 用 `--faint`、12px、居中，左右各一条 32px 细线（`--border-strong`）。

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无报错

---

### Task 4: 手动验证

**Files:**
- 无

- [ ] **Step 1: 启动**

Run: `start.cmd`（或 `npm.cmd run dev`）
Expected: 窗口正常打开

- [ ] **Step 2: 中断长任务**

发一条会触发长任务的指令（如让它连续读取多个文件），运行中确认发送键变「停止」；点击后确认：
- 按钮恢复「发送」
- 已生成的回答与工具卡还在
- 消息流末尾出现「已中断」

- [ ] **Step 3: 边界**

切换会话再切回，确认标记不串场、运行状态仍正确；运行中按 Enter 仍能发送排队消息。
