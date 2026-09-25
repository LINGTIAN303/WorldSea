// A（2026-09-25）：壳侧能力桥——类型化能力注册表 + 调用 ACL + 中转 + 审计。
//
// 口径（见 docs/plans/2026-09-25-双Cordis-DA批计划.md §二）：
// - 三侧角色：**product**（工作台窗 = 世界语义提供方）/ **agent**（主窗 = Agent 面）/
//   **shell**（壳自身：注册表 + ACL + 中转 + 审计；v1 只做桥不做提供方，扩展位=PROVIDERS 收编）。
// - **提供方 = 注册时调用的窗口 label**（不可冒名）；同 id 异提供方 → 拒绝；同提供方重复 → 覆盖。
// - 调用：ACL 校验 → 在提供方窗口 `eval` 派发 `__WORLDSEA_CAPABILITY_CALL__(callId, id, args)`
//   → 提供方回执 `cmd_capability_result`。用 eval 派发（E2 已验证的模式，两窗皆通）而非事件/Channel：
//   两端同一套派发协议、Rust 侧一条路径，不新增前端监听面。
// - 超时 10s：`std::thread::sleep` 兜底（不引 tokio/time）；错误码前缀结构化，便于前端判别。
// - 审计：登记与每次调用打 `[WORLDSEA-CAP]` 壳日志。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

/// 允许作为提供方/调用方的窗口 label（v1 两窗；壳自身作为提供方的扩展位在 D2 启用）。
pub const PROVIDERS: [&str; 2] = ["main", "workspace"];
/// 调用超时（提供方未回执即判超时；壳不阻塞——invoke 是 async 命令）。
pub const CALL_TIMEOUT: Duration = Duration::from_secs(10);

/// 能力声明的参数（类型化内省用；不做运行时校验——v1 参数由提供方 handler 自行判定）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityParam {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub required: bool,
}

/// 提供方登记的能力声明。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityDecl {
    pub id: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub params: Vec<CapabilityParam>,
    /// 可调用方（窗口 label）；空数组 = 无人可调（显式 deny，非「默认放行」）。
    #[serde(default)]
    pub acl: Vec<String>,
}

/// 注册表记录（内省形状：调用方据此发现面）。
#[derive(Debug, Clone, Serialize)]
pub struct CapabilityRecord {
    pub id: String,
    pub summary: String,
    pub params: Vec<CapabilityParam>,
    pub acl: Vec<String>,
    pub provider: String,
}

struct PendingCall {
    provider: String,
    started: Instant,
    tx: Option<tokio::sync::oneshot::Sender<Result<Value, String>>>,
}

/// 注册表（进程级内存态；窗口页面重载后由提供方脚本重跑重登记）。
static REGISTRY: Mutex<Vec<CapabilityRecord>> = Mutex::new(Vec::new());
/// 在途调用（callId → 等待中的回执通道）。
static PENDING: Mutex<Vec<(String, PendingCall)>> = Mutex::new(Vec::new());
/// callId 序号（进程内唯一即可：提供方回执按 callId 认领）。
static CALL_SEQ: AtomicU64 = AtomicU64::new(1);

fn lock_registry() -> std::sync::MutexGuard<'static, Vec<CapabilityRecord>> {
    REGISTRY.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lock_pending() -> std::sync::MutexGuard<'static, Vec<(String, PendingCall)>> {
    PENDING.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 声明校验：id 命名、提供方 label、ACL 取值域（typo 早暴露，别等到调用时才拒）。
fn validate_decl(decl: &CapabilityDecl, provider: &str) -> Result<(), String> {
    if !PROVIDERS.contains(&provider) {
        return Err(format!("CAPABILITY_BAD_DECL: 未知提供方窗口 {provider}（可用：{}）", PROVIDERS.join(" / ")));
    }
    let id = decl.id.trim();
    if id.is_empty() {
        return Err("CAPABILITY_BAD_DECL: 能力 id 不能为空".to_string());
    }
    let named = id.split('.').count() >= 2;
    let chars_ok = id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_' || c == '-');
    if !named || !chars_ok {
        return Err(format!(
            "CAPABILITY_BAD_DECL: 能力 id 形状非法（{id}）——须为「命名空间.名」小写点分（字母/数字/._-）"
        ));
    }
    for caller in &decl.acl {
        if !PROVIDERS.contains(&caller.as_str()) {
            return Err(format!(
                "CAPABILITY_BAD_DECL: ACL 含未知调用方 {caller}（可用：{}）",
                PROVIDERS.join(" / ")
            ));
        }
    }
    Ok(())
}

/// 批量登记（**先全校验再落地**：一条非法则整批拒绝，不留半登记状态）。
pub fn register(decls: &[CapabilityDecl], provider: &str) -> Result<Vec<String>, String> {
    for decl in decls {
        validate_decl(decl, provider)?;
    }
    let mut registry = lock_registry();
    for decl in decls {
        if let Some(existing) = registry.iter().find(|r| r.id == decl.id) {
            if existing.provider != provider {
                return Err(format!(
                    "CAPABILITY_CONFLICT: 能力 {} 已由 {} 登记（{} 不能覆盖）",
                    decl.id, existing.provider, provider
                ));
            }
            registry.retain(|r| r.id != decl.id);
        }
    }
    let ids: Vec<String> = decls.iter().map(|d| d.id.clone()).collect();
    for decl in decls {
        registry.push(CapabilityRecord {
            id: decl.id.clone(),
            summary: decl.summary.clone(),
            params: decl.params.clone(),
            acl: decl.acl.clone(),
            provider: provider.to_string(),
        });
    }
    Ok(ids)
}

/// 内省快照（按 id 排序，形状稳定）。
pub fn list() -> Vec<CapabilityRecord> {
    let mut snapshot: Vec<CapabilityRecord> = lock_registry().clone();
    snapshot.sort_by(|a, b| a.id.cmp(&b.id));
    snapshot
}

/// 按 id 查记录。
pub fn find(id: &str) -> Option<CapabilityRecord> {
    lock_registry().iter().find(|r| r.id == id).cloned()
}

/// ACL 校验：调用方是否在声明名单内（空名单 = 无人可调）。
pub fn check_acl(record: &CapabilityRecord, caller: &str) -> Result<(), String> {
    if !PROVIDERS.contains(&caller) {
        return Err(format!("CAPABILITY_FORBIDDEN: 未知调用方窗口 {caller}"));
    }
    if record.acl.iter().any(|allowed| allowed == caller) {
        Ok(())
    } else {
        Err(format!(
            "CAPABILITY_FORBIDDEN: {caller} 不在 {} 的 ACL（可调方：{}）",
            record.id,
            if record.acl.is_empty() { "（空，无人可调）".to_string() } else { record.acl.join(" / ") }
        ))
    }
}

/// 下一枚 callId。
fn next_call_id(id: &str) -> String {
    let seq = CALL_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("cap-{}-{seq}-{id}", std::process::id())
}

/// 登记在途调用并返回接收端。
fn park_pending(call_id: &str, provider: &str) -> tokio::sync::oneshot::Receiver<Result<Value, String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    lock_pending().push((
        call_id.to_string(),
        PendingCall { provider: provider.to_string(), started: Instant::now(), tx: Some(tx) },
    ));
    rx
}

/// 在途调用是否仍在等（测试断言用）。
#[cfg(test)]
pub fn is_pending(call_id: &str) -> bool {
    lock_pending().iter().any(|(id, _)| id == call_id)
}

/// 清掉在途条目并取出（供回执认领）。
fn take_pending(call_id: &str) -> Option<PendingCall> {
    let mut pending = lock_pending();
    let idx = pending.iter().position(|(id, _)| id == call_id)?;
    Some(pending.remove(idx).1)
}

/// 超时兜底线程：到点仍在等则判超时并解锁等待方。
fn spawn_timeout(call_id: String, provider: String, timeout: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(timeout);
        if let Some(mut call) = take_pending(&call_id) {
            if let Some(tx) = call.tx.take() {
                let message = format!(
                    "CAPABILITY_TIMEOUT: 提供方 {provider} 未在 {}s 内回执",
                    timeout.as_secs()
                );
                println!("[WORLDSEA-CAP] 超时：{call_id}（{message}）");
                let _ = tx.send(Err(message));
            }
        }
    });
}

/// 回执认领（**只有该调用的提供方窗口**能回）：成功则把结果交给等待方。
/// 返回错误信息用于区分「无此在途调用」与「非该调用提供方」。
fn complete(call_id: &str, provider: &str, outcome: Result<Value, String>) -> Result<(), String> {
    let mut pending = lock_pending();
    let idx = pending
        .iter()
        .position(|(id, _)| id == call_id)
        .ok_or_else(|| format!("CAPABILITY_NO_PENDING: 无待回执调用（{call_id}）"))?;
    if pending[idx].1.provider != provider {
        return Err(format!(
            "CAPABILITY_NO_PENDING: {provider} 不是该调用的提供方（提供方：{}）",
            pending[idx].1.provider
        ));
    }
    let mut call = pending.remove(idx).1;
    let elapsed = call.started.elapsed().as_millis();
    let verdict = match &outcome {
        Ok(_) => "ok".to_string(),
        Err(error) => format!("fail（{error}）"),
    };
    println!("[WORLDSEA-CAP] 回执：{call_id} {verdict} {elapsed} ms");
    if let Some(tx) = call.tx.take() {
        let _ = tx.send(outcome);
    }
    Ok(())
}

/// 命令：提供方登记能力（provider = 调用窗口 label，不可冒名）。
#[tauri::command]
pub fn cmd_capability_register(
    window: tauri::WebviewWindow,
    decls: Vec<CapabilityDecl>,
) -> Result<usize, String> {
    let provider = window.label().to_string();
    let ids = register(&decls, &provider)?;
    println!(
        "[WORLDSEA-CAP] 登记：provider={provider} 共 {} 条 → {}",
        ids.len(),
        ids.join(" / ")
    );
    Ok(ids.len())
}

/// 命令：能力内省（供 Agent 发现面；含 ACL 与提供方）。
#[tauri::command]
pub fn cmd_capability_list() -> Vec<CapabilityRecord> {
    list()
}

/// 命令：调用能力（ACL 校验 → 中转 → 结果 / 结构化错误）。
#[tauri::command]
pub async fn cmd_capability_invoke(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let caller = window.label().to_string();
    let record = find(&id).ok_or_else(|| {
        println!("[WORLDSEA-CAP] 拒：{caller} → {id}（未登记）");
        format!("CAPABILITY_UNKNOWN: 能力未登记（{id}）——提供方窗口未就绪或未登记该能力")
    })?;
    if let Err(denied) = check_acl(&record, &caller) {
        println!("[WORLDSEA-CAP] 拒：{caller} → {}::{}（ACL）", record.provider, record.id);
        return Err(denied);
    }
    let provider_window = app.get_webview_window(&record.provider).ok_or_else(|| {
        format!("CAPABILITY_UNAVAILABLE: 提供方窗口 {} 未打开（工作台窗懒创建）", record.provider)
    })?;

    let call_id = next_call_id(&id);
    let rx = park_pending(&call_id, &record.provider);
    spawn_timeout(call_id.clone(), record.provider.clone(), CALL_TIMEOUT);

    let args_json = serde_json::to_string(args.as_ref().unwrap_or(&Value::Null))
        .map_err(|e| format!("CAPABILITY_BAD_ARGS: 参数序列化失败：{e}"))?;
    let call_id_json = serde_json::to_string(&call_id).unwrap_or_else(|_| "\"\"".to_string());
    let id_json = serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".to_string());
    // 派发到提供方窗口；脚本缺失或同步抛错时**立即**回执失败（不等 10s 超时）。
    let script = format!(
        "try {{ \
           if (typeof globalThis.__WORLDSEA_CAPABILITY_CALL__ !== 'function') \
             throw new Error('该窗口未装配能力伺服（provider 脚本缺失）'); \
           globalThis.__WORLDSEA_CAPABILITY_CALL__({call_id_json}, {id_json}, {args_json}); \
         }} catch (e) {{ \
           try {{ globalThis.__TAURI_INTERNALS__.invoke('cmd_capability_result', \
             {{ callId: {call_id_json}, ok: false, result: null, error: String((e && e.message) || e) }}); }} catch (_) {{}} \
         }}"
    );
    if let Err(error) = provider_window.eval(&script) {
        let message = format!("CAPABILITY_UNAVAILABLE: 派发到 {} 失败：{error}", record.provider);
        let _ = complete(&call_id, &record.provider, Err(message.clone()));
        return Err(message);
    }

    match rx.await {
        Ok(Ok(value)) => {
            println!("[WORLDSEA-CAP] 调用：{caller} → {}::{id} ok", record.provider);
            Ok(value)
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err(format!(
            "CAPABILITY_UNAVAILABLE: 提供方 {} 的回执通道中断（窗口关闭？）",
            record.provider
        )),
    }
}

/// 命令：提供方回执（callId 认领；非该调用的提供方窗口一律拒）。
#[tauri::command]
pub fn cmd_capability_result(
    window: tauri::WebviewWindow,
    call_id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
) -> Result<bool, String> {
    let provider = window.label().to_string();
    let outcome = if ok {
        Ok(result.unwrap_or(Value::Null))
    } else {
        Err(error.unwrap_or_else(|| "CAPABILITY_PROVIDER_ERROR: 提供方未给出错误说明".to_string()))
    };
    complete(&call_id, &provider, outcome)?;
    Ok(true)
}

// ── 测试辅助 ─────────────────────────────────────────────────────────────

/// 测试辅助：清空全局态（仅测试用；生产路径不调）。
#[cfg(test)]
fn reset_for_test() {
    lock_registry().clear();
    lock_pending().clear();
}

#[cfg(test)]
#[path = "capabilities_tests.rs"]
mod tests;
