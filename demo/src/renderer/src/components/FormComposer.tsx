import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'

export type FormOption = {
  value: string
  label: string
  description?: string
}

export type FormField = {
  key: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external'
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  default?: string | number | boolean | string[]
  placeholder?: string
  format?: string
  options?: FormOption[]
  custom?: boolean
  minimum?: number | string
  maximum?: number | string
  url?: string
}

export type FormInfo = {
  id: string
  sessionID: string
  title: string
  fields: FormField[]
}

type FormAnswer = Record<string, string | number | boolean | string[]>

/** 按字段默认值生成初始答案 */
function initialAnswers(form: FormInfo): FormAnswer {
  const result: FormAnswer = {}
  for (const field of form.fields) {
    if (field.default !== undefined) {
      result[field.key] = field.default
    } else if (field.type === 'boolean') {
      result[field.key] = false
    } else if (field.type === 'multiselect') {
      result[field.key] = []
    } else {
      result[field.key] = ''
    }
  }
  return result
}

/** 问题卡片：替换输入区，回答 agent 的提问 */
export default function FormComposer(props: {
  form: FormInfo
  submitting: boolean
  onSubmit: (answer: FormAnswer) => void
  onCancel: () => void
}) {
  const [answers, setAnswers] = createSignal<FormAnswer>(initialAnswers(props.form))
  const [customs, setCustoms] = createSignal<Record<string, string>>({})
  let loadedFormId = props.form.id

  createEffect(() => {
    // 只有切换到另一张表单时才重置，轮询刷新同 id 的表单不影响输入
    const form = props.form
    if (!form || form.id === loadedFormId) return
    loadedFormId = form.id
    setAnswers(initialAnswers(form))
    setCustoms({})
  })

  function customValue(key: string): string {
    return customs()[key] ?? ''
  }

  function setCustom(key: string, value: string) {
    setCustoms((prev) => ({ ...prev, [key]: value }))
  }

  const visibleFields = createMemo(() => props.form.fields.filter((field) => !field.hidden))

  const valid = createMemo(() =>
    visibleFields().every((field) => {
      if (!field.required) return true
      const value = answers()[field.key]
      const custom = customValue(field.key).trim()
      if (Array.isArray(value)) return value.length > 0 || custom !== ''
      if (typeof value === 'boolean') return true
      return custom !== '' || (value !== undefined && String(value).trim() !== '')
    }),
  )

  function setValue(key: string, value: FormAnswer[string]) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  function submit() {
    if (!valid() || props.submitting) return
    const payload: FormAnswer = {}
    for (const field of visibleFields()) {
      if (field.type === 'external') continue
      const custom = customValue(field.key).trim()
      // 多选：选项和自定义文本一起提交
      if (field.type === 'multiselect') {
        const value = answers()[field.key]
        const list = Array.isArray(value) ? [...value] : []
        if (custom) list.push(custom)
        payload[field.key] = list
        continue
      }
      // 单选：自定义输入优先于选项
      if (field.type === 'string' && field.options?.length && field.custom && custom) {
        payload[field.key] = custom
        continue
      }
      const value = answers()[field.key]
      if (field.type === 'number' || field.type === 'integer') {
        const num = Number(value)
        if (!Number.isNaN(num)) payload[field.key] = num
      } else {
        payload[field.key] = value
      }
    }
    props.onSubmit(payload)
  }

  return (
    <div class="form-composer">
      <div class="form-composer-head">
        <span class="form-composer-title">{props.form.title}</span>
        <button class="form-composer-close" title="取消提问" onClick={props.onCancel}>
          ×
        </button>
      </div>

      <div class="form-composer-body">
        <For each={visibleFields()}>
          {(field) => (
            <div class="form-field">
              <Show when={field.type !== 'boolean' && (field.title || field.description)}>
                <div class="form-field-head">
                  <span class="form-field-title">
                    {field.title ?? field.key}
                    <Show when={field.required}>
                      <span class="form-required"> *</span>
                    </Show>
                  </span>
                  <Show when={field.description}>
                    <span class="form-field-desc">{field.description}</span>
                  </Show>
                </div>
              </Show>

              <Show when={field.type === 'string' && field.options?.length}>
                <div class="form-options">
                  <For each={field.options}>
                    {(option) => (
                      <button
                        type="button"
                        class="form-option"
                        classList={{ selected: answers()[field.key] === option.value }}
                        onClick={() => setValue(field.key, option.value)}
                      >
                        <span class="form-option-label">{option.label}</span>
                        <Show when={option.description}>
                          <span class="form-option-desc">{option.description}</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={field.type === 'string' && field.options?.length && field.custom}>
                <input
                  class="form-input form-custom"
                  type="text"
                  value={customValue(field.key)}
                  placeholder="或输入自定义答案…"
                  onInput={(event) => {
                    setCustom(field.key, event.currentTarget.value)
                    // 输入自定义答案时取消已选选项
                    if (event.currentTarget.value) setValue(field.key, '')
                  }}
                />
              </Show>

              <Show when={field.type === 'string' && !field.options?.length}>
                <input
                  class="form-input"
                  type={field.format === 'email' ? 'email' : field.format === 'uri' ? 'url' : 'text'}
                  value={String(answers()[field.key] ?? '')}
                  placeholder={field.placeholder ?? ''}
                  onInput={(event) => setValue(field.key, event.currentTarget.value)}
                />
              </Show>

              <Show when={field.type === 'number' || field.type === 'integer'}>
                <input
                  class="form-input"
                  type="number"
                  value={String(answers()[field.key] ?? '')}
                  min={field.minimum !== undefined ? Number(field.minimum) : undefined}
                  max={field.maximum !== undefined ? Number(field.maximum) : undefined}
                  step={field.type === 'integer' ? 1 : 'any'}
                  onInput={(event) => setValue(field.key, event.currentTarget.value)}
                />
              </Show>

              <Show when={field.type === 'boolean'}>
                <label class="form-check">
                  <input
                    type="checkbox"
                    checked={Boolean(answers()[field.key])}
                    onChange={(event) => setValue(field.key, event.currentTarget.checked)}
                  />
                  <span>{field.title ?? field.key}</span>
                </label>
              </Show>

              <Show when={field.type === 'multiselect'}>
                <div class="form-options">
                  <For each={field.options ?? []}>
                    {(option) => {
                      const selected = () => {
                        const value = answers()[field.key]
                        return Array.isArray(value) && value.includes(option.value)
                      }
                      return (
                        <button
                          type="button"
                          class="form-option"
                          classList={{ selected: selected() }}
                          onClick={() => {
                            const current = answers()[field.key]
                            const list = Array.isArray(current) ? [...current] : []
                            if (selected()) {
                              const index = list.indexOf(option.value)
                              if (index >= 0) list.splice(index, 1)
                            } else {
                              list.push(option.value)
                            }
                            setValue(field.key, list)
                          }}
                        >
                          <span class="form-option-label">{option.label}</span>
                          <Show when={option.description}>
                            <span class="form-option-desc">{option.description}</span>
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </Show>

              <Show when={field.type === 'multiselect' && (field.custom || !field.options?.length)}>
                <input
                  class="form-input form-custom"
                  type="text"
                  value={customValue(field.key)}
                  placeholder="或输入自定义答案…"
                  onInput={(event) => setCustom(field.key, event.currentTarget.value)}
                />
              </Show>

              <Show when={field.type === 'external'}>
                <a class="form-link" href={field.url} target="_blank" rel="noreferrer">
                  {field.title ?? field.url}
                </a>
              </Show>
            </div>
          )}
        </For>
      </div>

      <div class="form-composer-foot">
        <button class="ghost" onClick={props.onCancel}>
          取消
        </button>
        <button class="primary" disabled={props.submitting || !valid()} onClick={submit}>
          {props.submitting ? '提交中…' : '提交'}
        </button>
      </div>
    </div>
  )
}
