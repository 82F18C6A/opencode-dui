# 工作目录两级结构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧边栏改成「工作目录 → 会话」两级：新建工作目录只登记目录，目录下可新建会话，新建的会话默认落在该目录。

**Architecture:** 渲染层用 `localStorage` 记住登记的目录，启动时与 `project.list()`、已有会话的 `location.directory` 合并去重，按目录分组会话；主进程新增一个系统目录选择 IPC，preload 通过 contextBridge 暴露。

**Tech Stack:** SolidJS、@opencode/client、Electron（CJS 主进程）、TypeScript。

**Spec:** 本会话确认的短设计（见对话）。

## Global Constraints

- 只改 `src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/env.d.ts`、`src/renderer/src/styles.css`
- 不引入新依赖
- 注释用中文、短语式、不加句号
- 视觉沿用现有浅色变量：`--bg` / `--surface` / `--raised` / `--border` / `--border-strong` / `--text` / `--dim` / `--faint`

## Review Focus

- 新建的目录没有任何会话时也要出现在侧边栏，并显示空状态
- 重复登记同一个目录（大小写不同）不能出现两个分组
- 目录改名/删除后旧会话仍能打开，不能因此白屏
- 没有 `location.directory` 的旧会话要归入单独的「未指定目录」组
- 选目录对话框取消时不能创建任何东西，也不能报错

---

### Task 1: 目录选择通道

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

**Interfaces:**
- Produces: `window.opencode.pickDirectory(defaultPath?: string): Promise<string | null>`

- [ ] **Step 1: 主进程加 IPC**

在 `ipcMain.handle('opencode:endpoint', ...)` 旁边新增 `opencode:pick-directory`：有窗口就用 `dialog.showOpenDialog(mainWindow, options)`，否则退回无父窗口重载；`properties` 用 `['openDirectory']`，`defaultPath` 传空则忽略；取消或没选返回 `null`。

- [ ] **Step 2: preload 暴露**

在 `contextBridge.exposeInMainWorld('opencode', {...})` 里加 `pickDirectory`，用 `ipcRenderer.invoke('opencode:pick-directory', defaultPath)`。

- [ ] **Step 3: 补类型**

`env.d.ts` 的 `window.opencode` 里加 `pickDirectory(defaultPath?: string): Promise<string | null>`。

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无报错

---

### Task 2: 工作目录数据层

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces:
  - `type WorkspaceGroup = { directory: string; sessions: Session[]; orphan?: boolean }`
  - `workspaceGroups(): WorkspaceGroup[]`
  - `activeWorkspace(): string | null`
  - `addWorkspace(): Promise<void>`
  - `createSession(directory?: string): Promise<void>`
  - `toggleWorkspace(directory: string): void`
  - `expandWorkspace(directory: string): void`

- [ ] **Step 1: 本地存储**

常量 `WORKSPACE_KEY = 'opencode.workspaces'`；`loadWorkspaces()` 读 JSON 数组、过滤非字符串、异常返回空；`saveWorkspaces(list)` 写回，异常忽略。

- [ ] **Step 2: 信号与初始化**

加 `localWorkspaces`、`projects`、`collapsed` 三个 signal。`onMount` 里在会话列表之后拉 `client.project.list()`，结果可能是数组也可能是 `{ data: [...] }`，两种都兼容，取 `canonical` 存入 `projects`。

- [ ] **Step 3: 合并分组**

`workspaceGroups()` 依次登记：本地目录（保持顺序）→ `projects()` 的目录 → 会话的 `location.directory`；用 `toLowerCase()` 去重。会话按 `time.updated` 倒序塞进对应组；有会话的组按最新会话时间排前面，其余保持登记顺序。没有目录的会话最后合成 `orphan` 组。

- [ ] **Step 4: 新建目录**

`addWorkspace()` 调 `window.opencode.pickDirectory(上次目录)`；取消直接返回；已存在则只展开，不存在就插到 `localWorkspaces` 最前并持久化，然后展开。

- [ ] **Step 5: 新建会话**

把现有 `createSession()` 改成 `createSession(directory?: string)`：目录取参数或当前会话目录，都没有就返回；`session.create({ model?, location: { directory } })`；成功后刷新列表、展开该组、`openSession`。

- [ ] **Step 6: 折叠与展开**

`toggleWorkspace(directory)` 翻转 `collapsed` 里的小写 key；`expandWorkspace(directory)` 删除该 key。`openSession()` 里自动展开目标会话的目录。

- [ ] **Step 7: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无报错

---

### Task 3: 侧边栏两级 UI

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: Task 2 的 `workspaceGroups()`、`addWorkspace()`、`createSession(directory)`、`toggleWorkspace()`

- [ ] **Step 1: 侧边栏结构**

`session-list` 里改为 `For each={workspaceGroups()}`：每组一个 `.workspace`，标题行是折叠按钮（箭头 + 名称，`title` 放完整路径）+ 右侧 `+`（孤儿组不显示）；展开后 `For each={group.sessions}` 渲染现有 `.session-item`，去掉 `.session-dir`；空组显示 `.workspace-empty` 的「还没有会话」。

- [ ] **Step 2: 底部新建目录**

`session-list` 之后加 `.new-workspace` 按钮，文案「+ 新建工作目录」，点击 `addWorkspace()`。

- [ ] **Step 3: 顶栏新建会话**

顶部 `.new-session` 的点击改为 `createSession()`，`disabled={!activeWorkspace()}`。

- [ ] **Step 4: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 无报错

---

### Task 4: 样式

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: 分组样式**

加 `.workspace`、`.workspace-head`、`.workspace-toggle`、`.workspace-name`、`.workspace-add`、`.workspace-empty`、`.new-workspace`；保持现有圆角、颜色变量与 hover 逻辑。

- [ ] **Step 2: 构建**

Run: `npm.cmd run build`
Expected: 三个环境都构建成功

---

### Task 5: 手动验证

**Files:**
- 无

- [ ] **Step 1: 启动**

Run: `start.cmd`
Expected: 窗口打开，侧边栏按目录分组

- [ ] **Step 2: 新建目录**

点「+ 新建工作目录」，选一个目录；确认侧边栏出现该分组、显示「还没有会话」，并且没有自动创建会话。

- [ ] **Step 3: 目录下新建会话**

点该组右侧 `+`；确认新会话出现在该组下、被选中，顶栏显示的目录正确。

- [ ] **Step 4: 边界**

取消目录选择不产生任何变化；重启应用后登记过的目录仍在；把某组折叠后切到组内会话会自动展开。
