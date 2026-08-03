import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

export interface KeySequenceDef {
  sequence: string
  action: () => void
  description: string
}

export function useKeySequence(options: {
  sequences: KeySequenceDef[]
  singleKeys?: Record<string, () => void>
  timeout?: number
}) {
  const timeout = options.timeout ?? 500
  const currentSequence = ref('')
  const isActive = ref(false)

  const sequenceMap = new Map<string, () => void>()
  const descMap = new Map<string, string>()
  for (const def of options.sequences) {
    sequenceMap.set(def.sequence, def.action)
    descMap.set(def.sequence, def.description)
  }

  const availableNext = computed(() => {
    if (!currentSequence.value) return []
    const prefix = currentSequence.value + ' '
    const nexts: { key: string; desc: string }[] = []
    for (const [seq, _action] of sequenceMap) {
      if (seq.startsWith(prefix)) {
        const remainder = seq.slice(prefix.length)
        if (!remainder.includes(' ')) {
          nexts.push({ key: remainder, desc: descMap.get(seq) || '' })
        }
      }
    }
    return nexts
  })

  let timer: ReturnType<typeof setTimeout> | null = null

  function clearSequence() {
    currentSequence.value = ''
    isActive.value = false
    if (timer) { clearTimeout(timer); timer = null }
  }

  function handleKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (e.ctrlKey || e.altKey || e.metaKey) return

    const key = e.key.toLowerCase()

    if (options.singleKeys && key in options.singleKeys) {
      e.preventDefault()
      options.singleKeys[key]()
      return
    }

    if (key === 'escape') {
      clearSequence()
      return
    }

    if (key.length !== 1) return

    e.preventDefault()
    isActive.value = true

    if (currentSequence.value) {
      currentSequence.value += ' ' + key
    } else {
      currentSequence.value = key
    }

    if (timer) clearTimeout(timer)
    timer = setTimeout(clearSequence, timeout)

    const action = sequenceMap.get(currentSequence.value)
    if (action) {
      action()
      clearSequence()
    }
  }

  onMounted(() => { window.addEventListener('keydown', handleKeydown) })
  onBeforeUnmount(() => { window.removeEventListener('keydown', handleKeydown); clearSequence() })

  return { currentSequence, availableNext, isActive, clearSequence }
}
