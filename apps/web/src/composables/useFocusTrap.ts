import { ref, watch, onBeforeUnmount, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]',
  'details > summary',
].join(', ')

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  return elements.filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('tabindex') === '-1') return false
    if (el.closest('[inert]')) return false
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
  })
}

export function useFocusTrap(containerRef: Ref<HTMLElement | null>, options: {
  active?: Ref<boolean>
  restoreFocus?: boolean
  escapeDeactivates?: boolean
  onEscape?: () => void
} = {}) {
  const {
    active,
    restoreFocus: shouldRestoreFocus = true,
    escapeDeactivates = true,
    onEscape,
  } = options

  let previouslyFocusedElement: HTMLElement | null = null
  const isTrapping = ref(false)

  function saveFocus() {
    previouslyFocusedElement = document.activeElement as HTMLElement | null
  }

  function restoreFocus() {
    if (!shouldRestoreFocus) return
    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
      previouslyFocusedElement.focus()
    }
    previouslyFocusedElement = null
  }

  function focusFirstElement() {
    const container = containerRef.value
    if (!container) return
    const focusable = getFocusableElements(container)
    if (focusable.length > 0) {
      focusable[0].focus()
    } else {
      container.setAttribute('tabindex', '-1')
      container.focus()
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (!isTrapping.value) return

    if (e.key === 'Escape' && escapeDeactivates) {
      e.preventDefault()
      e.stopImmediatePropagation()
      onEscape?.()
      return
    }

    if (e.key !== 'Tab') return

    const container = containerRef.value
    if (!container) return

    const focusable = getFocusableElements(container)
    if (focusable.length === 0) {
      e.preventDefault()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const activeEl = document.activeElement

    if (e.shiftKey) {
      if (activeEl === first || !container.contains(activeEl)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function activate() {
    if (isTrapping.value) return
    saveFocus()
    isTrapping.value = true
    document.addEventListener('keydown', onKeydown, true)
    requestAnimationFrame(() => {
      focusFirstElement()
    })
  }

  function deactivate() {
    if (!isTrapping.value) return
    isTrapping.value = false
    document.removeEventListener('keydown', onKeydown, true)
    restoreFocus()
  }

  if (active) {
    watch(active, (val) => {
      if (val) {
        activate()
      } else {
        deactivate()
      }
    }, { immediate: true })
  }

  onBeforeUnmount(() => {
    deactivate()
  })

  return {
    isTrapping,
    activate,
    deactivate,
  }
}
