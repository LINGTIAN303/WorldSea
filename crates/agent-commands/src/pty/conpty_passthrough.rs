//! Windows ConPTY PASSTHROUGH backend（P2-1 自研，2026-09-01）
//!
//! 目的：portable-pty 0.9 硬编码 ConPTY flags（INHERIT_CURSOR | RESIZE_QUIRK | WIN32_INPUT_MODE）
//! 无法注入 `PSEUDOCONSOLE_PASSTHROUGH_MODE(0x8)`——该模式让 ConPTY 直通子进程原始 VT 字节流
//! （无需虚拟屏重渲染），TUI 输出与 POSIX PTY 同语义。仅 Windows 11 22H2+/Server 2025 原生生效；
//! Windows 10（1809+）需 side-load 官方 conpty.dll + OpenConsole.exe（参见 `passthrough_enabled`）。
//!
//! 本模块为**独立实现**（不依赖 portable-pty 的 trait/内部方法），自建小型
//! `PassthroughPty` 抽象；pty/mod.rs 平台分流后，Windows 走本后端，其余走 portable-pty。
//!
//! 参考：portable-pty 的 win/psuedocon.rs + win/conpty.rs + win/mod.rs（wezterm MIT 许可），
//! 改用 windows-sys 0.61 直链，flags 新增 0x8；HANDLE 指针用 `unsafe Send` 包装。

#![cfg(windows)]

// 本后端部分方法（resize/try_wait/wait/kill/process_id）为供后续会话层复用的 API 面，
// 当前 spawn_passthrough 直接内联使用核心路径；未达调用面不产生告警。
#![allow(dead_code)]

use std::io::{Error as IoError, ErrorKind, Read, Write};
use std::mem;
use std::os::windows::io::RawHandle;
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, DuplicateHandle, HANDLE, INVALID_HANDLE_VALUE, STILL_ACTIVE, DUPLICATE_SAME_ACCESS};
use windows_sys::Win32::System::Console::{
    ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD,
    PSEUDOCONSOLE_INHERIT_CURSOR,
};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW,
    CreateProcessW, GetCurrentProcess, GetExitCodeProcess, GetProcessId, TerminateProcess,
    WaitForSingleObject, INFINITE, EXTENDED_STARTUPINFO_PRESENT, STARTF_USESTDHANDLES,
    STARTUPINFOEXW, InitializeProcThreadAttributeList, UpdateProcThreadAttribute,
    DeleteProcThreadAttributeList,
};

/// PASSTHROUGH_MODE(0x8)——windows-sys 0.61 未声明，本地定义
const PSEUDOCONSOLE_PASSTHROUGH_MODE: u32 = 0x8;
/// windows-sys 0.61 未声明（仅 INHERIT_CURSOR）；本地补齐
const PSEUDOCONSOLE_RESIZE_QUIRK: u32 = 0x2;
const PSEUDOCONSOLE_WIN32_INPUT_MODE: u32 = 0x4;

/// PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x0002_0016;
/// 线程属性列表指针类型（windows-sys 定义于 Threading，此处用裸指针）
type ProcThreadAttributeListPtr = *mut std::ffi::c_void;

/// 匿名管道缓冲区（64 KiB，避免小缓冲死锁，对齐 running-process#150）
const PIPE_BUFFER_SIZE: u32 = 64 * 1024;

/// CREATE_UNICODE_ENVIRONMENT（0x0000_0400）——环境块为 UTF-16 时必带此 flag，
/// 否则系统会把块按 ANSI 解释（非 ASCII 值乱码）。本地定义避免跨 features 依赖。
const CREATE_UNICODE_ENVIRONMENT: u32 = 0x0000_0400;

/// HANDLE 的 Send 包装（HANDLE = *mut c_void 非 Send；HANDLE 实际是内核句柄整数值，
/// 跨线程仅传递值不转移所有权语义——Drop 由包装持有者负责）
#[derive(Debug)]
pub(crate) struct HHandle(pub HANDLE);
unsafe impl Send for HHandle {}
unsafe impl Sync for HHandle {}

// ─── 构建版本探测：Windows 11 22H2（build 22000）以上原生支持 0x8 ───
fn os_build_number() -> u32 {
    #[repr(C)]
    struct RTL_OSVERSIONINFOW {
        dw_os_version_info_size: u32,
        dw_major_version: u32,
        dw_minor_version: u32,
        dw_build_number: u32,
        dw_platform_id: u32,
        sz_csd_version: [u16; 128],
    }
    type RtlGetVersion = unsafe extern "system" fn(*mut RTL_OSVERSIONINFOW) -> i32;

    unsafe {
        // GetModuleHandleW 返回 *mut c_void（null=未找到）；GetProcAddress 返回 Option<FARPROC>
        let module = GetModuleHandleW(windows_sys::core::w!("ntdll.dll"));
        if module.is_null() {
            return 0;
        }
        let Some(addr) = GetProcAddress(module, b"RtlGetVersion\0".as_ptr() as _) else {
            return 0;
        };
        let f: RtlGetVersion = std::mem::transmute(addr);
        let mut info = RTL_OSVERSIONINFOW {
            dw_os_version_info_size: mem::size_of::<RTL_OSVERSIONINFOW>() as u32,
            dw_major_version: 0,
            dw_minor_version: 0,
            dw_build_number: 0,
            dw_platform_id: 0,
            sz_csd_version: [0; 128],
        };
        if f(&mut info) < 0 {
            return 0;
        }
        info.dw_build_number
    }
}

/// 0x8 是否原生生效（Win11 22H2+/Server 2025 = build ≥ 22000）
///
/// Win10 上内核忽略该 flag → 退化为虚拟屏（功能可用，非 raw）；此时若部署 side-load
/// 官方 conpty.dll（Microsoft.Windows.Console.ConPTY）可获得 passthrough 行为。
fn passthrough_enabled() -> bool {
    os_build_number() >= 22_000
}

// ─── PsuedoCon（HPCON 包装）─────────────────────────────────

/// ConPTY 句柄包装（Drop 时 ClosePseudoConsole）
struct PsuedoCon {
    con: isize,
}

unsafe impl Send for PsuedoCon {}
unsafe impl Sync for PsuedoCon {}

impl Drop for PsuedoCon {
    fn drop(&mut self) {
        unsafe { ClosePseudoConsole(self.con) };
    }
}

impl PsuedoCon {
    fn new(size: COORD, input: HANDLE, output: HANDLE) -> anyhow::Result<Self> {
        let mut con: isize = INVALID_HANDLE_VALUE as isize;
        let flags = PSEUDOCONSOLE_INHERIT_CURSOR
            | PSEUDOCONSOLE_RESIZE_QUIRK
            | PSEUDOCONSOLE_WIN32_INPUT_MODE
            | if passthrough_enabled() {
                PSEUDOCONSOLE_PASSTHROUGH_MODE
            } else {
                0
            };
        let hr = unsafe { CreatePseudoConsole(size, input, output, flags, &mut con) };
        if hr < 0 {
            anyhow::bail!("CreatePseudoConsole failed: HRESULT {hr:#x}");
        }
        Ok(Self { con })
    }

    fn resize(&self, size: COORD) -> anyhow::Result<()> {
        let hr = unsafe { ResizePseudoConsole(self.con, size) };
        if hr < 0 {
            anyhow::bail!("ResizePseudoConsole failed: HRESULT {hr:#x}");
        }
        Ok(())
    }

    /// 暴露 HPCON 句柄值（供 PassthroughMaster resize 通道使用；Close 由 PsuedoCon Drop 负责，此处仅拷贝值）
    fn hpcon(&self) -> isize {
        self.con
    }
}

// ─── ProcThreadAttributeList ────────────────────────────────

/// PSEUDOCONSOLE 线程属性列表（CreateProcessW 挂载 ConPTY）
struct ProcThreadAttributeList {
    data: Vec<u8>,
}

impl ProcThreadAttributeList {
    fn with_capacity(num_attributes: u32) -> anyhow::Result<Self> {
        let mut bytes_required: usize = 0;
        unsafe {
            InitializeProcThreadAttributeList(
                ptr::null_mut(),
                num_attributes,
                0,
                &mut bytes_required,
            );
        }
        let mut data = Vec::with_capacity(bytes_required);
        unsafe { data.set_len(bytes_required) };
        let attr_ptr = data.as_mut_slice().as_mut_ptr() as ProcThreadAttributeListPtr;
        let res =
            unsafe { InitializeProcThreadAttributeList(attr_ptr, num_attributes, 0, &mut bytes_required) };
        if res == 0 {
            anyhow::bail!("InitializeProcThreadAttributeList failed: {}", IoError::last_os_error());
        }
        Ok(Self { data })
    }

    fn as_mut_ptr(&mut self) -> ProcThreadAttributeListPtr {
        self.data.as_mut_slice().as_mut_ptr() as _
    }

    fn set_pty(&mut self, con: isize) -> anyhow::Result<()> {
        let res = unsafe {
            UpdateProcThreadAttribute(
                self.as_mut_ptr(),
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                con as _,
                mem::size_of::<isize>(),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if res == 0 {
            anyhow::bail!("UpdateProcThreadAttribute failed: {}", IoError::last_os_error());
        }
        Ok(())
    }
}

impl Drop for ProcThreadAttributeList {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.as_mut_ptr()) };
    }
}

// ─── Passthrough PTY（自建抽象，Windows 专用）──────────────

/// 自研 passthrough PTY 会话
pub struct PassthroughPty {
    /// ConPTY 句柄（Drop 自动 Close）
    con: PsuedoCon,
    /// 子进程输出读端（master）
    reader: HHandle,
    #[allow(dead_code)] // 保留原始 w 句柄所有权；读写经 dup
    writer: HHandle,
    /// 子进程句柄（kill/wait/pid）
    pub(crate) child_proc: HHandle,
    #[allow(dead_code)]
    cols: u16,
    #[allow(dead_code)]
    rows: u16,
}

// HHandle 已 unsafe Send，PassthroughPty 整体可 Send（内部无 !Send 字段）
unsafe impl Send for PassthroughPty {}

impl PassthroughPty {
    /// 创建 passthrough 会话并 spawn 子进程
    ///
    /// `shell`：subprocess 可执行路径（cmd.exe / powershell.exe / bash 等）
    /// `cwd`：工作目录；`env_list`：附加环境变量；`cols/rows`：终端尺寸
    ///
    /// E3-3（2026-09-18）：以受限令牌挂载 ConPTY（`token=None` 为不受限通路）；
    /// 受限令牌的派生与生命周期由 `crate::sandbox::win` 持有，此处只接受裸句柄（不转移所有权）。
    pub fn spawn_with_token(
        shell: &str,
        cwd: &str,
        env_list: &[(String, String)],
        cols: u16,
        rows: u16,
        token: Option<HANDLE>,
    ) -> anyhow::Result<Self> {
        // 1) 管道对：in_read→ConPTY 输入、out_write→ConPTY 输出
        let mut in_read: HANDLE = INVALID_HANDLE_VALUE as _;
        let mut in_write: HANDLE = INVALID_HANDLE_VALUE as _;
        let sa = unsafe { mem::zeroed() };
        let ok1 = unsafe { CreatePipe(&mut in_read, &mut in_write, &sa, PIPE_BUFFER_SIZE) };
        if ok1 == 0 {
            anyhow::bail!("CreatePipe(input) failed: {}", IoError::last_os_error());
        }
        let mut out_read: HANDLE = INVALID_HANDLE_VALUE as _;
        let mut out_write: HANDLE = INVALID_HANDLE_VALUE as _;
        let ok2 = unsafe { CreatePipe(&mut out_read, &mut out_write, &sa, PIPE_BUFFER_SIZE) };
        if ok2 == 0 {
            anyhow::bail!("CreatePipe(output) failed: {}", IoError::last_os_error());
        }

        // 2) 创建 ConPTY（0x8 passthrough）
        let con = PsuedoCon::new(
            COORD { X: cols as i16, Y: rows as i16 },
            in_read,
            out_write,
        )?;

        // 3) Spawn 子进程（挂 ConPTY，经 STARTUPINFOEX；token 为 Some 时受限令牌启动）
        let (child_proc, _child_thread) = spawn_child_into_conpty(
            &con,
            shell,
            cwd,
            env_list,
            token,
        )?;
        // 关闭线程句柄（防泄漏）
        let _ = unsafe { CloseHandle(_child_thread) };

        // 4) master 端句柄：读=out_read（子输出），写=in_write（子输入）
        Ok(Self {
            con,
            reader: HHandle(out_read),
            writer: HHandle(in_write),
            child_proc: HHandle(child_proc),
            cols,
            rows,
        })
    }

    /// 克隆输出读端（阻塞读子进程原始 VT 字节流）
    pub fn try_clone_reader(&self) -> anyhow::Result<HandleReader> {
        HandleReader::new(self.reader.0)
    }

    /// 克隆输入写端（写命令/交互输入）
    pub fn try_clone_writer(&self) -> anyhow::Result<HandleWriter> {
        HandleWriter::new(self.writer.0)
    }

    /// resize ConPTY
    pub fn resize(&self, cols: u16, rows: u16) -> anyhow::Result<()> {
        self.con.resize(COORD { X: cols as i16, Y: rows as i16 })?;
        Ok(())
    }

    /// 暴露 HPCON 值（PassthroughMaster 的 resize 通道用；Close 由 PsuedoCon Drop 负责）
    pub fn hpcon(&self) -> isize {
        self.con.hpcon()
    }

    /// 子进程是否已完成（非阻塞）；Some(status)=已退出
    pub fn try_wait(&self) -> anyhow::Result<Option<u32>> {
        unsafe {
            let mut status: u32 = 0;
            let res = GetExitCodeProcess(self.child_proc.0, &mut status);
            if res == 0 {
                anyhow::bail!("GetExitCodeProcess failed: {}", IoError::last_os_error());
            }
            if status == STILL_ACTIVE as u32 {
                Ok(None)
            } else {
                Ok(Some(status))
            }
        }
    }

    /// 阻塞等待子进程退出，返回退出码
    pub fn wait(&self) -> anyhow::Result<u32> {
        unsafe { WaitForSingleObject(self.child_proc.0, INFINITE) };
        unsafe {
            let mut status: u32 = 0;
            let res = GetExitCodeProcess(self.child_proc.0, &mut status);
            if res == 0 {
                anyhow::bail!("GetExitCodeProcess failed: {}", IoError::last_os_error());
            }
            Ok(status)
        }
    }

    /// 终止子进程
    pub fn kill(&self) -> anyhow::Result<()> {
        unsafe {
            let res = TerminateProcess(self.child_proc.0, 1);
            if res == 0 {
                anyhow::bail!("TerminateProcess failed: {}", IoError::last_os_error());
            }
        }
        Ok(())
    }

    pub fn process_id(&self) -> Option<u32> {
        unsafe {
            let pid = GetProcessId(self.child_proc.0);
            if pid == 0 { None } else { Some(pid) }
        }
    }
}

// ─── CreateProcessW 挂载 ConPTY ─────────────────────────────

fn spawn_child_into_conpty(
    con: &PsuedoCon,
    shell: &str,
    cwd: &str,
    env_list: &[(String, String)],
    token: Option<HANDLE>,
) -> anyhow::Result<(HANDLE, HANDLE)> {
    let mut si: STARTUPINFOEXW = unsafe { mem::zeroed() };
    si.StartupInfo.cb = mem::size_of::<STARTUPINFOEXW>() as u32;
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = INVALID_HANDLE_VALUE as HANDLE;
    si.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE as HANDLE;
    si.StartupInfo.hStdError = INVALID_HANDLE_VALUE as HANDLE;

    let mut attrs = ProcThreadAttributeList::with_capacity(1)?;
    attrs.set_pty(con.con)?;
    si.lpAttributeList = attrs.as_mut_ptr();

    // cwd（可空）
    let wide_cwd: Vec<u16> = if cwd.is_empty() {
        Vec::new()
    } else {
        cwd.encode_utf16().chain(Some(0)).collect()
    };
    // 环境块（E1，2026-09-18 工作区与环境对齐 dsh）：父进程环境**剔除敏感变量** +
    // 显式 env_list 覆盖，恒传块（不再 null 继承）——与命令执行 / portable-pty 回落后端同口径。
    let env_wide = build_env_block(env_list);

    let mut pi = unsafe { mem::zeroed() };
    // CreateProcessW：lpApplicationName 传 null + lpCommandLine 携带 shell——让系统按 PATH 解析
    // 可执行文件（cmd.exe 等），且 cwd 为 "." 时不受相对路径限制。lpCommandLine 必须可变。
    // E3-3（2026-09-18）：token 为 Some 时改走 CreateProcessAsUserW（受限令牌挂载 ConPTY），
    // 其余参数同形（含 ConPTY 伪控制台线程属性列表；bInheritHandles 保持 false）。
    let mut wide_cmdline: Vec<u16> = shell.encode_utf16().chain(Some(0)).collect();
    let flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT;
    let env_ptr = env_wide.as_ptr() as *const std::ffi::c_void;
    let cwd_ptr = if wide_cwd.is_empty() {
        ptr::null()
    } else {
        wide_cwd.as_ptr()
    };
    let res = unsafe {
        match token {
            Some(tok) => CreateProcessAsUserW(
                tok,
                ptr::null(),
                wide_cmdline.as_mut_ptr(),
                ptr::null(),
                ptr::null(),
                0, // bInheritHandles=false
                flags,
                env_ptr,
                cwd_ptr,
                &si.StartupInfo,
                &mut pi,
            ),
            None => CreateProcessW(
                ptr::null(),          // lpApplicationName = null（用 PATH 搜索）
                wide_cmdline.as_mut_ptr(), // lpCommandLine（shell 路径，可变非空）
                ptr::null(),
                ptr::null(),
                0, // bInheritHandles=false
                // CREATE_UNICODE_ENVIRONMENT：块为 UTF-16，缺该 flag 会被系统按 ANSI 解释
                flags,
                env_ptr,
                cwd_ptr,
                &si.StartupInfo,
                &mut pi,
            ),
        }
    };
    if res == 0 {
        anyhow::bail!(
            "ConPTY 子进程创建失败 `{shell}` in `{cwd}`（受限令牌={}）: {}",
            token.is_some(),
            IoError::last_os_error()
        );
    }
    Ok((pi.hProcess, pi.hThread))
}

// ─── 环境块构建（E1 口径统一）───────────────────────────────

/// 构造传给 CreateProcessW 的环境块：**父进程环境剔除敏感变量** + 显式 `env_list` 覆盖
///
/// - 敏感判定与命令执行 / MCP stdio 同源：`agent_runtime::env_scrub::is_sensitive_env_key`
/// - Windows 环境变量名大小写不敏感：以大写名归并，显式项覆盖父项、保留显式项原名
/// - 输出 UTF-16 `"K=V\0"` 序列 + 末尾双 null（须与 `CREATE_UNICODE_ENVIRONMENT` 同用）
///
/// `pub(crate)`：E3-2 受限 spawn（sandbox::win）与 PTY 同口径复用（显式 env 含 TMP/TEMP 重写）
pub(crate) fn build_env_block(env_list: &[(String, String)]) -> Vec<u16> {
    build_env_block_from(std::env::vars_os(), env_list)
}

/// [`build_env_block`] 的可注入版本（父环境迭代器入参，便于单测）
fn build_env_block_from(
    parent: impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
    env_list: &[(String, String)],
) -> Vec<u16> {
    use std::collections::BTreeMap;
    let mut merged: BTreeMap<String, (String, String)> = BTreeMap::new();
    for (k, v) in parent {
        let (Ok(k), Ok(v)) = (k.into_string(), v.into_string()) else {
            continue; // 非 UTF-8 键/值跳过（无法判定与编码）
        };
        if agent_runtime::env_scrub::is_sensitive_env_key(&k) {
            continue; // E1：敏感变量不继承
        }
        merged.insert(k.to_ascii_uppercase(), (k, v));
    }
    // 显式注入在清洗**之后**合并（显式传入的 key 不受清洗影响）
    for (k, v) in env_list {
        merged.insert(k.to_ascii_uppercase(), (k.clone(), v.clone()));
    }
    let mut block: Vec<u16> = Vec::new();
    for (_, (k, v)) in merged {
        block.extend(k.encode_utf16());
        block.push(b'=' as u16);
        block.extend(v.encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    /// 环境块解码为 (K, V) 列表（供断言；忽略双 null 结尾产生的空段）
    fn decode(block: &[u16]) -> Vec<(String, String)> {
        let mut out = Vec::new();
        for seg in block.split(|&c| c == 0) {
            if seg.is_empty() {
                continue;
            }
            let s = String::from_utf16(seg).expect("utf16");
            if let Some((k, v)) = s.split_once('=') {
                out.push((k.to_string(), v.to_string()));
            }
        }
        out
    }

    fn pair(k: &str, v: &str) -> (OsString, OsString) {
        (OsString::from(k), OsString::from(v))
    }

    /// E1：敏感变量不继承，运行必需变量保留
    #[test]
    fn sensitive_keys_not_inherited() {
        let parent = vec![
            pair("PATH", "C:\\bin"),
            pair("SystemRoot", "C:\\Windows"),
            pair("GH_TOKEN", "ghp_xxx"),
            pair("my_password", "p"),
            pair("DB_SECRET", "s"),
            pair("api_token", "t"),
        ];
        let block = build_env_block_from(parent.into_iter(), &[]);
        let env = decode(&block);
        let keys: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"PATH"), "PATH 必须保留");
        assert!(keys.contains(&"SystemRoot"), "SystemRoot 必须保留");
        for k in ["GH_TOKEN", "my_password", "DB_SECRET", "api_token"] {
            assert!(!keys.contains(&k), "{k} 不应继承");
        }
        // 双 null 结尾
        assert!(block.len() >= 2 && block[block.len() - 1] == 0 && block[block.len() - 2] == 0);
    }

    /// 显式 env_list 按大小写不敏感覆盖父项，且保留显式项原名
    #[test]
    fn explicit_env_overrides_case_insensitively() {
        let parent = vec![pair("Path", "old")];
        let block = build_env_block_from(parent.into_iter(), &[("PATH".into(), "new".into())]);
        let env = decode(&block);
        let path_entries: Vec<&(String, String)> =
            env.iter().filter(|(k, _)| k.eq_ignore_ascii_case("PATH")).collect();
        assert_eq!(path_entries.len(), 1, "不得出现大小写变体重复项");
        assert_eq!(path_entries[0].0, "PATH", "保留显式项原名");
        assert_eq!(path_entries[0].1, "new");
    }

    /// 显式传入的敏感键允许注入（清洗只作用于「继承」，与 dsh 显式 env 后合并同语义）
    #[test]
    fn explicit_sensitive_key_allowed() {
        let block = build_env_block_from(std::iter::empty(), &[("OPENAI_API_KEY".into(), "k".into())]);
        let env = decode(&block);
        assert_eq!(env.len(), 1);
        assert_eq!(env[0].0, "OPENAI_API_KEY");
        assert_eq!(env[0].1, "k");
    }
}

// ─── 句柄读写包装 ───────────────────────────────────────────

/// 输出读端（子进程原始 VT 字节流）
pub struct HandleReader {
    pub(crate) handle: HHandle,
}
unsafe impl Send for HandleReader {}

impl HandleReader {
    fn new(src: HANDLE) -> anyhow::Result<Self> {
        Ok(Self { handle: HHandle(dup_handle(src)?) })
    }
}

impl Read for HandleReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        use windows_sys::Win32::Storage::FileSystem::ReadFile;
        let mut n: u32 = 0;
        let ok = unsafe {
            ReadFile(
                self.handle.0,
                buf.as_mut_ptr() as _,
                buf.len() as u32,
                &mut n,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            let e = IoError::last_os_error();
            if e.kind() == ErrorKind::BrokenPipe {
                Ok(0) // 子进程退出 → EOF
            } else {
                Err(e)
            }
        } else {
            Ok(n as usize)
        }
    }
}

/// 输入写端（命令/交互输入）
pub struct HandleWriter {
    pub(crate) handle: HHandle,
}
unsafe impl Send for HandleWriter {}

impl HandleWriter {
    fn new(src: HANDLE) -> anyhow::Result<Self> {
        Ok(Self { handle: HHandle(dup_handle(src)?) })
    }
}

impl Write for HandleWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        use windows_sys::Win32::Storage::FileSystem::WriteFile;
        let mut written: u32 = 0;
        let ok = unsafe {
            WriteFile(
                self.handle.0,
                buf.as_ptr() as _,
                buf.len() as u32,
                &mut written,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            Err(IoError::last_os_error())
        } else {
            Ok(written as usize)
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// DuplicateHandle 复制句柄（跨线程安全借用；DUPLICATE_SAME_ACCESS）
fn dup_handle(src: HANDLE) -> anyhow::Result<HANDLE> {
    unsafe {
        let proc = GetCurrentProcess();
        let mut out: HANDLE = INVALID_HANDLE_VALUE as _;
        let ok = DuplicateHandle(
            proc,
            src,
            proc,
            &mut out,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        );
        if ok == 0 {
            anyhow::bail!("DuplicateHandle failed: {}", IoError::last_os_error());
        }
        Ok(out)
    }
}

// ─── 会话上层入口（供 pty/mod.rs 调用）──────────────────────

use super::PtySession;
use tokio::sync::mpsc;

/// 用自研 passthrough backend 打开 PTY 会话（不受限通路）
pub async fn spawn_passthrough(
    shell: &str,
    cwd: &str,
    env_list: &[(String, String)],
    pty_size: portable_pty::PtySize,
) -> Result<PtySession, String> {
    spawn_passthrough_with_token(shell, cwd, env_list, pty_size, None).await
}

/// E3-3（2026-09-18）：受限令牌挂载变体——`token=Some` 时子进程以 `CreateProcessAsUserW` 启动
///
/// 受限模式**不回落** portable-pty（其无法注入令牌，回落即边界旁路）——失败由调用方 fail-closed。
/// DSR 握手与输出缓冲链路与不受限通路完全一致（新接线不得绕过 DSR）。
pub async fn spawn_passthrough_with_token(
    shell: &str,
    cwd: &str,
    env_list: &[(String, String)],
    pty_size: portable_pty::PtySize,
    token: Option<HHandle>,
) -> Result<PtySession, String> {
    let shell_owned = shell.to_string();
    let cwd_owned = cwd.to_string();
    let env_owned = env_list.to_vec();
    let (tx, rx) = mpsc::channel::<Vec<u8>>(64);

    // 受限令牌经 HHandle（Send 包装）传递；闭包内还原为裸句柄（HANDLE 非 Send）
    let token_raw = token.map(|h| h.0 as usize);
    // 同步创建（spawn_blocking 中调用 Windows API，避免阻塞 tokio worker）
    let pty = tokio::task::spawn_blocking(move || {
        PassthroughPty::spawn_with_token(
            &shell_owned,
            &cwd_owned,
            &env_owned,
            pty_size.cols,
            pty_size.rows,
            token_raw.map(|v| v as HANDLE),
        )
    })
    .await
    .map_err(|_| "passthrough 初始化任务 panic".to_string())?
    .map_err(|e| format!("passthrough spawn: {e}"))?;

    // DSR 应答：ConPTY 启动先发 `\x1b[6n` 查询，不回复则子进程输出挂起
    let mut hs_reader = pty
        .try_clone_reader()
        .map_err(|e| format!("try_clone_hs_reader: {e}"))?;
    let mut hs_buf = [0u8; 64];
    let mut dsr_found = false;
    for _ in 0..4 {
        match hs_reader.read(&mut hs_buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if find_dsr(&hs_buf[..n]).is_some() {
                    dsr_found = true;
                    break;
                }
            }
        }
    }
    if dsr_found {
        let mut hs_writer = pty
            .try_clone_writer()
            .map_err(|e| format!("try_clone_hs_writer: {e}"))?;
        hs_writer
            .write_all(b"\x1b[1;1R")
            .and_then(|_| hs_writer.flush())
            .map_err(|e| format!("DSR 应答失败: {e}"))?;
    }

    // 后台 reader 线程：读原始 VT 字节流 → 推 rx
    let mut reader = pty
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader: {e}"))?;
    let reader_tx = tx.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if reader_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // 会话层 writer（写命令/交互输入）
    let writer: Box<dyn Write + Send> = Box::new(
        pty.try_clone_writer()
            .map_err(|e| format!("try_clone_writer: {e}"))?,
    );
    // master（resize/取 reader/writer dups）——从 pty dup 出子句柄
    let master_reader = pty
        .try_clone_reader()
        .map_err(|e| format!("try_clone_master_reader: {e}"))?;
    let master_writer = pty
        .try_clone_writer()
        .map_err(|e| format!("try_clone_master_writer: {e}"))?;
    let child_proc = pty.child_proc.0;
    let hpcon = pty.hpcon(); // move 前取 HPCON 值（master resize 通道）

    Ok(PtySession {
        child: Box::new(PassthroughChild {
            proc: HHandle(child_proc),
            _pty: pty, // 持有 ConPTY（Drop 关闭）+ 原始句柄
        }),
        master: Box::new(PassthroughMaster {
            reader: master_reader,
            writer: master_writer,
            hpcon,
        }),
        writer,
        out_rx: rx,
    })
}

/// 占位守护（可扩展持有 PassthroughPty 引用）
pub struct PassthroughPtyGuard;

// ─── 供 portable-pty trait object 包装（child/master）────────

/// 子进程配合 portable-pty `Child` trait
pub struct PassthroughChild {
    proc: HHandle,
    _pty: PassthroughPty,
}

impl std::fmt::Debug for PassthroughChild {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PassthroughChild").finish()
    }
}

impl portable_pty::ChildKiller for PassthroughChild {
    fn kill(&mut self) -> std::io::Result<()> {
        unsafe {
            let res = TerminateProcess(self.proc.0, 1);
            if res == 0 {
                Err(IoError::last_os_error())
            } else {
                Ok(())
            }
        }
    }
    fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
        Box::new(PassthroughChildKiller {
            proc: HHandle(self.proc.0),
        })
    }
}

pub struct PassthroughChildKiller {
    proc: HHandle,
}

impl std::fmt::Debug for PassthroughChildKiller {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PassthroughChildKiller").finish()
    }
}

impl portable_pty::ChildKiller for PassthroughChildKiller {
    fn kill(&mut self) -> std::io::Result<()> {
        unsafe {
            let res = TerminateProcess(self.proc.0, 1);
            if res == 0 {
                Err(IoError::last_os_error())
            } else {
                Ok(())
            }
        }
    }
    fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
        Box::new(PassthroughChildKiller { proc: HHandle(self.proc.0) })
    }
}

impl portable_pty::Child for PassthroughChild {
    fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
        unsafe {
            let mut status: u32 = 0;
            let res = GetExitCodeProcess(self.proc.0, &mut status);
            if res == 0 {
                return Err(IoError::last_os_error());
            }
            if status == STILL_ACTIVE as u32 {
                Ok(None)
            } else {
                Ok(Some(portable_pty::ExitStatus::with_exit_code(status)))
            }
        }
    }

    fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
        unsafe { WaitForSingleObject(self.proc.0, INFINITE) };
        unsafe {
            let mut status: u32 = 0;
            let res = GetExitCodeProcess(self.proc.0, &mut status);
            if res == 0 {
                Err(IoError::last_os_error())
            } else {
                Ok(portable_pty::ExitStatus::with_exit_code(status))
            }
        }
    }

    fn process_id(&self) -> Option<u32> {
        unsafe {
            let pid = GetProcessId(self.proc.0);
            if pid == 0 { None } else { Some(pid) }
        }
    }

    fn as_raw_handle(&self) -> Option<RawHandle> {
        Some(self.proc.0)
    }
}

/// master 配合 portable-pty `MasterPty` trait
pub struct PassthroughMaster {
    reader: HandleReader,
    writer: HandleWriter,
    /// HPCON 值拷贝（resize 用；Close 由 PassthroughPty 的 PsuedoCon Drop 负责，此值不额外 close）
    hpcon: isize,
}

impl portable_pty::MasterPty for PassthroughMaster {
    fn resize(&self, size: portable_pty::PtySize) -> anyhow::Result<()> {
        // 真实 resize：直接调 ResizePseudoConsole（HPCON 值跨线程可安全传递/复用）
        let hr = unsafe {
            ResizePseudoConsole(
                self.hpcon,
                COORD { X: size.cols as i16, Y: size.rows as i16 },
            )
        };
        if hr < 0 {
            anyhow::bail!("ResizePseudoConsole failed: HRESULT {hr:#x}");
        }
        Ok(())
    }
    fn get_size(&self) -> anyhow::Result<portable_pty::PtySize> {
        Ok(portable_pty::PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
    }
    fn try_clone_reader(&self) -> anyhow::Result<Box<dyn Read + Send>> {
        Ok(Box::new(HandleReaderView(self.reader.handle.0)))
    }
    fn take_writer(&self) -> anyhow::Result<Box<dyn Write + Send>> {
        // 会话层 writer 已独立持有；此处返回 dup 写端供工具复用（HandleWriterView 每次 dup）
        Ok(Box::new(HandleWriterView(self.writer.handle.0)))
    }
}

/// 简易 reader 视图（跨线程 dup；HANDLE=*mut c_void 非 Send → 包 HHandle）
struct HandleReaderView(HANDLE);
unsafe impl Send for HandleReaderView {}
impl Read for HandleReaderView {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let mut r = HandleReader::new(self.0).map_err(|e| {
            IoError::new(ErrorKind::Other, e.to_string())
        })?;
        r.read(buf)
    }
}

struct HandleWriterView(HANDLE);
unsafe impl Send for HandleWriterView {}
impl Write for HandleWriterView {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut w = HandleWriter::new(self.0).map_err(|e| {
            IoError::new(ErrorKind::Other, e.to_string())
        })?;
        w.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// 在字节片中查找 ConPTY DSR 查询 `ESC [ 6 n`（\x1b[6n）
pub fn find_dsr(bytes: &[u8]) -> Option<usize> {
    for i in 0..bytes.len().saturating_sub(3) {
        if bytes[i] == 0x1b && bytes[i + 1] == b'[' && bytes[i + 2] == b'6' && bytes[i + 3] == b'n' {
            return Some(i);
        }
    }
    None
}