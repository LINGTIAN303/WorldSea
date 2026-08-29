//! 黑板（Blackboard）— 跨节点共享的任务状态（设计 §3.3 / §3.5 纪律 4）
//!
//! 契约：
//! - 键按「模式 + 用途」命名空间化（设计 表 3-1），避免组合模式时键冲突；
//! - **只追加优先**：历史键（如 `react.trace`）只追加条目，需要覆盖时写新版本键，
//!   保证审计可回放；`write`/`overwrite` 是受控的例外（计划/游标这类「当前值」键）；
//! - 黑板可整体序列化（快照协议 4.6：黑板全量可直接序列化）。

use std::collections::HashMap;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

/// 黑板操作错误
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BlackboardError {
    #[error("黑板键不存在: {0}")]
    MissingKey(String),
    #[error("黑板键 {0} 的值无法反序列化为目标类型")]
    TypeMismatch(String),
}

/// 跨节点共享的任务状态存储。
///
/// 追加与覆盖是两个显式动作：`append`（只追加语义，列表条目）/ `overwrite`
/// （当前值语义：计划、游标）。读取按 `read`/`read_t` 两种形态。
#[derive(Debug, Clone, Default)]
pub struct Blackboard {
    entries: HashMap<String, Vec<Value>>,
}

impl Blackboard {
    pub fn new() -> Self {
        Self::default()
    }

    // ── 写入 ────────────────────────────────────────────

    /// 追加一个条目到键下（只追加语义：轨迹、记录、候选）
    pub fn append(&mut self, key: impl Into<String>, value: impl Serialize) {
        self.entries.entry(key.into()).or_default().push(serde_json::to_value(value).ok().unwrap_or(Value::Null));
    }

    /// 覆盖当前值（当前值语义：`pne.plan` / `pne.cursor` / `tot.tree` 等）。
    /// 覆盖历史保留在同键条目序列中（审计可回放，设计 3.5 纪律 4）。
    pub fn write(&mut self, key: impl Into<String>, value: impl Serialize) {
        let key = key.into();
        let slot = self.entries.entry(key).or_default();
        let v = serde_json::to_value(value).ok().unwrap_or(Value::Null);
        match slot.last_mut() {
            Some(last) => *last = v,
            None => slot.push(v),
        }
    }

    /// 删除键（供治理压缩 `Blackboard::compact` 清理低价值键）
    pub fn remove(&mut self, key: &str) {
        self.entries.remove(key);
    }

    // ── 读取 ────────────────────────────────────────────

    /// 读当前值（该键最新条目）
    pub fn read(&self, key: &str) -> Option<&Value> {
        self.entries.get(key).and_then(|v| v.last())
    }

    /// 读当前值并反序列化（缺键返回 Ok(None)；类型不符返回 TypeMismatch）
    pub fn read_t<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, BlackboardError> {
        match self.read(key) {
            None => Ok(None),
            Some(v) => serde_json::from_value(v.clone())
                .map(Some)
                .map_err(|_| BlackboardError::TypeMismatch(key.to_string())),
        }
    }

    /// 读键下全部条目（只追加序列；时间序）
    pub fn read_all(&self, key: &str) -> &[Value] {
        self.entries.get(key).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// 键是否存在
    pub fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    /// 全部键（快照/调试用）
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(|s| s.as_str())
    }

    // ── 治理与快照 ──────────────────────────────────────

    /// 治理压缩（设计 6.6 compact 门）：保留指定键，其余清理。
    /// 返回被清理的键数。
    pub fn compact_keep(&mut self, keep: &[&str]) -> usize {
        let before = self.entries.len();
        self.entries.retain(|k, _| keep.contains(&k.as_str()));
        before - self.entries.len()
    }

    /// 车道合并（设计 4.4：车道共享同一黑板——实现为「车道分身 → 汇合合并」，
    /// 车道写入键按命名空间隔离（6.3），合并采用只追加语义：other 的键条目
    /// 依车道序追加进 self，与「黑板只追加」纪律一致）
    pub fn merge_from(&mut self, other: Blackboard) {
        for (k, entries) in other.entries {
            self.entries.entry(k).or_default().extend(entries);
        }
    }

    /// 快照全量（设计 4.6：黑板全量可直接序列化）
    pub fn snapshot(&self) -> Value {
        serde_json::to_value(&self.entries).unwrap_or(Value::Null)
    }

    /// 从快照恢复（resume 协议 4.6）
    pub fn restore(&mut self, snap: Value) {
        if let Ok(entries) = serde_json::from_value::<HashMap<String, Vec<Value>>>(snap) {
            self.entries = entries;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 追加与当前值语义分离() {
        let mut bb = Blackboard::new();
        bb.append("react.trace", "t1");
        bb.append("react.trace", "t2");
        assert_eq!(bb.read_all("react.trace").len(), 2);
        assert_eq!(bb.read("react.trace"), Some(&serde_json::json!("t2")));

        bb.write("pne.cursor", 0);
        bb.write("pne.cursor", 1);
        assert_eq!(bb.read_all("pne.cursor").len(), 1, "write 覆盖当前值");
        assert_eq!(bb.read_t::<u32>("pne.cursor").unwrap(), Some(1));
    }

    #[test]
    fn 类型不匹配与缺键() {
        let mut bb = Blackboard::new();
        bb.write("k", "text");
        assert!(matches!(bb.read_t::<u32>("k"), Err(BlackboardError::TypeMismatch(_))));
        assert_eq!(bb.read_t::<u32>("missing").unwrap(), None);
    }

    #[test]
    fn 快照往返与压缩() {
        let mut bb = Blackboard::new();
        bb.append("a", 1);
        bb.append("b", 2);
        let snap = bb.snapshot();
        let mut bb2 = Blackboard::new();
        bb2.restore(snap);
        assert_eq!(bb2.read_t::<i32>("a").unwrap(), Some(1));

        let removed = bb.compact_keep(&["a"]);
        assert_eq!(removed, 1);
        assert!(bb.contains("a") && !bb.contains("b"));
    }
}
