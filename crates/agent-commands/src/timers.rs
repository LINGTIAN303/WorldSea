//! 定时唤醒服务（批次 C·S1，2026-09-20）
//!
//! 详细见 docs/plans/2026-09-18-对话区对齐dsh/03-对照与建议清单.md §三 S1（设计与验收）。
//!
//! # 是什么
//!
//! Agent 需要等待时可设置倒计时（`set_timer` 三件套之一），到点**自动唤醒会话继续干活**；
//! 可选在倒计时期间**捕获指定 PTY 会话的后台输出**（显式 watch 列表 + 游标增量），
//! 到点一并送达；也可挂「提醒事项」起到到点提醒作用。
//!
//! # 关键设计（D6-D9 拍板口径）
//!
//! - **持久化 + 到期补投**：`session_timers` 表随会话存储；会话（重启后）恢复装配时
//!   扫描 pending 定时器——已到期立即触发（载荷标注「补投」），未到期重新武装
//! - **认领即触发**：触发前先 `claim_timer_fired`（原子 UPDATE，pending → fired），
//!   **唯一成功者**才注入唤醒——重启补投 / 重复装配不会重复触发
//! - **唤醒 = `submit_input(FollowUp)`**：空闲即新开一轮；运行中入队待下一轮准入；
//!   载荷带 `meta.input_kind = "timer"`（前端专门行呈现，非普通用户气泡）
//! - **一次性**（不做周期）；护栏：10s ≤ 倒计时 ≤ 24h、每会话未到期上限 8
//!
//! # 已知边界
//!
//! watch 捕获范围 = **本会话 Agent 终端工具**创建的 PTY 会话（`ShellSessionManager`
//! 按会话隔离；前端终端面板是另一份独立会话池，不互通——P1 登记）。

use std::collections::HashMap;
use std::sync::Arc;

use chrono::TimeZone;
use agent_runtime::agent::input::InputKind;
use agent_runtime::agent::AgentLoop;

use crate::session_store::{SessionRepository, SessionTimerRecord};
use crate::terminal::ShellSessionManager;

/// 最小倒计时（秒）
pub const TIMER_MIN_SECS: u64 = 10;
/// 最大倒计时（秒）
pub const TIMER_MAX_SECS: u64 = 86_400;
/// 每会话未到期定时器上限（防堆积）
pub const TIMER_MAX_PENDING_PER_SESSION: usize = 8;
/// 单会话捕获输出上限（字符；超限保留尾部并标注）
pub const TIMER_CAPTURE_MAX_CHARS: usize = 2_000;

/// 当前 Unix 毫秒
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 毫秒时间戳 → 本地可读时间（载荷/工具输出展示用）
pub(crate) fn fmt_ms(ms: i64) -> String {
    chrono::Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|t| t.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| ms.to_string())
}

/// 捕获段（到点载荷组装用；纯数据，便于契约测试）
#[derive(Debug, Clone, PartialEq)]
pub struct WatchSection {
    /// PTY 会话 id
    pub session_id: String,
    /// 期间新增输出（已清理 ANSI；空 = 期间无新输出）
    pub text: String,
    /// 输出超限：游标早于最旧字节（仅保留最近部分）
    pub truncated: bool,
    /// 会话已销毁（无输出可读）
    pub destroyed: bool,
}

/// 设定时快照 watch 会话的游标（会话不存在则跳过——到点按「已销毁」标注）
///
/// 供 `set_timer` 在写入记录前调用（自由函数：deps 与 runner 两侧同源）。
pub async fn snapshot_cursors(
    manager: &ShellSessionManager,
    watch: &[String],
) -> HashMap<String, i64> {
    let mut out = HashMap::new();
    for id in watch {
        if let Some(c) = manager.session_cursor(id).await {
            out.insert(id.clone(), c as i64);
        }
    }
    out
}

/// 定时器运行器：到点唤醒（持有本会话 AgentLoop / PTY 会话池 / 存储 + 会话 id）
pub struct TimerRunner {
    agent: Arc<AgentLoop>,
    manager: ShellSessionManager,
    store: Arc<dyn SessionRepository>,
    session_id: String,
}

impl TimerRunner {
    /// 构造（装配层在会话创建/恢复后注入）
    pub fn new(
        agent: Arc<AgentLoop>,
        manager: ShellSessionManager,
        store: Arc<dyn SessionRepository>,
        session_id: String,
    ) -> Self {
        Self {
            agent,
            manager,
            store,
            session_id,
        }
    }

    /// 触发（认领成功才注入）：返回是否本次触发
    ///
    /// - 认领失败（已 fired / cancelled）→ 不注入（幂等）
    /// - `catch_up`：恢复期补投（迟到触发；载荷标注「补投」）
    pub async fn fire_if_pending(&self, record: &SessionTimerRecord, catch_up: bool) -> bool {
        match self.store.claim_timer_fired(&record.id).await {
            Ok(true) => {}
            Ok(false) => return false,
            Err(e) => {
                tracing::warn!("定时器认领失败，跳过触发（timer={}）: {e}", record.id);
                return false;
            }
        }
        let sections = self.capture(&record.watch, &record.cursors).await;
        let text = build_wake_payload(record, &sections, catch_up);
        // 来源标记：input_kind = "timer"（覆盖语义串）→ 前端专门行呈现
        let mut meta = HashMap::new();
        meta.insert("input_kind".to_string(), serde_json::json!("timer"));
        meta.insert("timer_id".to_string(), serde_json::json!(record.id));
        if catch_up {
            meta.insert("timer_catch_up".to_string(), serde_json::json!(true));
        }
        if let Err(e) = self
            .agent
            .submit_input_with_meta(InputKind::FollowUp, text, Some(meta))
            .await
        {
            tracing::warn!("定时唤醒注入失败（timer={}）: {e}", record.id);
        }
        true
    }

    /// 武装：到点触发（后台任务；`catch_up=true` 立即触发——恢复期补投）
    ///
    /// 任务只持 Arc（agent/manager/store）+ 记录，不持服务引用；会话随后被删除时
    /// 记录已随 FK 级联清理、认领必然失败 → 不会误唤醒（detached 注入亦无害）。
    pub fn arm(self: Arc<Self>, record: SessionTimerRecord, catch_up: bool) {
        tokio::spawn(async move {
            if !catch_up {
                let delay_ms = record.fire_at - now_ms();
                if delay_ms > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms as u64)).await;
                }
            }
            self.fire_if_pending(&record, catch_up).await;
        });
    }

    /// 捕获 watch 会话的增量输出（游标增量 → 清理 ANSI → 尾部截断）
    async fn capture(&self, watch: &[String], cursors: &HashMap<String, i64>) -> Vec<WatchSection> {
        let mut sections = Vec::with_capacity(watch.len());
        for id in watch {
            let pos = cursors.get(id).copied().unwrap_or(0).max(0) as usize;
            match self.manager.read_session_from(id, pos).await {
                Some((raw, _new_pos, truncated)) => {
                    let cleaned = crate::terminal::clean_ansi(&raw);
                    sections.push(WatchSection {
                        session_id: id.clone(),
                        text: tail_clamp(&cleaned, TIMER_CAPTURE_MAX_CHARS),
                        truncated,
                        destroyed: false,
                    });
                }
                None => sections.push(WatchSection {
                    session_id: id.clone(),
                    text: String::new(),
                    truncated: false,
                    destroyed: true,
                }),
            }
        }
        sections
    }
}

/// 装配期恢复（会话创建/恢复后调用）：扫描 pending 定时器——已到期补投、未到期武装
///
/// 幂等：重复装配时第二次认领失败（已 fired）→ 不重复触发。
pub async fn restore_and_arm(runner: Arc<TimerRunner>) {
    let session_id = runner.session_id.clone();
    let pending = match runner.store.list_pending_timers(&session_id).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("定时器恢复扫描失败（session={session_id}）: {e}");
            return;
        }
    };
    if pending.is_empty() {
        return;
    }
    let now = now_ms();
    let mut catch_up_count = 0usize;
    for record in pending {
        let catch_up = record.fire_at <= now;
        if catch_up {
            catch_up_count += 1;
            tracing::info!(
                "定时器补投（应用重启/装配时已到期）：session={} timer={} fire_at={}",
                session_id,
                record.id,
                fmt_ms(record.fire_at)
            );
        }
        runner.clone().arm(record, catch_up);
    }
    tracing::info!(
        "定时器恢复完成：session={} 已武装（其中补投 {} 条）",
        session_id,
        catch_up_count
    );
}

/// 尾部截断（按字符；超限保留尾部 = 最新输出，并在载荷中标注）
fn tail_clamp(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text.to_string();
    }
    text.chars()
        .skip(count - max_chars)
        .collect::<String>()
}

/// 到点唤醒载荷（纯函数，契约测试锁定）
///
/// 结构：定时信息（设置/倒计时/到期/补投）+ 提醒事项 + 捕获段 + 继续指引。
fn build_wake_payload(
    record: &SessionTimerRecord,
    sections: &[WatchSection],
    catch_up: bool,
) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "[定时唤醒] 定时器到点（{}）{}\n",
        record.id,
        if catch_up { "（补投：应用重启后到期）" } else { "" }
    ));
    let secs = ((record.fire_at - record.created_at).max(0)) / 1000;
    out.push_str(&format!(
        "设置时间：{}｜倒计时：{}s｜到期：{}\n",
        fmt_ms(record.created_at),
        secs,
        fmt_ms(record.fire_at)
    ));
    if let Some(note) = record.note.as_deref().filter(|n| !n.trim().is_empty()) {
        out.push_str(&format!("提醒事项：{note}\n"));
    }
    if !sections.is_empty() {
        out.push_str("后台输出捕获（watch 会话，自设定时刻起的增量）：\n");
        for s in sections {
            out.push_str(&format!("--- {} ---\n", s.session_id));
            if s.destroyed {
                out.push_str("（会话已销毁：无输出）\n");
            } else if s.text.trim().is_empty() {
                out.push_str("（期间无新输出）\n");
            } else {
                out.push_str(s.text.trim_end());
                out.push('\n');
                if s.truncated {
                    out.push_str(&format!(
                        "（输出超限：缓冲已裁剪，仅保留最近 {} 字符）\n",
                        TIMER_CAPTURE_MAX_CHARS
                    ));
                }
            }
        }
    }
    out.push_str("--- 以上为定时器自动投递；请基于捕获内容继续你之前的任务（如无需继续，请简述当前状态）。");
    out
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionTimerStatus;

    fn rec(note: Option<&str>, watch: Vec<&str>) -> SessionTimerRecord {
        SessionTimerRecord {
            id: "timer-1".into(),
            session_id: "s1".into(),
            fire_at: 12_345_000,
            note: note.map(String::from),
            watch: watch.into_iter().map(String::from).collect(),
            cursors: HashMap::new(),
            status: SessionTimerStatus::Pending,
            created_at: 12_335_000,
            fired_at: None,
        }
    }

    #[test]
    fn payload_includes_timer_info_and_guidance() {
        let text = build_wake_payload(&rec(Some("记得看构建结果"), vec![]), &[], false);
        assert!(text.starts_with("[定时唤醒] 定时器到点（timer-1）"));
        assert!(text.contains("倒计时：10s"), "倒计时秒数应按设置/到期差推导");
        assert!(text.contains("提醒事项：记得看构建结果"));
        assert!(text.contains("继续你之前的任务"));
        assert!(!text.contains("（补投"), "非补投不标注");
        // 无 watch → 无捕获段标题
        assert!(!text.contains("后台输出捕获"));
    }

    #[test]
    fn payload_marks_catch_up_and_watch_states() {
        let sections = vec![
            WatchSection {
                session_id: "session-a".into(),
                text: "build ok\n".into(),
                truncated: false,
                destroyed: false,
            },
            WatchSection {
                session_id: "session-b".into(),
                text: "tail only".into(),
                truncated: true,
                destroyed: false,
            },
            WatchSection {
                session_id: "session-c".into(),
                text: String::new(),
                truncated: false,
                destroyed: true,
            },
        ];
        let text = build_wake_payload(&rec(None, vec!["session-a"]), &sections, true);
        assert!(text.contains("（补投：应用重启后到期）"));
        assert!(text.contains("--- session-a ---\nbuild ok"));
        assert!(text.contains("tail only"));
        assert!(text.contains("输出超限"));
        assert!(text.contains("（会话已销毁：无输出）"));
        assert!(!text.contains("提醒事项"), "无 note 不携带该行");
    }

    #[test]
    fn tail_clamp_keeps_tail_and_handles_boundary() {
        assert_eq!(tail_clamp("abc", 5), "abc");
        assert_eq!(tail_clamp("abcdef", 3), "def");
        // 按字符计数（中文不按字节切）
        assert_eq!(tail_clamp("一二三四五", 2), "四五");
    }
}