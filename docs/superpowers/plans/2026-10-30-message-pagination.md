# 长会话分页 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消息区滚到顶部时自动加载更早的一页，视口不跳；离开底部时右下角出现「回到最新」按钮。

**Architecture:** 第一页用 `order: 'desc'` 取最近 50 条并反转成旧→新；往更早翻页用该页的 `cursor.next`（不是 `previous`），继续反转后插到数组前面。事件触发的刷新只更新最近一页，保留已加载的历史；切换会话才重置游标。

**Tech Stack:** SolidJS、@opencode/client、TypeScript。

**Spec:** 本会话确认的短设计（见对话）。

## Global Constraints

- 只改 `src/renderer/src/App.tsx` 与 `src/renderer/src/styles.css`
- 不引入新依赖
- 注释用中文、短语式、不加句号
- 不改主进程、不改 opencode 源码

## Review Focus

- 事件刷新不能把已经翻出来的历史消息冲掉
- 切换会话时不能把上一个会话的消息混进新会话
- 加载更早后视口不能跳动，也不能立刻再次触发加载
- 没有更早消息时不能再发请求
- 「回到最新」按钮只在离开底部时出现，点击后跟随恢复

---

### Task 1: 分页数据层

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces:
  - `olderCursor(): string | null`
  - `setOlderCursor(value: string | null): void`
  - `loadingOlder(): boolean`
  - `hasMore(): boolean`
  - `loadOlder(): Promise<void>`
  - `refreshMessages(resetCursor?: boolean): Promise<void>`

- [ ] **Step 1: 加游标与加载状态**

`const [olderCursor, setOlderCursor] = createSignal<string | null>(null)`、`const [loadingOlder, setLoadingOlder] = createSignal(false)`、`const hasMore = createMemo(() => Boolean(olderCursor()))`。

- [ ] **Step 2: refreshMessages 支持重置游标与保留历史**

签名改为 `refreshMessages(resetCursor = false)`；请求仍用 `order: 'desc'`，返回后先校验 `activeId()` 没变；`resetCursor` 时把 `res.cursor?.next ?? null` 写入游标。合并时保留本地中 id 不在最近页、且 `time.created` 早于最近页第一条的消息，放在最前面；流式 pending 仍放最后。

- [ ] **Step 3: loadOlder**

用当前游标请求（不带 `order`），结果反转成旧→新，按 id 去重后插到数组前面；更新游标为 `res.cursor?.next ?? null`；请求前后按 `scrollHeight` 差值修正 `scrollTop`。

- [ ] **Step 4: 切换会话重置**

`openSession` 里当 id 变化时清空 `messages`、游标，并调 `refreshMessages(true)`；事件刷新与发送后仍调 `refreshMessages()`。

- [ ] **Step 5: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无报错

---

### Task 2: 滚动触发与回到最新

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `atBottom(): boolean`、`scrollToBottom(): void`

- [ ] **Step 1: 滚动状态**

`const [atBottom, setAtBottom] = createSignal(true)`；`onMessagesScroll` 里算距底距离，更新 `stickToBottom` 与 `atBottom`，并在 `scrollTop < 60` 时 `void loadOlder()`。

- [ ] **Step 2: 回到最新**

`scrollToBottom()` 把 `stickToBottom` 置真并平滑滚到底。在消息区之后渲染固定按钮（`class="to-bottom"`，内容 `↓`，`title="回到最新"`），`Show when={!atBottom()}`。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无报错

---

### Task 3: 样式

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: 按钮样式**

`.main` 加 `position: relative`；新增 `.to-bottom`：绝对定位右下、圆形、白底、细边框、轻阴影，hover 加深；不要遮挡输入区。

- [ ] **Step 2: 构建**

Run: `npm.cmd run build`
Expected: 三个环境构建成功

---

### Task 4: 手动验证

- [ ] **Step 1: 打包并启动**

Run: `npm.cmd run pack`，启动 `D:\Z_UserZYH\Projects\exports\opencode-dui\win-unpacked\opencode-dui.exe`

- [ ] **Step 2: 翻页**

打开一个超过 50 条的会话，往上滚：更早的消息应逐页出现，当前阅读位置不跳；到最早后不再加载。

- [ ] **Step 3: 回到最新**

离开底部后右下角出现 `↓`，点击平滑回到底部并跟随新消息。
