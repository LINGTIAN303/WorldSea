import { ref, onBeforeUnmount } from 'vue'

const EXECUTION_TIMEOUT = 5000

export type CodeLanguage = 'javascript' | 'typescript' | 'json' | 'python'

export function useCodeSandbox() {
  const output = ref('')
  const isRunning = ref(false)
  let currentIframe: HTMLIFrameElement | null = null

  function killIframe(): void {
    if (currentIframe) {
      try { currentIframe.remove() } catch {}
      currentIframe = null
    }
  }

  async function execute(code: string, language: CodeLanguage): Promise<string> {
    if (isRunning.value) return '正在执行中...'
    if (!code.trim()) return '(无代码)'

    if (language === 'json') {
      return executeJson(code)
    }

    if (language === 'python') {
      return 'Python 执行需要 Pyodide 运行时（约 10MB），暂未加载。请使用 JavaScript。'
    }

    let jsCode = code
    if (language === 'typescript') {
      jsCode = await transpileTypeScript(code)
      if (jsCode.startsWith('ERROR:')) return jsCode
    }

    return executeInIframe(jsCode)
  }

  function executeJson(code: string): string {
    try {
      const parsed = JSON.parse(code)
      return JSON.stringify(parsed, null, 2)
    } catch (err: any) {
      return 'JSON 解析错误: ' + (err?.message || String(err))
    }
  }

  async function transpileTypeScript(code: string): Promise<string> {
    try {
      const ts = await import('typescript')
      const result = ts.transpileModule(code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.None,
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
      })
      return result.outputText
    } catch (err: any) {
      return 'ERROR: TypeScript 转译失败 — ' + (err?.message || String(err))
    }
  }

  function executeInIframe(code: string): Promise<string> {
    return new Promise((resolve) => {
      killIframe()
      isRunning.value = true

      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.sandbox.add('allow-scripts')
      currentIframe = iframe

      const timeout = setTimeout(() => {
        killIframe()
        isRunning.value = false
        resolve('执行超时（5秒限制）')
      }, EXECUTION_TIMEOUT)

      function onMessage(event: MessageEvent) {
        if (event.data?.type === 'code-output' && event.source === iframe.contentWindow) {
          clearTimeout(timeout)
          window.removeEventListener('message', onMessage)
          killIframe()
          isRunning.value = false
          const logs = event.data.logs || []
          resolve(logs.length > 0 ? logs.join('\n') : '(无输出)')
        }
      }
      window.addEventListener('message', onMessage)

      const escapedCode = code.replace(/<\/script>/gi, '<\\/script>')
      const srcdoc = `<!DOCTYPE html><html><head><script>
        const __logs = [];
        const console = {
          log: (...a) => __logs.push(a.map(v => typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)).join(' ')),
          error: (...a) => __logs.push('ERROR: ' + a.map(v => typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)).join(' ')),
          warn: (...a) => __logs.push('WARN: ' + a.map(String).join(' ')),
          info: (...a) => __logs.push(a.map(String).join(' ')),
        };
        const window = undefined;
        const document = undefined;
        const self = undefined;
        const top = undefined;
        const parent = undefined;
        try {
          ${escapedCode}
        } catch(e) {
          __logs.push('ERROR: ' + (e.message || String(e)));
        }
        parent.postMessage({ type: 'code-output', logs: __logs }, '*');
      <\/script></head><body></body></html>`

      iframe.srcdoc = srcdoc
      document.body.appendChild(iframe)
    })
  }

  onBeforeUnmount(() => {
    killIframe()
  })

  return {
    output,
    isRunning,
    execute,
  }
}
