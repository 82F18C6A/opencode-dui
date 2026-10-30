// 把 assistant 消息的 content 数组归并成可渲染的块
export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string; ms?: number }
  | { kind: 'tool'; id: string; name: string; state: unknown; time?: unknown }

export function toBlocks(content: readonly unknown[] | undefined): Block[] {
  const out: Block[] = []
  for (const raw of content ?? []) {
    const item = raw as Record<string, any>
    if (!item || typeof item !== 'object') continue

    if (item.type === 'text') {
      const last = out[out.length - 1]
      if (last && last.kind === 'text') {
        last.text += `\n\n${item.text ?? ''}`
      } else {
        out.push({ kind: 'text', text: item.text ?? '' })
      }
      continue
    }

    if (item.type === 'reasoning') {
      const created = item.time?.created
      const completed = item.time?.completed
      const ms = typeof created === 'number' && typeof completed === 'number' ? completed - created : undefined
      out.push({ kind: 'reasoning', text: item.text ?? '', ms })
      continue
    }

    if (item.type === 'tool') {
      out.push({ kind: 'tool', id: item.id, name: item.name ?? 'tool', state: item.state, time: item.time })
    }
  }
  return out
}

export function splitBlocks(blocks: Block[]): { process: Block[]; answer: string } {
  const process: Block[] = []
  const texts: string[] = []
  for (const block of blocks) {
    if (block.kind === 'text') texts.push(block.text)
    else process.push(block)
  }
  return { process, answer: texts.join('\n\n').trim() }
}
