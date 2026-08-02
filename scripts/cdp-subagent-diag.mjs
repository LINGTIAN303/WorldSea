// 子 Agent 实测：动态 import 模块直测 createRustAgent（等价 createSubBackend 核心逻辑：
// 独立 Rust 会话 + prompt 等 agent_end + 返回末条 assistant 内容 + dispose）
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url))
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  console.log('[1] ws connected')
  let msgId = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    let d; try { d = JSON.parse(e.data) } catch { return }
    if (d.id != null) { const p = pending.get(d.id); if (p) { pending.delete(d.id); p(d) } }
  }
  const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value ?? r.result?.result?.description ?? JSON.stringify(r.result)
  }

  const result = await evalJs(`
    (async () => {
      try {
        const { createRustAgent } = await import('/src/agent/composables/useAgentRust.ts');
        const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
        const { loadApiKey } = await import('/packages/agent-runtime/src/providers/key-store.ts');

        const settings = useSettingsStore();
        const mode = settings.aiProviderMode;
        if (mode !== 'cloud') return 'SKIP: 非 cloud 模式，跳过（当前 mode=' + mode + '）';
        const apiKey = await loadApiKey(settings.aiCloudProvider);
        if (!apiKey) return 'FAIL: 无 API key';

        const config = {
          mode: 'cloud',
          provider: settings.aiCloudProvider,
          model_id: settings.aiCloudModel,
          api_key: apiKey,
        };

        const sessionId = 'rust_sub_diag_' + Date.now();
        const sub = await createRustAgent(sessionId, config, { thinkingLevel: 'off' });

        // 先注册完成监听再 prompt（等价 createSubBackendImpl 的等待逻辑）
        const done = new Promise((resolve) => {
          const unsub = sub.subscribe((e) => {
            if (e.type === 'agent_end' || e.type === 'error') { unsub(); resolve(e.type); }
          });
        });
        await sub.prompt('请用一句话介绍你自己（不超过 20 字）');
        const endType = await Promise.race([done, new Promise((r) => setTimeout(r, 30000)).then(() => 'timeout')]);

        const msgs = sub.getRuntimeMessages();
        const last = [...msgs].reverse().find((m) => m.role === 'assistant');
        const content = last && last.content ? String(last.content).slice(0, 200) : '';

        sub.dispose();
        return JSON.stringify({
          endType,
          msgCount: msgs.length,
          hasAssistant: !!last,
          content,
          sessionId,
        });
      } catch (e) {
        return 'FAIL:' + String(e && e.message || e);
      }
    })()
  `)
  console.log('[2] 子 Agent 实测:', result)

  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
