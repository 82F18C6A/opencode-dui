import { For, Show, createMemo, createSignal } from 'solid-js'

type Model = {
  id: string
  modelID?: string
  providerID: string
  name?: string
  status?: string
  enabled?: boolean
}

function isFree(model: Model): boolean {
  return /free/i.test(`${model.id} ${model.name ?? ''}`)
}

/** 模型选择弹层：按 provider 分组；OpenRouter 默认只列免费模型 */
export default function ModelPicker(props: {
  models: Model[]
  current?: { id?: string }
  onPick: (model: Model) => void
  onClose: () => void
}) {
  const [showAll, setShowAll] = createSignal(false)

  const visible = createMemo(() =>
    props.models.filter((model) => {
      if (model.enabled === false) return false
      // OpenRouter 上除免费模型外都需要余额，默认藏起来
      if (!showAll() && model.providerID === 'openrouter' && !isFree(model)) return false
      return true
    }),
  )

  const grouped = createMemo(() => {
    const map = new Map<string, Model[]>()
    for (const model of visible()) {
      const key = model.providerID ?? 'other'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(model)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })

  const hiddenCount = createMemo(() => props.models.length - visible().length)

  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="picker" onClick={(event) => event.stopPropagation()}>
        <div class="picker-head">
          <div class="picker-title">选择模型</div>
          <div class="picker-count">{visible().length} 个可用</div>
        </div>

        <div class="picker-list">
          <For each={grouped()}>
            {([provider, items]) => (
              <div class="picker-group">
                <div class="picker-provider">
                  {provider}
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

        <Show when={hiddenCount() > 0 || showAll()}>
          <label class="picker-toggle">
            <input
              type="checkbox"
              checked={showAll()}
              onChange={(event) => setShowAll(event.currentTarget.checked)}
            />
            <span>
              {showAll() ? '只看免费模型' : `显示其余 ${hiddenCount()} 个（含需要余额的 OpenRouter 模型）`}
            </span>
          </label>
        </Show>
      </div>
    </div>
  )
}
