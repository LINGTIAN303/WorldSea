import { ref } from 'vue'
import { toastError } from '@worldsea/ui-kit'

export type ErrorCategory = 'network' | 'data' | 'permission' | 'generic'

interface ErrorState {
  hasError: boolean
  category: ErrorCategory
  message: string
}

export function useErrorHandler() {
  const errorState = ref<ErrorState>({
    hasError: false,
    category: 'generic',
    message: '',
  })

  function handleError(error: unknown, category: ErrorCategory = 'generic') {
    const message = error instanceof Error ? error.message : String(error)
    errorState.value = { hasError: true, category, message }
    toastError(message)
  }

  function clearError() {
    errorState.value = { hasError: false, category: 'generic', message: '' }
  }

  function wrapAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    category: ErrorCategory = 'generic',
  ): T {
    return (async (...args: any[]) => {
      try {
        clearError()
        return await fn(...args)
      } catch (e) {
        handleError(e, category)
        throw e
      }
    }) as T
  }

  return { errorState, handleError, clearError, wrapAsync }
}
