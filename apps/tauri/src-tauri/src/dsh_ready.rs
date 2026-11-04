// Agent 面（dsh）就绪状态——供产品域窗感知「dsh 界面是否可以加载」。
// 为什么需要：产品域窗是默认落地，用户从它切到 Agent 空间时，dsh 可能仍在 spawn/就绪链上
// （壳侧 READY_TIMEOUT 达 90s），切过去只会看到占位/错误页。启动页据此把「等我自己就绪」
// 扩展为「等我自己 + dsh 都就绪」，并带封顶超时（dsh 拖慢或失败时不把用户锁在启动页）。
//
// 状态机：Pending（尚未 spawn / 就绪中）→ Ready（桥已装配，页面可加载）| Failed（启动失败）。
// 单向推进，不回落——运行中 dsh 退出由 dsh_shell::watch_child 单独处置（那不是「启动」问题）。

use std::sync::atomic::{AtomicU8, Ordering};

/// 就绪态：与前端约定的数值（新增值只能追加，不重排）。
pub const STATE_PENDING: u8 = 0;
/// 桥已装配，dsh 页面可以加载。
pub const STATE_READY: u8 = 1;
/// 启动失败（spawn/就绪超时/桥装配失败）。
pub const STATE_FAILED: u8 = 2;

/// 全局就绪态（进程级单值；两窗共读）。
static STATE: AtomicU8 = AtomicU8::new(STATE_PENDING);

/// 标记 dsh 就绪（`dsh_bridge::attach` 成功后调用）。
pub(crate) fn mark_ready() {
    STATE.store(STATE_READY, Ordering::SeqCst);
}

/// 标记 dsh 启动失败。
/// **仅在尚未就绪时生效**：就绪后的子进程退出属运行期问题（由 `dsh_shell::watch_child`
/// 发通知 + 错误页处置），不该把启动态回退成 failed——否则启动页逻辑会误判。
pub(crate) fn mark_failed() {
    let _ = STATE.compare_exchange(STATE_PENDING, STATE_FAILED, Ordering::SeqCst, Ordering::SeqCst);
}

/// 重启期回到 pending（**仅供重启链调用**）。
///
/// 这是状态机唯一允许回退的入口：宿主崩溃后壳要重新 spawn，期间 dsh 页面确实不可用，
/// 产品域启动页应重新等待。只从 `READY` 回退——启动期的 pending / failed 语义不受影响。
pub(crate) fn mark_pending() {
    let _ = STATE.compare_exchange(STATE_READY, STATE_PENDING, Ordering::SeqCst, Ordering::SeqCst);
}

/// 当前就绪态（`cmd_dsh_ready_state` 与内部判定共用）。
pub(crate) fn state() -> u8 {
    STATE.load(Ordering::SeqCst)
}

/// 查询 dsh 就绪态：产品域启动页轮询/单次读用。
/// 返回 `pending` / `ready` / `failed`（字符串便于前端直接判断，避免魔法数字）。
#[tauri::command]
pub async fn cmd_dsh_ready_state() -> Result<String, String> {
    Ok(match state() {
        STATE_READY => "ready".to_string(),
        STATE_FAILED => "failed".to_string(),
        _ => "pending".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// 全局状态在测试间共享（AtomicU8 是进程级）——串行化，避免并行用例互相污染。
    static SERIAL: Mutex<()> = Mutex::new(());

    /// 把状态复位回 pending（仅测试；生产无回退路径）。
    fn reset() {
        STATE.store(STATE_PENDING, Ordering::SeqCst);
    }

    #[test]
    fn state_strings_are_the_contract_the_page_reads() {
        // 前端按这三个词判断（App.vue 的 waitForDshReady），改名即断约——锁住。
        assert_eq!(STATE_PENDING, 0);
        assert_eq!(STATE_READY, 1);
        assert_eq!(STATE_FAILED, 2);
    }

    #[test]
    fn state_advances_pending_to_ready_and_never_regresses() {
        let _guard = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        reset();
        assert_eq!(state(), STATE_PENDING);
        mark_ready();
        assert_eq!(state(), STATE_READY);
        // 就绪后再收到失败信号（运行中退出）不得回退——那是 watch_child 的职责，不是启动语义
        mark_failed();
        assert_eq!(state(), STATE_READY, "已就绪后 mark_failed 必须无效（单向推进）");
        reset();
    }

    #[test]
    fn failure_is_visible_so_the_splash_can_release_early() {
        // 失败必须可读——启动页据此立刻放行，而不是干等满 15s 封顶
        let _guard = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        reset();
        mark_failed();
        assert_eq!(state(), STATE_FAILED);
        reset();
    }
}
