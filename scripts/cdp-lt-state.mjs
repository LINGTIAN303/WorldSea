// 长任务实测 Phase B：状态机直测（心跳 / checkpoint / 取消 / 失败 / 恢复）
// 动态 import useLongTaskRust 直接驱动状态机 + invoke cmd_long_task_* 查 SQLite
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

  // 测试 1：心跳 + checkpoint 持久化
  console.log('===== 测试 1：心跳 + checkpoint =====')
  const t1 = await evalJs(`
    (async () => {
      const { useLongTaskRust } = await import('/apps/tauri/src/agent/composables/useLongTaskRust.ts');
      const lt = useLongTaskRust();
      const tid = await lt.startTask({
        type: 'main-agent',
        prompt: '心跳测试',
        lastUserText: '心跳测试',
        getCheckpointData: () => ({ agentMessages: [{ id: 'm1', role: 'user', content: '心跳测试', timestamp: Date.now() }], lastUserText: '心跳测试' }),
      });
      // checkpoint 更新
      lt.checkpoint(tid, { turnCount: 2, currentTool: 'entity_create', currentPhase: '执行' });
      const afterCheckpoint = { turn: lt.activeTask.value.turnCount, tool: lt.activeTask.value.currentTool };
      // 等心跳定时器跑一次（5s）+ flush
      await new Promise((r) => setTimeout(r, 6500));
      const hb1 = lt.activeTask.value.lastHeartbeatAt;
      await new Promise((r) => setTimeout(r, 5000));
      const hb2 = lt.activeTask.value.lastHeartbeatAt;
      return JSON.stringify({ tid, afterCheckpoint, hbAdvanced: hb2 > hb1, hbDeltaMs: hb2 - hb1 });
    })()
  `)
  console.log('[T1] 心跳+checkpoint:', t1)

  // 查 SQLite 持久化（心跳 + checkpoint 是否落库）
  const t1db = await evalJs(`
    (async () => {
      const T = window.__TAURI_INTERNALS__;
      const all = await T.invoke('cmd_long_task_list_all');
      const r = all.find((x) => x.taskId.includes('心跳测试') || x.meta && x.meta.prompt === '心跳测试');
      if (!r) return 'NOT_FOUND';
      const latest = all.filter((x) => x.status === 'running').sort((a, b) => b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt))[0];
      return JSON.stringify({
        latestRunningId: latest ? latest.taskId.slice(-12) : null,
        latestRunningHb: latest ? latest.lastHeartbeatAt : null,
        checkpointMsgs: latest ? (latest.checkpoint.agentMessages || []).length : 0,
        turn: latest ? latest.turnCount : null,
        tool: latest ? latest.currentTool : null,
      });
    })()
  `)
  console.log('[T1-db] SQLite 心跳+checkpoint:', t1db)

  // 测试 2：取消
  console.log('===== 测试 2：取消 =====')
  const t2 = await evalJs(`
    (async () => {
      const { useLongTaskRust } = await import('/apps/tauri/src/agent/composables/useLongTaskRust.ts');
      const lt = useLongTaskRust();
      // 先终结测试1的任务
      if (lt.activeTask.value) await lt.completeTask(lt.activeTask.value.taskId);
      const tid = await lt.startTask({
        type: 'main-agent',
        prompt: '取消测试',
        lastUserText: '取消测试',
        getCheckpointData: () => ({ agentMessages: [], lastUserText: '取消测试' }),
      });
      lt.requestCancel(tid);
      const cancelRequested = lt.isCancelRequested(tid);
      await lt.cancelTask(tid);
      const after = { activeNull: lt.activeTask.value === null, hb: lt.heartbeatStatus.value };
      return JSON.stringify({ tid, cancelRequested, after });
    })()
  `)
  console.log('[T2] 取消:', t2)
  const t2db = await evalJs(`
    (async () => {
      const T = window.__TAURI_INTERNALS__;
      const all = await T.invoke('cmd_long_task_list_all');
      const r = all.find((x) => x.meta && x.meta.prompt === '取消测试');
      return r ? JSON.stringify({ status: r.status, endedAt: r.endedAt }) : 'NOT_FOUND';
    })()
  `)
  console.log('[T2-db] SQLite 取消记录:', t2db)

  // 测试 3：失败
  console.log('===== 测试 3：失败 =====')
  const t3 = await evalJs(`
    (async () => {
      const { useLongTaskRust } = await import('/apps/tauri/src/agent/composables/useLongTaskRust.ts');
      const lt = useLongTaskRust();
      const tid = await lt.startTask({
        type: 'main-agent',
        prompt: '失败测试',
        lastUserText: '失败测试',
        getCheckpointData: () => ({ agentMessages: [], lastUserText: '失败测试' }),
      });
      await lt.failTask(tid, '模拟 LLM 调用失败');
      const after = { activeNull: lt.activeTask.value === null };
      return JSON.stringify({ tid, after });
    })()
  `)
  console.log('[T3] 失败:', t3)
  const t3db = await evalJs(`
    (async () => {
      const T = window.__TAURI_INTERNALS__;
      const all = await T.invoke('cmd_long_task_list_all');
      const r = all.find((x) => x.meta && x.meta.prompt === '失败测试');
      return r ? JSON.stringify({ status: r.status, endedAt: r.endedAt }) : 'NOT_FOUND';
    })()
  `)
  console.log('[T3-db] SQLite 失败记录:', t3db)

  // 测试 4：恢复（手动构造一个 running 记录 → detect → resume）
  console.log('===== 测试 4：恢复 =====')
  const t4 = await evalJs(`
    (async () => {
      const T = window.__TAURI_INTERNALS__;
      // 构造一个 running 记录（模拟刷新前未终结的任务）
      const fakeTaskId = 'longtask-main-agent-fakeresume-' + Date.now();
      await T.invoke('cmd_long_task_save', {
        record: {
          taskId: fakeTaskId,
          type: 'main-agent',
          status: 'running',
          startedAt: new Date(Date.now() - 60000).toISOString(),
          lastHeartbeatAt: new Date(Date.now() - 30000).toISOString(),
          turnCount: 3,
          currentTool: 'entity_create',
          checkpoint: { agentMessages: [{ id: 'rm', role: 'user', content: '恢复测试', timestamp: Date.now() }], lastUserText: '恢复测试' },
          meta: { prompt: '恢复测试' },
        },
      });
      const { useLongTaskRust } = await import('/apps/tauri/src/agent/composables/useLongTaskRust.ts');
      const lt = useLongTaskRust();
      const resumable = await lt.detectResumableTasks();
      const found = resumable.find((r) => r.taskId === fakeTaskId);
      if (!found) return 'NOT_FOUND';
      lt.resumeActiveTask(found, () => ({ agentMessages: [], lastUserText: '恢复测试' }));
      const resumed = {
        taskId: lt.activeTask.value ? lt.activeTask.value.taskId : null,
        status: lt.activeTask.value ? lt.activeTask.value.status : null,
        turn: lt.activeTask.value ? lt.activeTask.value.turnCount : null,
        hb: lt.heartbeatStatus.value,
        hasActive: lt.hasActiveTask.value,
      };
      // 等一次心跳（确认心跳重启）
      await new Promise((r) => setTimeout(r, 6000));
      const hbAfter = lt.activeTask.value ? lt.activeTask.value.lastHeartbeatAt : null;
      const hbAdvanced = hbAfter !== null && hbAfter > found.lastHeartbeatAt;
      // 清理：终结恢复的任务
      if (lt.activeTask.value) await lt.completeTask(lt.activeTask.value.taskId);
      return JSON.stringify({ resumed, hbAdvancedAfter6s: hbAdvanced, cleaned: lt.activeTask.value === null });
    })()
  `)
  console.log('[T4] 恢复:', t4)

  // 测试 5：清理所有遗留 running 任务（僵尸记录）
  console.log('===== 测试 5：清理遗留 running 任务 =====')
  const t5 = await evalJs(`
    (async () => {
      const { useLongTaskRust } = await import('/apps/tauri/src/agent/composables/useLongTaskRust.ts');
      const lt = useLongTaskRust();
      const running = await lt.detectResumableTasks();
      for (const r of running) {
        // 僵尸任务：无主，直接标记 cancelled（模拟应用中断未恢复）
        await lt.updateStatus(r.taskId, 'cancelled', Date.now());
      }
      const remaining = await lt.detectResumableTasks();
      return JSON.stringify({ cleanedCount: running.length, remainingCount: remaining.length });
    })()
  `)
  console.log('[T5] 清理僵尸任务:', t5)

  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
