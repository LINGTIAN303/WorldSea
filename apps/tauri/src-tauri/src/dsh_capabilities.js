/* worldsea-shell:capabilities —— Agent 面（主窗）的能力伺服（A，2026-09-25）。
   协议（见 docs/plans/2026-09-25-双Cordis-DA批计划.md §二）：
   - 壳在**提供方窗口** eval `globalThis.__WORLDSEA_CAPABILITY_CALL__(callId, id, args)`；
   - 本脚本查本地 handler 表 → `Promise.resolve(handler(args))` → 回执 `cmd_capability_result`；
   - 缺 handler / 同步抛错 → 立即回执失败（不让调用方白等超时）；handler 内部错误 → 异步回执错误。
   登记：脚本尾部 `cmd_capability_register`（provider = 本窗 label 'main'，壳侧按窗口判定、不可冒名）。
   反证开关：WORLDSEA_NO_CAPABILITY_BRIDGE=1（壳侧不注入本脚本 → agent 提供方缺席，调用方应报 UNKNOWN）。 */
(function () {
  var ipc = globalThis.__TAURI_INTERNALS__;
  var invoke = ipc && ipc.invoke;
  if (typeof invoke !== 'function') {
    console.warn('[worldsea-capability] 壳桥不可用（无 __TAURI_INTERNALS__）：跳过能力伺服装配');
    return;
  }

  /** Agent 面自有能力：只报**本页可观测**的事实，不代办 Agent 语义（那是 dsh 的事）。 */
  var caps = {
    'agent.face.status': function () {
      return {
        label: 'main',
        theme: globalThis.__WORLDSEA_THEME__ || null,
        dark: globalThis.__WORLDSEA_DARK__ === true,
        // 宿主尾行把就绪标置为 Promise（??= Promise.withResolvers()），故取真值而非严格等于 true
        bootReady: Boolean(globalThis.__DSH_BOOT_READY__),
        transport: Object.keys(globalThis.__DSH_TRANSPORT__ || {}),
      };
    },
  };

  function reply(callId, ok, result, error) {
    invoke('cmd_capability_result', { callId: callId, ok: ok, result: result, error: error }).catch(function (e) {
      console.warn('[worldsea-capability] 回执失败：' + String((e && e.message) || e));
    });
  }

  globalThis.__WORLDSEA_CAPABILITY_CALL__ = function (callId, id, args) {
    var handler = caps[id];
    if (typeof handler !== 'function') {
      reply(callId, false, null, 'CAPABILITY_UNKNOWN: 本窗口（main）未登记 ' + id);
      return;
    }
    Promise.resolve()
      .then(function () {
        return handler(args || {});
      })
      .then(function (result) {
        reply(callId, true, result === undefined ? null : result, null);
      })
      .catch(function (error) {
        reply(callId, false, null, String((error && error.message) || error));
      });
  };

  invoke('cmd_capability_register', {
    decls: [
      {
        id: 'agent.face.status',
        summary: 'Agent 面（dsh 客户端页）就绪与主题快照：bootReady / theme / dark / transport',
        params: [],
        acl: ['workspace'],
      },
    ],
  })
    .then(function (count) {
      console.log('[worldsea-capability] 已登记 ' + count + ' 条（provider=main）');
    })
    .catch(function (error) {
      console.warn('[worldsea-capability] 登记失败：' + String((error && error.message) || error));
    });
})();
