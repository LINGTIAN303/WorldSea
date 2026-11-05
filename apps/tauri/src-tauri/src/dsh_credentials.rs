// 凭据环境取向（从 dsh_shell.rs 拆出）：**库优先 + env 兜底**。dsh 的凭据分层是
// 「继承环境（**最高优先**）> `$DSH_HOME/.credentials.yaml`（页面「设置 → 模型」写入的库）> 项目 `.env` > home `.env`」
//（见 dsh `credentials-local` 头注），所以只要环境里有 Key 就会永久盖住界面配置。壳在 spawn 前判一次库：
// - 库里已有该凭据（`refs:` 段）→ 剥掉继承的环境变量，以界面配置为准；库里没有 → 保留继承的环境变量作零配置兜底。
// 反证/逃生口：`WORLDSEA_KEEP_ENV_KEYS=1` 强制保留继承（复现「界面改 Key 不生效」）。

use std::path::Path;
use std::process::Command;

/// spawn 前应用凭据取向：**库里有哪些 Key，就剥哪些同名环境变量**，并落下可取证的一行日志。
///
/// 为什么按库动态取而不是维护固定名单：模型页把 Key 写进库的 `refs:` 段，而「哪些 provider 存在」
/// 由用户在该页配置（`llm-pi-ai` 的 `apiKeyEnv` 指到任意变量名，如 `ANTDIGITAL_API_KEY` /
/// `OPENCSG_API_KEY`）。写死名单只覆盖 DeepSeek 一家，其余 provider 的界面配置会被继承的
/// 同名环境变量永久盖住——正是 C5 批修掉的那个症状，只是换了个 provider 重现。
pub(crate) fn apply_credential_env(command: &mut Command, home: &Path) {
    if std::env::var_os("WORLDSEA_KEEP_ENV_KEYS").is_some() {
        println!("[DSH-SHELL] 凭据环境剥离已按 WORLDSEA_KEEP_ENV_KEYS 关闭（反证模式：继承的 Key 会盖住界面配置）");
        return;
    }
    for name in credential_ref_names(home) {
        if std::env::var_os(&name).is_none() {
            continue;
        }
        // 名字来自库的 `refs:` 段，故这里必然命中；保留分支只为日志可读（库中键与实际判定同源）。
        command.env_remove(&name);
        println!("[DSH-SHELL] 库（.credentials.yaml）已有 {name}：剥离继承的环境变量，以界面配置为准");
    }
}

/// 库里 `refs:` 段登记的全部凭据名（= 环境变量名）。
/// 文档是带版本的结构（`version` / `refs` / `records`）：`refs` 按环境变量名存密钥值（本函数关心的），
/// `records` 按 `<owner>/<id>` 存插件凭据（与 API Key 无关）——见 dsh `credentials-local` README。
/// 不做完整 YAML 解析：只跟踪 `refs:` 段内更深缩进的行；段外出现不更深缩进的行即判定段已结束。
pub(crate) fn credential_ref_names(home: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(home.join(".credentials.yaml")) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    let mut refs_indent: Option<usize> = None;
    let mut entry_indent: Option<usize> = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len() - trimmed.len();
        match refs_indent {
            None => {
                if trimmed == "refs:" {
                    refs_indent = Some(indent);
                }
            }
            Some(level) => {
                if indent <= level {
                    break; // refs 段已结束
                }
                // 只收 refs 段的**直接子级**：更深缩进的行属于上一个条目的内部结构
                // （`nested:` 下面还有 `inner: x`，那不是凭据名）。
                if entry_indent.is_none() {
                    entry_indent = Some(indent);
                }
                if indent != entry_indent.unwrap_or(indent) {
                    continue;
                }
                if let Some(name) = entry_name(trimmed) {
                    if !names.iter().any(|seen| seen == &name) {
                        names.push(name);
                    }
                }
            }
        }
    }
    names
}

/// 一行 `KEY: value`（键可带引号）→ 键名；不是「键 + 同行标量值」则为 None。
///
/// 凭据名必须自带同行值（`KEY: sk-…`）。`nested:` 这类嵌套结构行尾为空、其内容在下一行缩进里，
/// 若一并收下就会把结构键误当环境变量名。
fn entry_name(line: &str) -> Option<String> {
    let candidate = line.strip_prefix('"').unwrap_or(line);
    let (key, rest) = candidate.split_once(':')?;
    let key = key.trim_end_matches('"');
    if key.is_empty() {
        return None;
    }
    let value = rest.trim_start();
    if value.is_empty() || value == "{}" || value.starts_with('|') || value.starts_with('>') {
        return None; // 无同行标量值 = 结构键或块标量，不是凭据名
    }
    // 只接受环境变量形态的名字，避免把其它结构误当凭据名
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    Some(key.to_string())
}

/// 凭据库里是否已存有某凭据——读 `$DSH_HOME/.credentials.yaml` 的 **`refs:` 段**。
/// 生产路径按 [`credential_ref_names`] 整段取用；本判定只供单测断言解析口径。
#[cfg(test)]
fn credential_store_has(home: &Path, name: &str) -> bool {
    credential_ref_names(home).iter().any(|seen| seen == name)
}

#[cfg(test)]
#[path = "dsh_credentials_tests.rs"]
mod tests;
