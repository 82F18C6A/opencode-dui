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

const REMOVED_KEY = 'opencode.removedWorkspaces'

/** 读取已移除的工作目录 */
function loadRemoved(): string[] {
  try {
    const raw = localStorage.getItem(REMOVED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

/** 写回已移除的工作目录 */
function saveRemoved(list: string[]) {
  try {
    localStorage.setItem(REMOVED_KEY, JSON.stringify(list))
  } catch {
    // 写不进去时忽略
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
  // 更早消息的游标，来自最近一页的 cursor.next
  const [olderCursor, setOlderCursor] = createSignal<string | null>(null)
  const [loadingOlder, setLoadingOlder] = createSignal(false)
  const [atBottom, setAtBottom] = createSignal(true)
  // 当前读到的用户提问序号，用于刻度高亮
  const [currentPromptIndex, setCurrentPromptIndex] = createSignal(0)
  // 本地登记的工作目录，服务端项目与会话目录会合并进来
  const [localWorkspaces, setLocalWorkspaces] = createSignal<string[]>(loadWorkspaces())
  const [projects, setProjects] = createSignal<string[]>([])
  // 折叠的工作目录，key 为小写路径
  const [collapsed, setCollapsed] = createSignal<Record<string, true>>({})
  // 已删除的工作目录，避免服务端项目把它带回来
  const [removedWorkspaces, setRemovedWorkspaces] = createSignal<string[]>(loadRemoved())
  const [deletingWorkspace, setDeletingWorkspace] = createSignal<string | null>(null)
  // 已归档会话弹层
  const [archivedOpen, setArchivedOpen] = createSignal(false)
  const [archivedSessions, setArchivedSessions] = createSignal<Session[]>([])
  // 就地重命名
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameText, setRenameText] = createSignal('')

  let client: any = null
  let scroller: HTMLDivElement | undefined
  let navPanel: HTMLDivElement | undefined
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
  const hasMore = createMemo(() => Boolean(olderCursor()))
  // 右侧导航条只列用户提问
  const userPrompts = createMemo(() =>
    messages()
      .filter((message) => message?.type === 'user')
      .map((message) => ({
        id: String(message?.id ?? ''),
        text: String(message?.text ?? '').replace(/\s+/g, ' ').trim(),
      })),
  )

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
    const removed = new Set(removedWorkspaces())
    for (const directory of projects()) {
      if (!removed.has(directory.toLowerCase())) ensure(directory)
    }

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

  async function refreshMessages(resetCursor = false) {
    const id = activeId()
    if (!client || !id) return
    // 服务端默认倒序返回最近一页，反转成旧→新，与流式追加和滚动方向一致
    const res = await client.message.list({ sessionID: id, order: 'desc' })
    if (activeId() !== id) return

    const server = [...(res.data ?? [])].reverse()
    if (resetCursor) {
      // desc 页里 next 才指向更早的消息，previous 是更新方向
      setOlderCursor(res.cursor?.next ?? null)
    }

    setMessages((prev) => {
      const known = new Set(server.map((m: any) => m.id))
      const firstCreated = server[0]?.time?.created ?? 0
      // 已经翻出来的更早消息留在前面
      const older = prev.filter(
        (m) => m?.id && !known.has(m.id) && (m.time?.created ?? 0) < firstCreated,
      )
      const olderIds = new Set(older.map((m) => m.id))
      // 服务端可能还没落库正在流式的消息，保留本地那条避免闪烁
      const pending = prev.filter(
        (m) => m?.id && !known.has(m.id) && !olderIds.has(m.id) && m.type === 'assistant',
      )
      return [...older, ...server, ...pending]
    })
  }

  /** 找到视口里第一个可见的消息元素 */
  function firstVisibleMessage(): HTMLElement | undefined {
    if (!scroller) return
    const top = scroller.getBoundingClientRect().top
    for (const child of Array.from(scroller.children)) {
      const element = child as HTMLElement
      if (element.getBoundingClientRect().bottom > top) return element
    }
    return undefined
  }

  /** 往上加载更早的一页，保持视口位置 */
  async function loadOlder() {
    const id = activeId()
    const cursor = olderCursor()
    if (!client || !id || !cursor || loadingOlder()) return

    setLoadingOlder(true)
    try {
      const res: any = await client.message.list({ sessionID: id, cursor })
      if (activeId() !== id) return

      const batch = [...(res.data ?? [])].reverse()
      setOlderCursor(res.cursor?.next ?? null)

      // 以当前可见消息为锚点，插入后按它的位移补 scrollTop
      const anchor = firstVisibleMessage()
      const anchorTop = anchor?.getBoundingClientRect().top ?? 0
      stickToBottom = false
      suppressOlder = true
      setMessages((prev) => {
        const known = new Set(prev.map((m: any) => m.id))
        const fresh = batch.filter((m: any) => m?.id && !known.has(m.id))
        return fresh.length ? [...fresh, ...prev] : prev
      })

      queueMicrotask(() => {
        if (scroller && anchor) {
          scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop
        }
        // 补偿是瞬时的，立即解除抑制；若这一页不够高、视口仍在顶部，
        // 主动继续加载下一页，不依赖后续滚动事件
        suppressOlder = false
        if (scroller && scroller.scrollTop < 60) void loadOlder()
      })
    } catch {
      suppressOlder = false
      // 加载失败不打断阅读，下次滚动再试
    } finally {
      setLoadingOlder(false)
    }
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

    // 重新加回曾被删除的目录时，去掉忽略标记
    const nextRemoved = removedWorkspaces().filter((dir) => dir !== key)
    if (nextRemoved.length !== removedWorkspaces().length) {
      setRemovedWorkspaces(nextRemoved)
      saveRemoved(nextRemoved)
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
    if (id !== activeId()) {
      setActiveId(id)
      setMessages([])
      setOlderCursor(null)
    }
    setInterruptNotice(null)
    const directory = sessions().find((session) => session.id === id)?.location?.directory
    if (directory) expandWorkspace(directory)
    await refreshMessages(true)
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
      const res = await client.session.list({ archived: false })
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
      const res = await client.session.list({ archived: false })
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
      const res = await client.session.list({ archived: false })
      setSessions(res.data ?? [])
      expandWorkspace(target)
      await openSession(session.id)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  async function refreshSessions() {
    if (!client) return
    const res = await client.session.list({ archived: false })
    setSessions(res.data ?? [])
  }

  /** 归档会话，归档后从列表隐藏 */
  async function archiveSession(id: string) {
    if (!client) return
    try {
      await client.session.update({ sessionID: id, archived: true })
      const wasActive = activeId() === id
      const res = await client.session.list({ archived: false })
      const list = res.data ?? []
      setSessions(list)
      if (wasActive) {
        if (list[0]) await openSession(list[0].id)
        else {
          setActiveId(null)
          setMessages([])
        }
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  /** 打开已归档列表 */
  async function openArchived() {
    if (!client) return
    setArchivedOpen(true)
    try {
      const res: any = await client.session.list({ archived: true })
      setArchivedSessions(res.data ?? [])
    } catch {
      setArchivedSessions([])
    }
  }

  /** 恢复已归档会话 */
  async function restoreSession(id: string) {
    if (!client) return
    try {
      await client.session.update({ sessionID: id, archived: false })
      await openArchived()
      await refreshSessions()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  /** 永久删除会话 */
  async function deleteSession(id: string) {
    if (!client) return
    try {
      await client.session.remove({ sessionID: id })
      await openArchived()
      await refreshSessions()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  /** 弹出删除工作目录确认 */
  function requestDeleteWorkspace(directory: string) {
    setDeletingWorkspace(directory)
  }

  /** 删除工作目录：归档目录下的会话并移出侧边栏 */
  async function confirmDeleteWorkspace() {
    const directory = deletingWorkspace()
    if (!directory || !client) return
    const group = workspaceGroups().find(
      (item) => item.directory.toLowerCase() === directory.toLowerCase(),
    )
    const targets = group?.sessions ?? []

    try {
      for (const session of targets) {
        await client.session.update({ sessionID: session.id, archived: true })
      }

      const nextLocal = localWorkspaces().filter(
        (dir) => dir.toLowerCase() !== directory.toLowerCase(),
      )
      setLocalWorkspaces(nextLocal)
      saveWorkspaces(nextLocal)

      const nextRemoved = Array.from(new Set([...removedWorkspaces(), directory.toLowerCase()]))
      setRemovedWorkspaces(nextRemoved)
      saveRemoved(nextRemoved)

      setDeletingWorkspace(null)
      const res = await client.session.list({ archived: false })
      const list = res.data ?? []
      setSessions(list)
      if (targets.some((session) => session.id === activeId())) {
        if (list[0]) await openSession(list[0].id)
        else {
          setActiveId(null)
          setMessages([])
        }
      }
    } catch (error) {
      setDeletingWorkspace(null)
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  /** 双击标题进入就地编辑 */
  function beginRename(session: Session) {
    setRenamingId(session.id)
    setRenameText(session.title ?? '')
  }

  function cancelRename() {
    setRenamingId(null)
  }

  async function commitRename() {
    const id = renamingId()
    if (!id) return
    const title = renameText().trim()
    setRenamingId(null)
    if (!title) return
    try {
      await client.session.update({ sessionID: id, title })
      await refreshSessions()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  /** 根据滚动位置更新当前读到的提问序号 */
  function updateCurrentPrompt() {
    if (!scroller) return
    const nodes = scroller.querySelectorAll<HTMLElement>('.msg-user')
    if (!nodes.length) return
    const marker = scroller.getBoundingClientRect().top + scroller.clientHeight / 2
    let index = 0
    nodes.forEach((node, i) => {
      if (node.getBoundingClientRect().top <= marker) index = i
    })
    setCurrentPromptIndex(index)
  }

  /** 打开导航面板时把当前项滚进可视区 */
  function revealCurrentPrompt() {
    queueMicrotask(() => {
      const item = navPanel?.querySelector<HTMLElement>('.nav-item.current')
      item?.scrollIntoView({ block: 'nearest' })
    })
  }

  /** 跳到某条用户提问并高亮，滚动结束后再出现高亮 */
  function jumpToPrompt(index: number) {
    const nodes = scroller?.querySelectorAll<HTMLElement>('.msg-user')
    const node = nodes?.[index]
    if (!node || !scroller) return

    let shown = false
    const showFlash = () => {
      if (shown) return
      shown = true
      scroller?.removeEventListener('scrollend', showFlash)
      node.classList.add('flash')
      setTimeout(() => node.classList.remove('flash'), 3000)
    }

    // 目标已在视口内就直接高亮，否则等滚动结束
    const view = scroller.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    if (rect.top >= view.top && rect.bottom <= view.bottom) {
      showFlash()
    } else {
      scroller.addEventListener('scrollend', showFlash, { once: true })
      // scrollend 不触发时的兜底
      setTimeout(showFlash, 2000)
    }

    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
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
  let suppressOlder = false
  function onMessagesScroll() {
    if (!scroller) return
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    stickToBottom = distance < 48
    setAtBottom(distance < 160)
    // 滚到顶部附近就加载更早的一页
    if (scroller.scrollTop < 60 && !suppressOlder) void loadOlder()
    updateCurrentPrompt()
  }

  /** 回到最新消息 */
  function scrollToBottom() {
    stickToBottom = true
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }

  createEffect(() => {
    messages()
    queueMicrotask(updateCurrentPrompt)
    if (!stickToBottom || !scroller) return
    queueMicrotask(() => {
      if (stickToBottom) scroller?.scrollTo({ top: scroller.scrollHeight })
    })
  })

  return (
    <div class="app">
      <aside class="sidebar">
        <div class="brand">opencode</div>
        <button class="new-workspace" onClick={() => void addWorkspace()}>
          + 新建工作目录
        </button>
        <div class="session-list">
          <For each={workspaceGroups()}>
            {(group) => {
              const open = () => !collapsed()[group.directory.toLowerCase()]
              return (
                <div class="workspace">
                  <div class="workspace-head" classList={{ orphan: group.orphan }}>
                    <button
                      class="workspace-toggle"
                      title={group.directory || '未指定目录'}
                      onClick={() => toggleWorkspace(group.directory)}
                    >
                      <span class="workspace-chev">{open() ? '▾' : '▸'}</span>
                      <svg class="workspace-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
                      </svg>
                      <span class="workspace-name">{pathName(group.directory)}</span>
                    </button>
                    <Show when={!group.orphan}>
                      <button
                        class="workspace-delete"
                        title="删除工作目录（会话会归档）"
                        onClick={() => requestDeleteWorkspace(group.directory)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 7h14M10 7V5h4v2M7.5 7l.8 12h7.4l.8-12" />
                        </svg>
                      </button>
                      <button
                        class="workspace-add"
                        title="在这个目录下新建会话"
                        onClick={() => void createSession(group.directory)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="8.5" />
                          <path d="M12 8.5v7M8.5 12h7" />
                        </svg>
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
                          <div class="session-row" classList={{ active: session.id === activeId() }}>
                            <Show
                              when={renamingId() === session.id}
                              fallback={
                                <button class="session-item" onClick={() => void openSession(session.id)}>
                                  <span
                                    class="session-title"
                                    onDblClick={(event) => {
                                      event.stopPropagation()
                                      beginRename(session)
                                    }}
                                  >
                                    {session.title || '未命名会话'}
                                  </span>
                                </button>
                              }
                            >
                              <input
                                class="session-rename"
                                value={renameText()}
                                ref={(el) => queueMicrotask(() => el.select())}
                                onInput={(event) => setRenameText(event.currentTarget.value)}
                                onBlur={() => void commitRename()}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void commitRename()
                                  } else if (event.key === 'Escape') {
                                    cancelRename()
                                  }
                                }}
                              />
                            </Show>
                            <button
                              class="session-archive"
                              title="归档"
                              onClick={(event) => {
                                event.stopPropagation()
                                void archiveSession(session.id)
                              }}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 7h16M5.5 7v11.5h13V7M9 11h6" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
        <button class="archived-entry" onClick={() => void openArchived()}>
          已归档
        </button>
      </aside>

      <main class="main">
        <header class="topbar">
          <Show when={activeSession()} fallback={<span class="muted">未选择会话</span>}>
            <span class="topbar-title">{activeSession()?.title ?? '未命名会话'}</span>
            <span class="topbar-dir">{activeSession()?.location?.directory ?? ''}</span>
          </Show>
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

          <Show when={userPrompts().length}>
            <div class="nav-zone" onMouseEnter={revealCurrentPrompt}>
              <div class="nav-ticks">
                <For each={userPrompts()}>
                  {(_, index) => (
                    <span class="nav-tick" classList={{ current: index() === currentPromptIndex() }} />
                  )}
                </For>
              </div>
              <div class="message-nav" ref={navPanel}>
                <For each={userPrompts()}>
                  {(prompt, index) => (
                    <button
                      class="nav-item"
                      classList={{ current: index() === currentPromptIndex() }}
                      title={prompt.text}
                      onClick={() => jumpToPrompt(index())}
                    >
                      {prompt.text || '（空消息）'}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={!atBottom()}>
            <button class="to-bottom" title="回到最新" onClick={scrollToBottom}>
              ↓
            </button>
          </Show>

          <div class="composer">
            <textarea
              value={input()}
              placeholder="发消息…（Enter 发送，Shift+Enter 换行）"
              onInput={(event) => setInput(event.currentTarget.value)}
              onKeyDown={onComposerKeyDown}
            />
            <div class="composer-bar">
              <button class="model-chip" disabled={!activeId()} onClick={() => setPickerOpen(true)}>
                <span class="model-chip-name">{currentModel()?.name ?? '选择模型'}</span>
                <svg class="model-chip-chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 10l5 5 5-5" />
                </svg>
              </button>
              <button
                class="send"
                classList={{ stop: isRunning() }}
                title={isRunning() ? '停止' : '发送'}
                aria-label={isRunning() ? '停止' : '发送'}
                disabled={isRunning() ? interrupting() : sending() || !input().trim()}
                onClick={() => (isRunning() ? void interrupt() : void send())}
              >
                <Show
                  when={isRunning()}
                  fallback={
                    <svg class="send-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 19V5M6 11l6-6 6 6" />
                    </svg>
                  }
                >
                  <svg class="send-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="8" y="8" width="8" height="8" rx="1.5" />
                  </svg>
                </Show>
              </button>
            </div>
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

      <Show when={archivedOpen()}>
        <div class="overlay" onClick={() => setArchivedOpen(false)}>
          <div class="dialog archived-dialog" onClick={(event) => event.stopPropagation()}>
            <div class="dialog-title">已归档会话</div>
            <Show
              when={archivedSessions().length}
              fallback={<div class="archived-empty">还没有已归档的会话</div>}
            >
              <div class="archived-list">
                <For each={archivedSessions()}>
                  {(session) => (
                    <div class="archived-item">
                      <span class="archived-title" title={session.title ?? ''}>
                        {session.title || '未命名会话'}
                      </span>
                      <button class="ghost" onClick={() => void restoreSession(session.id)}>
                        恢复
                      </button>
                      <button class="danger" onClick={() => void deleteSession(session.id)}>
                        删除
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="dialog-actions">
              <button onClick={() => setArchivedOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={deletingWorkspace()}>
        {(directory) => (
          <div class="overlay" onClick={() => setDeletingWorkspace(null)}>
            <div class="dialog" onClick={(event) => event.stopPropagation()}>
              <div class="dialog-title">删除工作目录</div>
              <div class="dialog-message">
                确定删除「{pathName(directory())}」吗？该目录下的{' '}
                {workspaceGroups().find(
                  (group) => group.directory.toLowerCase() === directory().toLowerCase(),
                )?.sessions.length ?? 0}{' '}
                个会话会被归档，可以在「已归档」里恢复。
              </div>
              <div class="dialog-actions">
                <button class="ghost" onClick={() => setDeletingWorkspace(null)}>
                  取消
                </button>
                <button class="primary" onClick={() => void confirmDeleteWorkspace()}>
                  删除并归档
                </button>
              </div>
            </div>
          </div>
        )}
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
