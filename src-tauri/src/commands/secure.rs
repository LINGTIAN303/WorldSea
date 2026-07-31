//! 安全存储 API（系统 Keyring）
//!
//! 拆分自 lib.rs（P0-2 批次1）。
//! 4 个命令：store / load / delete / exists。

// ── 安全存储 API（系统 Keyring） ──

const KEYRING_SERVICE: &str = "com.worldsmith.app";
const KEYRING_USERNAME: &str = "api_keys";

/// 获取 keyring 条目 — 统一 service/username，用 key 名作为条目后缀
fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    let service = format!("{}:{}", KEYRING_SERVICE, key);
    keyring::Entry::new(&service, KEYRING_USERNAME).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_secure_store(key: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        // 空值等同于删除
        let entry = keyring_entry(&key)?;
        let _ = entry.delete_credential();
        return Ok(());
    }
    let entry = keyring_entry(&key)?;
    entry.set_password(&value).map_err(|e| {
        eprintln!("[keyring] set_password 失败 for key={key}: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn cmd_secure_load(key: String) -> Result<String, String> {
    let entry = keyring_entry(&key)?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn cmd_secure_delete(key: String) -> Result<(), String> {
    let entry = keyring_entry(&key)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn cmd_secure_exists(key: String) -> Result<bool, String> {
    let entry = keyring_entry(&key)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
