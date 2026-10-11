import { ref, readonly, onScopeDispose, getCurrentScope } from 'vue'

const _prefersReduced = ref(false)

let _consumerCount = 0
let _mediaQuery: MediaQueryList | null = null

function initMediaQuery() {
  if (_mediaQuery || typeof window === 'undefined') return
  _mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  _prefersReduced.value = _mediaQuery.matches
  _mediaQuery.addEventListener('change', onChange)
}

function onChange(e: MediaQueryListEvent) {
  _prefersReduced.value = e.matches
}

function release() {
  _consumerCount--
  if (_consumerCount <= 0) {
    _consumerCount = 0
    if (_mediaQuery) {
      _mediaQuery.removeEventListener('change', onChange)
      _mediaQuery = null
    }
  }
}

export function useReducedMotion() {
  _consumerCount++
  initMediaQuery()

  if (getCurrentScope()) {
    onScopeDispose(() => {
      release()
    })
  }

  return {
    prefersReducedMotion: readonly(_prefersReduced),
  }
}

export function isReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
