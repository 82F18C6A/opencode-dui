import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { OpenCode } from '@opencode/client'
import Message from './components/Message'
import ModelPicker from './components/ModelPicker'

type Session = {
  id: string
  title?: string
  model?: { id: string; providerID: string; variant?: string }
  location?: { directory?: string }
  time?: { updated?: number }
}

type Model = {
  id: string
  modelID?: string
  providerID: string
  name?: string
  status?: string
  enabled?: boolean
}

type PermissionRequest = {
  id: string
  sessionID: string
  action: string
  resources?: string[]
  message?: string
}

type WorkspaceGroup = {
  directory: string
  sessions: Session[]
  orphan?: boolean
}

const WORKSPACE_KEY = 'opencode.workspaces'

/** 读取本地登记的工作目录 */
function loadWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

/** 写回本地登记的工作目录 */
function saveWorkspaces(list: string[]) {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(list))
  } catch {
    // 写不进去时忽略，不影响当前会话
  }
}

/** 取路径最后一段作为显示名 */
function pathName(directory: string): string {
  if (!directory) return '未指定目录'
  const parts = directory.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? directory
}

export default function App() {
  const [phase, setPhase] = createSignal<'loading' | 'ready' | 'error'>('loading')
  const [errorText, setErrorText] = createSignal('')
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [messages, setMessages] = createSignal<any[]>([])
  const [permissions, setPermissions] = createSignal<PermissionRequest[]>([])
  const [models, setModels] = createSignal<Model[]>([])
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [input, setInput] = createSignal('')
  const [sending, setSending] = createSignal(false)
  // 正在运行的会话表，值为 true 表示该会话占用执行
  const [running, setRunning] = createSignal<Record<string, true>>({})
  const [interrupting, setInterrupting] = createSignal(false)
  const [interruptNotice, setInterruptNotice] = createSignal<string | null>(null)
  // 本地登记的工作目录，服务端项目与会话目录会合并进来
  const [localWorkspaces, setLocalWorkspaces] = createSignal<string[]>(loadWorkspaces())
  const [projects, setProjects] = createSignal<string[]>([])
  // 折叠的工作目录，key 为小写路径
  const [collapsed, setCollapsed] = createSignal<Record<string, true>>({})

  let client: any = null
  let scroller: HTMLDivElement | undefined
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined

  const activeSession = createMemo(() => sessions().find((s) => s.id === activeId()))
  const activePermission = createMemo(() => permissions()[0])
  // 当前会话是否正在执行
  const isRunning = createMemo(() => {
    const id = activeId()
    return Boolean(id && running()[id])
  })

  const activeWorkspace = createMemo(() => activeSession()?.location?.directory ?? null)

  // 工作目录 → 会话的两级分组
  const workspaceGroups = createMemo<WorkspaceGroup[]>(() => {
    const groups = new Map<string, WorkspaceGroup>()
    const ensure = (directory: string) => {
      const key = directory.toLowerCase()
      let group = groups.get(key)
      if (!group) {
        group = { directory, sessions: [] }
        groups.set(key, group)
      }
      return group
    }

    // 本地登记的排前面，其次是服务端已有项目的目录
    for (const directory of localWorkspaces()) ensure(directory)
    for (const directory of projects()) ensure(directory)

    const orphans: Session[] = []
    for (const session of sessions()) {
      const directory = session.location?.directory
      if (!directory) {
        orphans.push(session)
        continue
      }
      ensure(directory).sessions.push(session)
    }

    const list = [...groups.values()]
    for (const group of list) {
      group.sessions.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    }
    // 有会话的目录按最近使用排前，其余保持登记顺序
    list.sort((a, b) => {
      const at = a.sessions[0]?.time?.updated ?? 0
      const bt = b.sessions[0]?.time?.updated ?? 0
      return bt - at
    })

    if (orphans.length) list.push({ directory: '', sessions: orphans, orphan: true })
    return list
  })

  const currentModel = createMemo<Model | undefined>(() => {
    const ref = activeSession()?.model
    if (!ref) return undefined
    return (
      models().find((m) => m.id === ref.id && m.providerID === ref.providerID) ?? {
        id: ref.id,
        providerID: ref.providerID,
        name: ref.id,
      }
    )
  })

  async function refreshMessages() {
    const id = activeId()
    if (!client || !id) return
    // 服务端默认倒序返回最近一页，反转成旧→新，与流式追加和滚动方向一致
    const res = await client.message.list({ sessionID: id, order: 'desc' })
    const server = [...(res.data ?? [])].reverse()
    setMessages((prev) => {
      // 服务端可能还没落库正在流式的消息，保留本地那条避免闪烁
      const known = new Set(server.map((m: any) => m.id))
      const pending = prev.filter((m) => m?.id && !known.has(m.id) && m.type === 'assistant')
      return pending.length ? [...server, ...pending] : server
    })
  }

  async function refreshPermissions() {
    if (!client) return
    try {
      const res = await client.permission.request.list()
      setPermissions(res.data ?? [])
    } catch {
      // 服务短暂不可用时忽略
    }
  }

  /** 展开某个工作目录 */
  function expandWorkspace(directory: string) {
    const key = directory.toLowerCase()
    setCollapsed((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  /** 折叠或展开工作目录 */
  function toggleWorkspace(directory: string) {
    const key = directory.toLowerCase()
    setCollapsed((prev) => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  /** 登记一个工作目录，不创建会话 */
  async function addWorkspace() {
    const defaultPath = activeWorkspace() ?? localWorkspaces()[0] ?? undefined
    const picked = await window.opencode.pickDirectory(defaultPath)
    if (!picked) return

    const key = picked.toLowerCase()
    const exists =
      localWorkspaces().some((dir) => dir.toLowerCase() === key) ||
      projects().some((dir) => dir.toLowerCase() === key) ||
      sessions().some((session) => session.location?.directory?.toLowerCase() === key)

    if (!exists) {
      const next = [picked, ...localWorkspaces()]
      setLocalWorkspaces(next)
      saveWorkspaces(next)
    }
    expandWorkspace(picked)
  }

  /** 标记某个会话的运行状态 */
  function setSessionRunning(sessionID: string, on: boolean) {
    setRunning((prev) => {
      const next = { ...prev }
      if (on) next[sessionID] = true
      else delete next[sessionID]
      return next
    })
  }

  /** 处理运行状态相关事件，命中返回 true */
  function handleRunningEvent(type: string, data: any): boolean {
    const sessionID = data?.sessionID
    if (!sessionID) return false

    if (type === 'session.status') {
      const status = data.status?.type
      if (status === 'busy' || status === 'retry') setSessionRunning(sessionID, true)
      else if (status === 'idle') setSessionRunning(sessionID, false)
      return true
    }

    if (type === 'session.idle') {
      setSessionRunning(sessionID, false)
      return true
    }

    if (type === 'session.execution.started') {
      setSessionRunning(sessionID, true)
      return true
    }

    // 成功、失败、中断都算这一轮结束
    if (
      type === 'session.execution.succeeded' ||
      type === 'session.execution.failed' ||
      type === 'session.execution.interrupted'
    ) {
      setSessionRunning(sessionID, false)
      return true
    }

    return false
  }

  /** 启动后用服务端的活跃表校准一次 */
  async function refreshActiveSessions() {
    if (!client) return
    try {
      const res: any = await client.session.active()
      const map = res?.data ?? res ?? {}
      const next: Record<string, true> = {}
      for (const [id, state] of Object.entries(map)) {
        if ((state as any)?.type === 'running') next[id] = true
      }
      setRunning(next)
    } catch {
      // 旧版本服务没有该接口时忽略
    }
  }

  async function openSession(id: string) {
    setActiveId(id)
    setInterruptNotice(null)
    const directory = sessions().find((session) => session.id === id)?.location?.directory
    if (directory) expandWorkspace(directory)
    await refreshMessages()
  }

  function scheduleReload() {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      void refreshMessages()
      void refreshPermissions()
    }, 350)
  }

  onMount(async () => {
    try {
      const endpoint = await window.opencode.getEndpoint()
      if (!endpoint) throw new Error('主进程没有返回服务端点')

      client = OpenCode.make({ baseUrl: endpoint.url, headers: endpoint.headers })
      const res = await client.session.list()
      setSessions(res.data ?? [])
      void client.model
        .list()
        .then((modelRes: any) => setModels(modelRes.data ?? []))
        .catch(() => {})
      void client.project
        .list()
        .then((projectRes: any) => {
          const list = Array.isArray(projectRes) ? projectRes : (projectRes?.data ?? [])
          const dirs = list
            .map((item: any) => item?.canonical)
            .filter((dir: any): dir is string => typeof dir === 'string' && dir.length > 0)
          setProjects(dirs)
        })
        .catch(() => {})
      if (res.data?.[0]) await openSession(res.data[0].id)
      await refreshActiveSessions()
      await refreshPermissions()
      setPhase('ready')
      void subscribe()
      pollTimer = setInterval(() => void refreshPermissions(), 2500)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setPhase('error')
    }
  })

  onCleanup(() => {
    clearInterval(pollTimer)
    clearTimeout(reloadTimer)
  })

  async function subscribe() {
    try {
      for await (const event of client.event.subscribe()) {
        const type = String((event as any)?.type ?? '')
        const data = (event as any)?.data as any

        // 运行状态在过滤前处理，后台会话结束也要更新
        if (handleRunningEvent(type, data)) {
          if (data?.sessionID === activeId()) scheduleReload()
          continue
        }

        // 只处理当前会话
        if (data?.sessionID && data.sessionID !== activeId()) continue

        // 文本与推理走增量，其余事件触发一次重拉校准
        if (type === 'session.text.delta' && data) {
          appendStreamDelta(data.assistantMessageID, 'text', data.delta, data.ordinal ?? 0)
          continue
        }
        if (type === 'session.reasoning.delta' && data) {
          appendStreamDelta(data.assistantMessageID, 'reasoning', data.delta, data.ordinal ?? 0)
          continue
        }
        if (type.startsWith('session.') || type.startsWith('permission.') || type.startsWith('form.')) {
          scheduleReload()
        }
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      if (phase() === 'ready') void subscribe()
    }
  }

  async function replyPermission(request: PermissionRequest, decision: 'once' | 'always' | 'reject') {
    try {
      await client.permission.reply({
        sessionID: request.sessionID,
        requestID: request.id,
        decision,
      })
    } finally {
      await refreshPermissions()
      await refreshMessages()
    }
  }

  async function switchModel(model: Model) {
    const id = activeId()
    if (!id || !client) return
    setPickerOpen(false)
    try {
      await client.session.switchModel({
        sessionID: id,
        model: { id: model.id, providerID: model.providerID },
      })
      const res = await client.session.list()
      setSessions(res.data ?? [])
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  async function createSession(directory?: string) {
    if (!client) return
    const target = directory ?? activeWorkspace()
    if (!target) return

    // 优先沿用当前（或最近）会话的模型：默认模型没额度，随便挑的免费模型也可能不可用
    const sibling = activeSession()?.model ?? sessions().find((s) => s.model)?.model
    const model = sibling ? { id: sibling.id, providerID: sibling.providerID } : undefined

    try {
      const session = await client.session.create({
        ...(model ? { model } : {}),
        location: { directory: target },
      })
      const res = await client.session.list()
      setSessions(res.data ?? [])
      expandWorkspace(target)
      await openSession(session.id)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  /** 把流式增量直接追加到本地消息，避免整条重拉 */
  function appendStreamDelta(messageID: string, kind: 'text' | 'reasoning', delta: string, ordinal: number) {
    setMessages((prev) => {
      const index = prev.findIndex((m) => m?.id === messageID)
      if (index === -1) {
        const created = {
          id: messageID,
          type: 'assistant',
          content: [{ type: kind, text: delta }],
          time: { created: Date.now() },
        }
        return [...prev, created]
      }

      const msg = prev[index]
      const content = Array.isArray(msg.content) ? [...msg.content] : []

      // ordinal 是 part 序号；类型不匹配时退回到最后一个同类型块
      let target = -1
      if (content[ordinal]?.type === kind) {
        target = ordinal
      } else {
        for (let i = content.length - 1; i >= 0; i--) {
          if (content[i]?.type === kind) {
            target = i
            break
          }
        }
      }

      if (target === -1) {
        content.push({ type: kind, text: delta })
      } else {
        content[target] = { ...content[target], text: `${content[target].text ?? ''}${delta}` }
      }

      const next = [...prev]
      next[index] = { ...msg, content }
      return next
    })
  }

  async function send() {
    const text = input().trim()
    const id = activeId()
    if (!text || !id || sending()) return
    setSending(true)
    setInput('')
    setInterruptNotice(null)
    try {
      await client.session.prompt({ sessionID: id, text })
      // prompt 只是入队，先乐观置忙，后续事件再校准
      setSessionRunning(id, true)
      await refreshMessages()
    } catch (error) {
      setSessionRunning(id, false)
      setErrorText(error instanceof Error ? error.message : String(error))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  /** 中断当前会话正在进行的执行 */
  async function interrupt() {
    const id = activeId()
    if (!id || !client || interrupting()) return
    setInterrupting(true)
    try {
      const res: any = await client.session.interrupt({ sessionID: id })
      const interrupted = res?.data?.interrupted ?? res?.interrupted ?? true
      if (!interrupted) return
      setSessionRunning(id, false)
      setInterruptNotice('已中断')
      await refreshMessages()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setInterrupting(false)
    }
  }

  function onComposerKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  // 内容变化时跟随底部，但用户往上翻时不打扰
  let stickToBottom = true
  function onMessagesScroll() {
    if (!scroller) return
    stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48
  }

  createEffect(() => {
    messages()
    if (!stickToBottom || !scroller) return
    queueMicrotask(() => {
      if (stickToBottom) scroller?.scrollTo({ top: scroller.scrollHeight })
    })
  })

  return (
    <div class="app">
      <aside class="sidebar">
        <div class="brand">opencode</div>
        <div class="session-list">
          <For each={workspaceGroups()}>
            {(group) => {
              const open = () => !collapsed()[group.directory.toLowerCase()]
              return (
                <div class="workspace">
                  <div class="workspace-head">
                    <button
                      class="workspace-toggle"
                      title={group.directory || '未指定目录'}
                      onClick={() => toggleWorkspace(group.directory)}
                    >
                      <span class="workspace-chev">{open() ? '▾' : '▸'}</span>
                      <span class="workspace-name">{pathName(group.directory)}</span>
                    </button>
                    <Show when={!group.orphan}>
                      <button
                        class="workspace-add"
                        title="在这个目录下新建会话"
                        onClick={() => void createSession(group.directory)}
                      >
                        +
                      </button>
                    </Show>
                  </div>
                  <Show when={open()}>
                    <Show
                      when={group.sessions.length}
                      fallback={<div class="workspace-empty">还没有会话</div>}
                    >
                      <For each={group.sessions}>
                        {(session) => (
                          <button
                            class="session-item"
                            classList={{ active: session.id === activeId() }}
                            onClick={() => void openSession(session.id)}
                          >
                            <span class="session-title">{session.title || '未命名会话'}</span>
                          </button>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
        <button class="new-workspace" onClick={() => void addWorkspace()}>
          + 新建工作目录
        </button>
      </aside>

      <main class="main">
        <header class="topbar">
          <Show when={activeSession()} fallback={<span class="muted">未选择会话</span>}>
            <span class="topbar-title">{activeSession()?.title ?? '未命名会话'}</span>
            <span class="topbar-dir">{activeSession()?.location?.directory ?? ''}</span>
          </Show>
          <div class="topbar-spacer" />
          <button class="model-button" disabled={!activeId()} onClick={() => setPickerOpen(true)}>
            {currentModel()?.name ?? '选择模型'}
          </button>
          <button class="new-session" disabled={!activeWorkspace()} onClick={() => void createSession()}>
            新建会话
          </button>
        </header>

        <Show when={phase() === 'loading'}>
          <div class="center muted">正在连接本地服务…</div>
        </Show>

        <Show when={phase() === 'error'}>
          <div class="center error">连接失败：{errorText()}</div>
        </Show>

        <Show when={phase() === 'ready'}>
          <div class="messages" ref={scroller} onScroll={onMessagesScroll}>
            <For each={messages()}>{(msg, index) => <Message msg={msg} index={index()} />}</For>
            <Show when={interruptNotice()}>
              <div class="interrupted-note">{interruptNotice()}</div>
            </Show>
          </div>

          <div class="composer">
            <textarea
              value={input()}
              placeholder="发消息…（Enter 发送，Shift+Enter 换行）"
              onInput={(event) => setInput(event.currentTarget.value)}
              onKeyDown={onComposerKeyDown}
            />
            <button
              class="send"
              classList={{ stop: isRunning() }}
              disabled={isRunning() ? interrupting() : sending() || !input().trim()}
              onClick={() => (isRunning() ? void interrupt() : void send())}
            >
              {isRunning() ? (interrupting() ? '停止中…' : '停止') : sending() ? '发送中…' : '发送'}
            </button>
          </div>
        </Show>
      </main>

      <Show when={pickerOpen()}>
        <ModelPicker
          models={models()}
          current={activeSession()?.model}
          onPick={(model) => void switchModel(model)}
          onClose={() => setPickerOpen(false)}
        />
      </Show>

      <Show when={activePermission()}>
        {(request) => (
          <div class="overlay">
            <div class="dialog">
              <div class="dialog-title">工具请求权限</div>
              <div class="dialog-action">{request().action}</div>
              <Show when={request().resources?.length}>
                <div class="dialog-resources">
                  <For each={request().resources}>{(resource) => <code>{resource}</code>}</For>
                </div>
              </Show>
              <Show when={request().message}>
                <div class="dialog-message">{request().message}</div>
              </Show>
              <div class="dialog-actions">
                <button class="ghost" onClick={() => void replyPermission(request(), 'reject')}>
                  拒绝
                </button>
                <button onClick={() => void replyPermission(request(), 'once')}>允许一次</button>
                <button class="primary" onClick={() => void replyPermission(request(), 'always')}>
                  总是允许
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
