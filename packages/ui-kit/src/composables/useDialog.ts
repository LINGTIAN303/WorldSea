import { ref } from 'vue'

interface DialogState {
  show: boolean
  title: string
  message: string
  mode: 'alert' | 'confirm' | 'prompt'
  inputValue: string
  inputPlaceholder: string
  resolve: ((val: boolean | string | null) => void) | null
}

const state = ref<DialogState>({
  show: false, title: '', message: '',
  mode: 'confirm', inputValue: '', inputPlaceholder: '',
  resolve: null,
})

export function useDialog() {
  function showDialog(mode: DialogState['mode'], title: string, message: string, defaultValue = ''): Promise<boolean | string | null> {
    return new Promise(resolve => {
      state.value = { show: true, title, message, mode, inputValue: defaultValue, inputPlaceholder: defaultValue ? '输入值…' : '', resolve }
    })
  }

  function confirm(message: string, title = '确认'): Promise<boolean> {
    return showDialog('confirm', title, message) as Promise<boolean>
  }

  function prompt(message: string, title = '输入', defaultValue = ''): Promise<string | null> {
    return showDialog('prompt', title, message, defaultValue) as Promise<string | null>
  }

  function alert(message: string, title = '提示'): Promise<null> {
    return showDialog('alert', title, message) as Promise<null>
  }

  function doResolve(value: boolean | string | null) {
    state.value.resolve?.(value)
    state.value.resolve = null
    state.value.show = false
  }

  return { state, confirm, prompt, alert, doResolve }
}
