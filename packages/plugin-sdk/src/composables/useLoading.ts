import { ref } from 'vue'

export function useLoading(initial = false) {
  const isLoading = ref(initial)

  async function withLoading<T>(fn: () => Promise<T>): Promise<T> {
    isLoading.value = true
    try {
      return await fn()
    } finally {
      isLoading.value = false
    }
  }

  function startLoading() {
    isLoading.value = true
  }

  function stopLoading() {
    isLoading.value = false
  }

  return { isLoading, withLoading, startLoading, stopLoading }
}
