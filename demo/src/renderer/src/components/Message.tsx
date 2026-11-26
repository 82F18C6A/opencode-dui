import { For, Show, createEffect, createSignal, createMemo } from 'solid-js'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { toBlocks, splitBlocks, type Block } from '../lib/blocks'

marked.setOptions({ gfm: true, breaks: false })

/** 渲染 markdown 并去掉危险内容 */
function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
  })
}

// 记住推理块的展开状态，流式刷新重建组件时不收回
const reasoningOpen = new Map<string, boolean>()

/** 推理块：默认折叠成一行，展开后是淡化的小字 */
function ReasoningBlock(props: { text: string; ms?: number; stateKey: string }) {
  const [open, setOpen] = createSignal(reasoningOpen.get(props.stateKey) ?? false)
  const seconds = createMemo(() => {
    if (props.ms === undefined) return null
    return Math.max(1, Math.round(props.ms / 1000))
  })

  function toggle() {
    const next = !open()
    setOpen(next)
    reasoningOpen.set(props.stateKey, next)
  }

  return (
    <div class="reasoning" data-open={open()}>
      <button class="reasoning-head" onClick={toggle}>
        <span class="chev">▶</span>
        <span>{seconds() ? `思考了 ${seconds()} 秒` : '思考过程'}</span>
      </button>
      <Show when={open()}>
        <div class="reasoning-body">{props.text}</div>
      </Show>
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  streaming: '生成中',
  running: '执行中',
  completed: '完成',
  error: '失败',
}

function toolStatus(state: unknown): string {
  return (state as any)?.status ?? 'running'
}

function toolInput(state: unknown): string {
  const input = (state as any)?.input
  if (input === undefined || input === null) return ''
  if (typeof input === 'string') return input
  // shell 类工具优先显示命令本身
  if (typeof input.command === 'string') return input.command
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function toolOutput(state: unknown): string {
  const content = (state as any)?.content
  const error = (state as any)?.error
  const parts: string[] = []
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item?.type === 'text' && item.text) parts.push(item.text)
      else if (item?.type === 'file') parts.push(item.path ?? item.filename ?? '')
    }
  }
  if (error) parts.push(error.message ?? JSON.stringify(error))
  return parts.filter(Boolean).join('\n')
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim())
  return line?.trim().slice(0, 80) ?? ''
}

/** 工具调用卡片：默认折叠成一行 */
function ToolCard(props: { name: string; state: unknown; time?: unknown }) {
  const status = () => toolStatus(props.state)
  const [open, setOpen] = createSignal(false)

  const input = () => toolInput(props.state)
  const output = () => toolOutput(props.state)

  return (
    <div class="tool" data-status={status()} data-open={open()}>
      <button class="tool-head" onClick={() => setOpen(!open())}>
        <span class="tool-icon">▸</span>
        <span class="tool-name">{props.name}</span>
        <span class="tool-arg">{firstLine(input())}</span>
        <span class="tool-status">
          <span class="dot" />
          {STATUS_LABEL[status()] ?? status()}
        </span>
        <span class="tool-chev">▶</span>
      </button>
      <Show when={open()}>
        <div class="tool-body">
          <Show when={input()}>
            <div class="tool-section">
              <div class="tool-label">参数</div>
              <pre>{input()}</pre>
            </div>
          </Show>
          <Show when={output()}>
            <div class="tool-section">
              <div class="tool-label">输出</div>
              <pre>{output()}</pre>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/** 一条消息 */
export default function Message(props: {
  msg: any
  index: number
  canRevert?: boolean
  onRevert?: (id: string) => void
  final?: boolean
  process?: Block[]
  running?: boolean
  images?: string[]
  onPreviewImage?: (url: string) => void
}) {
  const msg = () => props.msg

  return (
    <Show
      when={msg().type === 'user'}
      fallback={
        props.final ? (
          <AssistantMessage msg={msg()} final process={props.process} running={props.running} />
        ) : null
      }
    >
      <div class="msg-user-wrap">
        <Show when={props.canRevert && props.onRevert}>
          <button
            class="msg-revert"
            title="撤销这条消息"
            onClick={() => props.onRevert?.(msg().id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 14L4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
        </Show>
        <div class="msg-user">
          <span class="who">你</span>
          <Show when={props.images?.length}>
            <div class="msg-images">
              <For each={props.images}>
                {(url) => (
                  <img
                    src={url}
                    alt="图片"
                    onClick={() => props.onPreviewImage?.(url)}
                    onError={(event) => event.currentTarget.remove()}
                  />
                )}
              </For>
            </div>
          </Show>
          {msg().text}
        </div>
      </div>
    </Show>
  )
}

/** 判断代码块是不是 HTML，决定要不要显示预览按钮 */
function looksLikeHtml(code: string, pre: HTMLElement): boolean {
  if (/^\s*<!doctype html/i.test(code) || /^\s*<html[\s>]/i.test(code)) return true
  return Boolean(pre.querySelector('code.language-html'))
}

function AssistantMessage(props: {
  msg: any
  final?: boolean
  process?: Block[]
  running?: boolean
}) {
  const blocks = createMemo(() => toBlocks(props.msg?.content))
  const split = createMemo(() => splitBlocks(blocks()))
  const answerHtml = createMemo(() => (split().answer ? renderMarkdown(split().answer) : ''))
  const processBlocks = createMemo(() => props.process ?? split().process)
  const completed = createMemo(() => typeof props.msg?.time?.completed === 'number')
  // 整轮结束才算完成：会话不再运行、消息已完成、并且是该轮最后一条
  const turnDone = createMemo(() => completed() && Boolean(props.final) && !props.running)
  const duration = createMemo(() => {
    const created = props.msg?.time?.created
    const completedAt = props.msg?.time?.completed
    if (typeof created !== 'number' || typeof completedAt !== 'number') return null
    return Math.max(1, Math.round((completedAt - created) / 1000))
  })
  const [processOpen, setProcessOpen] = createSignal(!turnDone())

  createEffect(() => {
    if (!turnDone()) return
    // 用户手动展开着思考块时，整轮结束也不自动折叠
    const keepsOpen = processBlocks().some(
      (block) => block.kind === 'reasoning' && Boolean(block.key) && reasoningOpen.get(block.key!),
    )
    if (!keepsOpen) setProcessOpen(false)
  })

  let answerRef: HTMLDivElement | undefined

  // 渲染后给每个代码块加复制按钮
  createEffect(() => {
    answerHtml()
    const root = answerRef
    if (!root) return

    for (const pre of Array.from(root.querySelectorAll('pre'))) {
      const codeText = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''

      if (!pre.querySelector('.code-copy')) {
        pre.classList.add('has-copy')

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'code-copy'
        button.textContent = '复制'
        button.addEventListener('click', () => {
          navigator.clipboard
            .writeText(codeText)
            .then(() => {
              button.textContent = '已复制'
              setTimeout(() => {
                button.textContent = '复制'
              }, 1500)
            })
            .catch(() => {
              button.textContent = '复制失败'
              setTimeout(() => {
                button.textContent = '复制'
              }, 1500)
            })
        })

        pre.appendChild(button)
      }

      if (!pre.querySelector('.code-preview') && looksLikeHtml(codeText, pre)) {
        const preview = document.createElement('button')
        preview.type = 'button'
        preview.className = 'code-preview'
        preview.textContent = '预览'
        preview.addEventListener('click', () => void window.opencode.previewHtml(codeText))
        pre.appendChild(preview)
      }
    }
  })

  function onAnswerClick(event: MouseEvent) {
    const target = (event.target as HTMLElement | null)?.closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (!href) return
    event.preventDefault()
    if (/^https?:\/\//i.test(href)) {
      void window.opencode.openExternal(href)
    } else if (href.startsWith('file://')) {
      void window.opencode.openPath(decodeURIComponent(href.slice(7)))
    }
  }

  return (
    <Show when={blocks().length > 0}>
      <div class="msg-assistant">
        <Show when={processBlocks().length > 0}>
          <div class="process" data-open={processOpen()}>
            <button class="process-head" onClick={() => setProcessOpen(!processOpen())}>
              <span class="process-dot" classList={{ done: turnDone() }} />
              <span>{turnDone() ? `已完成${duration() !== null ? `，用时 ${duration()} 秒` : ''}` : '执行中…'}</span>
              <span class="process-chev">▶</span>
            </button>
            <Show when={processOpen()}>
              <div class="process-body">
                <For each={processBlocks()}>
                  {(block, index) => {
                    if (block.kind === 'reasoning') {
                      return (
                        <ReasoningBlock
                          text={block.text}
                          ms={block.ms}
                          stateKey={block.key ?? `${props.msg.id}:${index()}`}
                        />
                      )
                    }
                    if (block.kind === 'tool') {
                      return <ToolCard name={block.name} state={block.state} time={block.time} />
                    }
                    return <div class="process-text">{block.text}</div>
                  }}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={split().answer}>
          <div class="answer-bubble" classList={{ 'answer-bubble-mid': !props.final }}>
            <div class="answer" ref={answerRef} innerHTML={answerHtml()} onClick={onAnswerClick} />
          </div>
        </Show>
      </div>
    </Show>
  )
}
