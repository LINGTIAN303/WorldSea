// 系统字体扫描（字体系统 v2 批 2）：零依赖实现——枚举 Windows 字体目录（系统级
// %WINDIR%\Fonts + 用户级 %LOCALAPPDATA%\Microsoft\Windows\Fonts）的 ttf/otf/ttc，
// 逐文件 seek 读头部解析 sfnt name/OS-2 表拿 family/weight/style；不读注册表。
// cmd_font_read_file 校验路径必须在字体目录内（防任意文件读）。测试覆盖表解析与路径校验。
//
// 与前端 TauriFontBridge.SystemFontInfo 字段对齐（camelCase 序列化）。

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// 扫描结果条目（与前端 TauriFontBridge.SystemFontInfo 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontInfo {
    pub family: String,
    pub path: String,
    pub weight: u16,
    pub style: String,
    pub format: String,
}

/// 单个字体文件解析出的变体信息（文件 → 1..n 变体：ttc 容器含多 sfnt）。
/// format 为文件级属性（扩展名决定），不在此层携带。
#[derive(Debug)]
struct FontVariant {
    family: String,
    weight: u16,
    style: String,
}

/// Windows 字体目录（系统级 + 用户级；缺失的目录自动跳过）
fn font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(windir) = std::env::var("WINDIR") {
        dirs.push(PathBuf::from(windir).join("Fonts"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        dirs.push(PathBuf::from(local).join("Microsoft").join("Windows").join("Fonts"));
    }
    dirs
}

/// 同步扫描主实现：枚举字体目录 → 逐文件解析 → 同 family 去重 → family 字母序
fn scan_system_fonts() -> Vec<SystemFontInfo> {
    let mut out: Vec<SystemFontInfo> = Vec::new();
    for dir in font_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            let format = match ext.as_str() {
                "ttf" => "truetype",
                "otf" => "opentype",
                "ttc" => "collection",
                _ => continue,
            };
            let Ok(mut file) = File::open(&path) else { continue };
            for v in parse_font_file(&mut file) {
                // 去重键：family+weight+style（同键不同文件只留第一个——系统字体目录中罕见，防 ttc 重复）
                let key = (v.family.clone(), v.weight, v.style.clone());
                if out.iter().any(|i| (i.family.clone(), i.weight, i.style.clone()) == key) {
                    continue;
                }
                out.push(SystemFontInfo {
                    family: v.family,
                    path: path.to_string_lossy().into_owned(),
                    weight: v.weight,
                    style: v.style,
                    format: format.to_string(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()));
    out
}

/// 解析一个字体文件（ttf/otf 单体或 ttc 容器）为 1..n 变体
fn parse_font_file(file: &mut File) -> Vec<FontVariant> {
    // 读 12 字节 sfnt 头判定类型；ttc 容器（'ttcf'）展开内部各 sfnt 的偏移
    let mut header = [0u8; 12];
    if file.read_exact(&mut header).is_err() {
        return Vec::new();
    }
    let tag = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
    match tag {
        0x0001_0000 | 0x4F54_544F => vec![parse_sfnt(file, 0)],
        0x7474_6366 => {
            // TTC：tag(4)+version(4)+numFonts(4)+offsets[numFonts]
            let num = u32::from_be_bytes([header[8], header[9], header[10], header[11]]);
            let num = num.min(64) as usize;
            let mut offs = vec![0u8; num * 4];
            if file.read_exact(&mut offs).is_err() {
                return Vec::new();
            }
            (0..num)
                .map(|i| {
                    let off = u32::from_be_bytes([
                        offs[i * 4],
                        offs[i * 4 + 1],
                        offs[i * 4 + 2],
                        offs[i * 4 + 3],
                    ]) as u64;
                    parse_sfnt(file, off)
                })
                .collect()
        }
        _ => Vec::new(),
    }
}

/// 解析单个 sfnt（ttf/otf）的 name 表（nameID=1 family）与 OS/2 表（weight/style）
fn parse_sfnt(file: &mut File, base: u64) -> FontVariant {
    let mut head = [0u8; 6];
    let fallback = FontVariant {
        family: String::new(),
        weight: 400,
        style: "normal".into(),
    };
    if file.seek(SeekFrom::Start(base + 4)).is_err() || file.read_exact(&mut head).is_err() {
        return fallback;
    }
    let num_tables = u16::from_be_bytes([head[0], head[1]]);
    // table record: tag(4)+checksum(4)+offset(4)+length(4)；在记录区找 'name' 与 'OS/2'
    let mut name_off = None;
    let mut os2_off = None;
    for i in 0..num_tables as u64 {
        let rec = base + 12 + i * 16;
        if file.seek(SeekFrom::Start(rec)).is_err() {
            return fallback;
        }
        let mut tagb = [0u8; 4];
        if file.read_exact(&mut tagb).is_err() {
            return fallback;
        }
        let mut offlen = [0u8; 8];
        if file.read_exact(&mut offlen).is_err() {
            return fallback;
        }
        // tag 后 8 字节 = checksum(4) + offset(4)：表数据偏移在 [4..8]（length 在其后，本解析不需要）
        match &tagb {
            b"name" => name_off = Some(u32::from_be_bytes([offlen[4], offlen[5], offlen[6], offlen[7]]) as u64),
            b"OS/2" => os2_off = Some(u32::from_be_bytes([offlen[4], offlen[5], offlen[6], offlen[7]]) as u64),
            _ => {}
        }
    }
    let family = name_off.and_then(|o| read_family_name(file, o)).unwrap_or_default();
    let (weight, style) = os2_off.map(|o| read_os2(file, o)).unwrap_or((400, "normal".into()));
    FontVariant { family, weight, style }
}

/// 读 name 表取 nameID=1（family）。优先 Windows 平台 UTF-16BE（3,1），回退 Unicode（0,x）与 Mac Roman（1,0）
fn read_family_name(file: &mut File, table_off: u64) -> Option<String> {
    let mut hdr = [0u8; 6];
    if file.seek(SeekFrom::Start(table_off)).is_err() || file.read_exact(&mut hdr).is_err() {
        return None;
    }
    let count = u16::from_be_bytes([hdr[2], hdr[3]]) as usize;
    let strings_off = u16::from_be_bytes([hdr[4], hdr[5]]) as u64;
    let mut best: Option<(u8, String)> = None;
    for i in 0..count {
        let rec = table_off + 6 + i as u64 * 12;
        if file.seek(SeekFrom::Start(rec)).is_err() {
            return best.map(|(_, s)| s);
        }
        let mut recb = [0u8; 12];
        if file.read_exact(&mut recb).is_err() {
            return best.map(|(_, s)| s);
        }
        let platform = u16::from_be_bytes([recb[0], recb[1]]);
        let encoding = u16::from_be_bytes([recb[2], recb[3]]);
        let name_id = u16::from_be_bytes([recb[6], recb[7]]);
        let length = u16::from_be_bytes([recb[8], recb[9]]);
        let offset = u16::from_be_bytes([recb[10], recb[11]]);
        if name_id != 1 || length == 0 {
            continue;
        }
        // 优先级：Windows UTF-16BE(3,1)=0 > Unicode(0,*)=1 > Mac Roman(1,0)=2
        let prio = match (platform, encoding) {
            (3, 1) => 0,
            (0, _) => 1,
            (1, 0) => 2,
            _ => continue,
        };
        if best.as_ref().is_some_and(|(p, _)| *p <= prio) {
            continue;
        }
        let abs = table_off + strings_off + offset as u64;
        if file.seek(SeekFrom::Start(abs)).is_err() {
            continue;
        }
        let mut buf = vec![0u8; length as usize];
        if file.read_exact(&mut buf).is_err() {
            continue;
        }
        let text = match prio {
            0 | 1 => decode_utf16be(&buf),
            _ => String::from_utf8_lossy(&buf).into_owned(),
        };
        if !text.trim().is_empty() {
            best = Some((prio, text.trim().to_string()));
        }
    }
    best.map(|(_, s)| s)
}

/// UTF-16BE 解码（无依赖；非法代理对以 U+FFFD 兜底）
fn decode_utf16be(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

/// 读 OS/2 表：usWeightClass（偏移 4，uint16）与 fsSelection（偏移 62，uint16 的 ITALIC/OBLIQUE 位）
fn read_os2(file: &mut File, table_off: u64) -> (u16, String) {
    let mut b = [0u8; 64];
    if file.seek(SeekFrom::Start(table_off)).is_err() || file.read_exact(&mut b).is_err() {
        return (400, "normal".into());
    }
    let weight = u16::from_be_bytes([b[4], b[5]]);
    let fs_selection = u16::from_be_bytes([b[62], b[63]]);
    let style = if fs_selection & 0x0001 != 0 {
        "italic"
    } else if fs_selection & 0x0200 != 0 {
        "oblique"
    } else {
        "normal"
    };
    (weight, style.into())
}

/// 路径校验：canonicalize 后必须位于字体目录内（防任意文件读；测试可注入目录清单）
fn is_under_font_dirs(candidate: &Path, dirs: &[PathBuf]) -> bool {
    let Ok(canon) = candidate.canonicalize() else { return false };
    dirs.iter().any(|dir| {
        dir.canonicalize()
            .map(|d| canon.starts_with(&d))
            .unwrap_or(false)
    })
}

/// 扫描系统字体（tokio 阻塞线程池执行——目录几百文件的头部解析不占命令线程）
#[tauri::command]
pub async fn cmd_font_scan_system() -> Result<Vec<SystemFontInfo>, String> {
    tokio::task::spawn_blocking(scan_system_fonts)
        .await
        .map_err(|e| format!("字体扫描任务失败: {e}"))
}

/// 读取字体文件字节（仅限字体目录内；前端「安装到库」用）
#[tauri::command]
pub async fn cmd_font_read_file(path: String) -> Result<Vec<u8>, String> {
    let src = PathBuf::from(&path);
    let dirs = font_dirs();
    if !is_under_font_dirs(&src, &dirs) {
        return Err(format!("路径不在字体目录内，拒绝读取: {path}"));
    }
    tokio::task::spawn_blocking(move || std::fs::read(&src).map_err(|e| e.to_string()))
        .await
        .map_err(|e| format!("字体读取任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造最小可用 sfnt 测试文件字节：header(numTables=n) + 记录区 + 数据区
    struct SfntFixture {
        buf: Vec<u8>,
    }

    impl SfntFixture {
        /// version 占位 0x00010000；tables: 传入 (tag, 数据字节)
        fn build(tables: Vec<(&str, Vec<u8>)>) -> SfntFixture {
            let n = tables.len();
            let header_len = 12 + n * 16;
            let mut buf = vec![0u8; header_len];
            buf[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
            buf[4..6].copy_from_slice(&(n as u16).to_be_bytes());
            let mut data = Vec::new();
            for (i, (tag, body)) in tables.into_iter().enumerate() {
                let rec = 12 + i * 16;
                buf[rec..rec + 4].copy_from_slice(tag.as_bytes());
                let off = header_len as u32 + data.len() as u32;
                buf[rec + 8..rec + 12].copy_from_slice(&off.to_be_bytes());
                buf[rec + 12..rec + 16].copy_from_slice(&(body.len() as u32).to_be_bytes());
                data.extend_from_slice(&body);
            }
            buf.extend_from_slice(&data);
            SfntFixture { buf }
        }

        fn write_to(self, dir: &Path, name: &str) -> PathBuf {
            let p = dir.join(name);
            std::fs::write(&p, &self.buf).unwrap();
            p
        }
    }

    /// 构造 name 表字节（仅一条 Windows UTF-16BE 的 nameID=1 记录）
    fn name_table(family: &str) -> Vec<u8> {
        let utf16: Vec<u8> = family
            .encode_utf16()
            .flat_map(|u| u.to_be_bytes())
            .collect();
        let count = 1usize;
        let strings_off = 6u16 + 12u16 * count as u16;
        let mut t = Vec::new();
        t.extend_from_slice(&0u16.to_be_bytes()); // format
        t.extend_from_slice(&(count as u16).to_be_bytes());
        t.extend_from_slice(&strings_off.to_be_bytes());
        // record: platform=3 encoding=1 lang=0 nameID=1 len offset=0
        t.extend_from_slice(&3u16.to_be_bytes());
        t.extend_from_slice(&1u16.to_be_bytes());
        t.extend_from_slice(&0u16.to_be_bytes());
        t.extend_from_slice(&1u16.to_be_bytes());
        t.extend_from_slice(&(utf16.len() as u16).to_be_bytes());
        t.extend_from_slice(&0u16.to_be_bytes());
        t.extend_from_slice(&utf16);
        t
    }

    #[test]
    fn parses_family_from_minimal_sfnt() {
        let dir = std::env::temp_dir().join("ws-font-scan-test");
        std::fs::create_dir_all(&dir).unwrap();
        let p = SfntFixture::build(vec![("name", name_table("Test Family"))]).write_to(&dir, "a.ttf");
        let mut f = File::open(&p).unwrap();
        let vs = parse_font_file(&mut f);
        eprintln!("DEBUG variants={vs:?}");
        assert_eq!(vs.len(), 1);
        assert_eq!(vs[0].family, "Test Family");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn rejects_paths_outside_font_dirs() {
        let base = std::env::temp_dir().join("ws-font-scan-guard");
        let inside = base.join("fonts");
        std::fs::create_dir_all(&inside).unwrap();
        let f_in = inside.join("a.ttf");
        std::fs::write(&f_in, b"x").unwrap();
        let f_out = base.join("secret.txt");
        std::fs::write(&f_out, b"x").unwrap();
        let dirs = vec![inside.clone()];
        assert!(is_under_font_dirs(&f_in, &dirs));
        assert!(!is_under_font_dirs(&f_out, &dirs));
        assert!(!is_under_font_dirs(&base.join("nope.ttf"), &dirs));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn decodes_utf16be_names() {
        // 「雅黑」两个 BMP 字符
        let bytes: Vec<u8> = "雅黑"
            .encode_utf16()
            .flat_map(|u| u.to_be_bytes())
            .collect();
        assert_eq!(decode_utf16be(&bytes), "雅黑");
        assert_eq!(decode_utf16be(&[]), "");
    }

    /// 真机验证（cargo test --lib font_scan -- --ignored --nocapture）：扫真实字体目录抽 5 条
    #[test]
    #[ignore]
    fn scans_real_system_fonts() {
        let all = scan_system_fonts();
        println!("系统字体总数: {}", all.len());
        for info in all.iter().take(5) {
            println!("  {} ({}) w={} {} [{}]", info.family, info.path, info.weight, info.style, info.format);
        }
        assert!(!all.is_empty());
    }
}
