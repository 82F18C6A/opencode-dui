import { For, createMemo } from 'solid-js'

type Model = {
  id: string
  modelID?: string
  providerID: string
  name?: string
  status?: string
  enabled?: boolean
}

// 品牌展示顺序
const BRAND_ORDER = [
  'deepseek',
  'glm',
  'kimi',
  'gpt',
  'claude',
  'gemini',
  'qwen',
  'mimo',
  'minimax',
  'longcat',
  'grok',
]

// 分组顺序
const GROUP_ORDER = ['opencode-free', 'opencode-go', 'deepseek', 'openrouter']

function isFree(model: Model): boolean {
  return /free/i.test(`${model.id} ${model.name ?? ''}`)
}

/** 品牌在排序里的位置 */
function brandIndex(model: Model): number {
  const text = `${model.id} ${model.name ?? ''}`.toLowerCase()
  const index = BRAND_ORDER.findIndex((brand) => text.includes(brand))
  return index === -1 ? BRAND_ORDER.length : index
}

/** 按品牌过滤后归属的分组，null 表示不显示 */
function groupOf(model: Model): string | null {
  if (model.enabled === false) return null
  const text = `${model.id} ${model.name ?? ''}`.toLowerCase()
  const branded = BRAND_ORDER.some((brand) => text.includes(brand))

  if (model.providerID === 'opencode') {
    if (!branded) return null
    return isFree(model) ? 'opencode-free' : 'opencode-go'
  }

  if (model.providerID === 'openrouter') {
    return branded && isFree(model) ? 'openrouter' : null
  }

  if (model.providerID === 'deepseek') {
    return branded ? 'deepseek' : null
  }

  return null
}

/** 模型选择弹层：只显示指定品牌，opencode 按免费/付费分组 */
export default function ModelPicker(props: {
  models: Model[]
  current?: { id?: string }
  onPick: (model: Model) => void
  onClose: () => void
}) {
  const grouped = createMemo(() => {
    const map = new Map<string, Model[]>()
    for (const model of props.models) {
      const key = groupOf(model)
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(model)
    }

    const index = (key: string) => {
      const position = GROUP_ORDER.indexOf(key)
      return position === -1 ? GROUP_ORDER.length : position
    }

    // 组内按品牌顺序排，品牌内保持原顺序
    for (const items of map.values()) {
      items.sort((a, b) => brandIndex(a) - brandIndex(b))
    }

    return [...map.entries()].sort((a, b) => {
      const diff = index(a[0]) - index(b[0])
      return diff !== 0 ? diff : a[0].localeCompare(b[0])
    })
  })

  const total = createMemo(() => grouped().reduce((sum, [, items]) => sum + items.length, 0))

  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="picker" onClick={(event) => event.stopPropagation()}>
        <div class="picker-head">
          <div class="picker-title">选择模型</div>
          <div class="picker-count">{total()} 个可用</div>
        </div>

        <div class="picker-list">
          <For each={grouped()}>
            {([group, items]) => (
              <div class="picker-group">
                <div class="picker-provider">
                  {group}
                  <span class="picker-provider-count">{items.length}</span>
                </div>
                <For each={items}>
                  {(model) => (
                    <button
                      class="picker-item"
                      classList={{ active: model.id === props.current?.id }}
                      onClick={() => props.onPick(model)}
                    >
                      <span class="picker-name">{model.name || model.modelID || model.id}</span>
                      <span class="picker-meta">{model.status ?? ''}</span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
