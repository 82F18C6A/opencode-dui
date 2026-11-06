import { For, Show, createSignal, createMemo } from 'solid-js'
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

/** 推理块：默认折叠成一行，展开后是淡化的小字 */
function ReasoningBlock(props: { text: string; ms?: number }) {
  const [open, setOpen] = createSignal(false)
  const seconds = createMemo(() => {
    if (props.ms === undefined) return null
    return Math.max(1, Math.round(props.ms / 1000))
  })

  return (
    <div class="reasoning" data-open={open()}>
      <button class="reasoning-head" onClick={() => setOpen(!open())}>
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

/** 工具调用卡片：默认折叠成一行，失败时默认展开 */
function ToolCard(props: { name: string; state: unknown; time?: unknown }) {
  const status = () => toolStatus(props.state)
  const [open, setOpen] = createSignal(status() === 'error')

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
export default function Message(props: { msg: any; index: number }) {
  const msg = () => props.msg

  return (
    <Show when={msg().type === 'user'} fallback={<AssistantMessage msg={msg()} />}>
      <div class="msg-user">
        <span class="who">你</span>
        {msg().text}
      </div>
    </Show>
  )
}

function AssistantMessage(props: { msg: any }) {
  const blocks = createMemo(() => toBlocks(props.msg?.content))
  const split = createMemo(() => splitBlocks(blocks()))
  const answerHtml = createMemo(() => (split().answer ? renderMarkdown(split().answer) : ''))

  return (
    <Show when={blocks().length > 0}>
      <div class="msg-assistant">
        <For each={split().process}>
          {(block: Block) => {
            if (block.kind === 'reasoning') return <ReasoningBlock text={block.text} ms={block.ms} />
            if (block.kind === 'tool') return <ToolCard name={block.name} state={block.state} time={block.time} />
            return null
          }}
        </For>
        <Show when={split().answer}>
          <div class="answer-bubble">
            <div class="answer" innerHTML={answerHtml()} />
          </div>
        </Show>
      </div>
    </Show>
  )
}
