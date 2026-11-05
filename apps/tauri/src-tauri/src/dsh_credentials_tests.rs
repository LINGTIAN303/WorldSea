// dsh_credentials 的测试：库文件 `refs:` 段判定的表驱动用例（解析是这条链最易错的部分）。

use super::*;
use std::fs;

fn store_with(content: &str) -> std::path::PathBuf {
    // 夹具路径若只按 pid 命名，同模块并行用例会写到同一个 `.credentials.yaml`（写入即串味），
    // 故每次调用取新目录（进程内计数，跨进程由 pid 区分）。
    static SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("worldsea-cred-test-{}-{seq}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(".credentials.yaml"), content).unwrap();
    dir
}

#[test]
fn refs_entry_is_found_at_any_depth_inside_the_section() {
    let dir = store_with("version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-x\n");
    assert!(credential_store_has(&dir, "DEEPSEEK_API_KEY"));
    let deep = store_with("version: 1\nrefs:\n    DEEPSEEK_API_KEY: sk-x\n");
    assert!(credential_store_has(&deep, "DEEPSEEK_API_KEY"));
    let quoted = store_with("version: 1\nrefs:\n  \"DEEPSEEK_API_KEY\": sk-x\n");
    assert!(credential_store_has(&quoted, "DEEPSEEK_API_KEY"));
}

#[test]
fn other_refs_entries_do_not_match_and_missing_file_is_false() {
    let other = store_with("version: 1\nrefs:\n  OPENAI_API_KEY: sk-y\n");
    assert!(!credential_store_has(&other, "DEEPSEEK_API_KEY"));
    assert!(!credential_store_has(&std::env::temp_dir().join("worldsea-nonexistent-home"), "DEEPSEEK_API_KEY"));
}

#[test]
fn records_section_is_not_a_ref_and_a_real_store_without_refs_is_false() {
    // 真实现场形状：只有 version + records（browser-session 授权），没有 refs 段。
    let real = store_with("version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      version: 1\n      secret: wg\n");
    assert!(!credential_store_has(&real, "DEEPSEEK_API_KEY"));
}

#[test]
fn a_top_level_looking_name_after_the_refs_section_does_not_match() {
    let ended = store_with("version: 1\nrefs:\n  OTHER: sk\nDEEPSEEK_API_KEY: sk-z\n");
    assert!(!credential_store_has(&ended, "DEEPSEEK_API_KEY"));
}

#[test]
fn empty_refs_section_is_false() {
    for content in ["version: 1\nrefs:\n", "version: 1\nrefs: {}\n", "# refs:\n  DEEPSEEK_API_KEY: sk\n"] {
        let dir = store_with(content);
        assert!(!credential_store_has(&dir, "DEEPSEEK_API_KEY"), "{content}");
    }
}

/// 剥离面按库动态取：模型页配置的**任意** provider 凭据都要被发现，
/// 不能只认 DeepSeek 一家（否则第三方 provider 的界面配置被继承环境永久盖住）。
#[test]
fn every_provider_key_in_the_store_is_discovered() {
    let dir = store_with(
        "version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-a\n  ANTDIGITAL_API_KEY: sk-b\n  OPENCSG_API_KEY: sk-c\n",
    );
    let names = credential_ref_names(&dir);
    assert_eq!(names, ["DEEPSEEK_API_KEY", "ANTDIGITAL_API_KEY", "OPENCSG_API_KEY"]);
}

/// `records:` 段里的 `<owner>/<id>` 与插件凭据不是「凭据名」，不能被当作要剥的环境变量。
#[test]
fn records_section_entries_are_not_ref_names() {
    let dir = store_with(
        "version: 1\nrecords:\n  deepseek-account-platform/device:\n    kind: grant\n    payload:\n      id: abc\nrefs:\n  ANTDIGITAL_API_KEY: sk-a\n",
    );
    assert_eq!(credential_ref_names(&dir), ["ANTDIGITAL_API_KEY"]);
}

/// 只接受环境变量形态的键（非 `[A-Za-z0-9_]` 的行不算），避免把嵌套结构误当凭据名。
#[test]
fn only_environment_variable_shaped_names_are_collected() {
    let dir = store_with("version: 1\nrefs:\n  \"QUOTED_KEY\": sk-a\n  nested:\n    inner: x\n");
    assert_eq!(credential_ref_names(&dir), ["QUOTED_KEY"]);
}

/// 重复名只出现一次（真实库可能由多次写入留下重复行）。
#[test]
fn repeated_names_are_deduplicated() {
    let dir = store_with("version: 1\nrefs:\n  A_KEY: sk-1\n  A_KEY: sk-2\n");
    assert_eq!(credential_ref_names(&dir), ["A_KEY"]);
}
