//! Windows 受限令牌沙箱后端（E3-2 spike，2026-09-18）。
//!
//! # 机制（对齐 dsh `sandbox-windows-acl` 与其实施决策记录）
//! - **令牌派生**：`CreateRestrictedToken`（`WRITE_RESTRICTED | DISABLE_MAX_PRIVILEGE | LUA_TOKEN`）。
//!   Windows 做两次访问检查（正常 SID + 限制 SID），写类访问需两者皆过——读保留调用者既有可读面，
//!   写收敛到能力 SID 的 ACE 上。
//! - **能力 SID**：工作区 = `sha256("worldsea-sandbox:workspace:<规范化 root>")` 前 64 位 →
//!   非唯一权威 SID（`S-1-4-x-y`，无需账户解析；同工作区跨会话确定性复用）；私有 temp 同法但域分离。
//! - **保活不变量**：限制 SID 必须含 logon SID + Everyone——缺则早期 DLL 初始化失败（`0xC0000142`）。
//! - **授予**：`SetEntriesInAclW`（`SET_ACCESS` 语义为「替换该 SID 既有 ACE」，天然幂等）
//!   + `SetNamedSecurityInfoW`；已存在同 SID ACE 时**跳过**（exact-ACE skip，避免每次命令重复全树传播）。
//! - **失败关闭**：本模块所有 Win32 调用失败均返回 `Err`，调用方（E3-2 收口）据此拒绝执行。
//!
//! # 已知边界（如实登记，对齐 dsh「enforcement: partial」口径）
//! - Everyone 保活 → 「授予 Everyone 写的外部对象」仍可写；NTFS 硬链接是同一文件对象别名。
//! - 读 / 网络 / 进程可见性不受限（`WRITE_RESTRICTED` 只交叉写类访问）。

use std::ffi::c_void;
use std::os::windows::io::FromRawHandle;
use std::path::{Path, PathBuf};
use std::time::Duration;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT,
    INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W,
    REVOKE_ACCESS, SE_FILE_OBJECT, SET_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AclSizeInformation, AllocateAndInitializeSid, CreateRestrictedToken, EqualSid, FreeSid, GetAce,
    GetAclInformation, GetLengthSid, GetTokenInformation, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL,
    ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION, DISABLE_MAX_PRIVILEGE, LUA_TOKEN, PSID,
    SECURITY_ATTRIBUTES, SECURITY_NON_UNIQUE_AUTHORITY, SID_AND_ATTRIBUTES,
    SID_IDENTIFIER_AUTHORITY, SUB_CONTAINERS_AND_OBJECTS_INHERIT, TOKEN_ADJUST_DEFAULT,
    TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_GROUPS, TOKEN_QUERY, TokenGroups, WRITE_RESTRICTED,
};
use windows_sys::Win32::Storage::FileSystem::{DELETE, FILE_DELETE_CHILD, FILE_GENERIC_WRITE};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, ResumeThread,
    TerminateProcess, WaitForSingleObject, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
    PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
};

/// logon SID 的组属性标记（稳定 ABI 常量；windows-sys 未导出）
const SE_GROUP_LOGON_ID: u32 = 0xC000_0000;

/// ACE 类型：允许型（稳定 ABI 常量；windows-sys 仅在 SystemServices 模块导出，此处就地定义）
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

/// 写类掩码（授予受限 SID）：文件/子目录创建 + 数据/属性写 + 删除（含父目录删除子项）
///
/// `FILE_GENERIC_WRITE` 含 `SYNCHRONIZE | READ_CONTROL | FILE_WRITE_DATA | FILE_APPEND_DATA |
/// FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES`；`FILE_DELETE_CHILD` 允许删除目录内子项；
/// `DELETE` 允许删除对象自身（随继承 ACE 落到文件上）。
const WRITE_MASK: u32 = FILE_GENERIC_WRITE | FILE_DELETE_CHILD | DELETE;

fn win_err(ctx: &str) -> String {
    let code = unsafe { GetLastError() };
    format!("{ctx} 失败（Win32 {code}）")
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 构造受限执行的命令行：`cmd.exe /D /S /C "<command>"`（命令串**原样**嵌入，不做 `\"` 转义）
///
/// `/S` 语义：剥掉 /C 后的首尾引号、其余原样执行——规避 cmd.exe 不识别反斜杠转义引号
/// （`\"` 是 C 运行时约定）导致的路径解析损坏；`/D` 跳过 AutoRun 注册表命令（执行卫生）。
pub fn cmdline_for_cmd(command: &str) -> String {
    format!("cmd.exe /D /S /C \"{command}\"")
}

/// 按 Windows 命令行引用规则把 argv 拼成命令行（与 std `Command::args` 同口径）
///
/// 用于非 cmd 形态（如 `powershell.exe -NoProfile -NonInteractive -Command <script>`）——
/// `lpApplicationName` 传 null，程序名按 PATH 解析。
pub fn cmdline_from_argv(argv: &[String]) -> String {
    argv.iter()
        .map(|a| quote_arg(a))
        .collect::<Vec<_>>()
        .join(" ")
}

/// 单个参数的 Windows 引用规则（对齐 std 的 Command::arg：含空格/制表/引号即加引号，反斜杠按位加倍）
fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => {
                backslashes += 1;
                out.push('\\');
            }
            '"' => {
                for _ in 0..=backslashes {
                    out.push('\\');
                }
                out.push('"');
                backslashes = 0;
            }
            _ => {
                backslashes = 0;
                out.push(c);
            }
        }
    }
    for _ in 0..backslashes {
        out.push('\\');
    }
    out.push('"');
    out
}

// ─── 能力 SID ─────────────────────────────────────────────

/// 自有 SID（`AllocateAndInitializeSid` 派生；Drop 时 `FreeSid`）
pub struct OwnedSid(PSID);

// SID 指针可跨线程使用（只读句柄语义；Drop 时释放）
unsafe impl Send for OwnedSid {}
unsafe impl Sync for OwnedSid {}

impl OwnedSid {
    fn alloc(authority: SID_IDENTIFIER_AUTHORITY, subs: &[u32]) -> Result<Self, String> {
        let mut s8 = [0u32; 8];
        for (i, v) in subs.iter().enumerate().take(8) {
            s8[i] = *v;
        }
        let mut sid: PSID = std::ptr::null_mut();
        let ok = unsafe {
            AllocateAndInitializeSid(
                &authority,
                subs.len() as u8,
                s8[0],
                s8[1],
                s8[2],
                s8[3],
                s8[4],
                s8[5],
                s8[6],
                s8[7],
                &mut sid,
            )
        };
        if ok == 0 {
            return Err(win_err("AllocateAndInitializeSid"));
        }
        Ok(Self(sid))
    }

    /// 内置 Everyone（`S-1-1-0`）——受限令牌保活不变量（对齐 dsh）
    pub fn everyone() -> Result<Self, String> {
        Self::alloc(
            SID_IDENTIFIER_AUTHORITY {
                Value: [0, 0, 0, 0, 0, 1],
            },
            &[0],
        )
    }

    /// 非唯一权威派生 SID（`S-1-4-x-y`）：`sha256(worldsea-sandbox:<domain>:<tag>)` 前 64 位
    ///
    /// `domain` 做域分离（`workspace` / `temp`），避免同 tag 跨域撞 SID。
    pub fn derive(domain: &str, tag: &str) -> Result<Self, String> {
        let hex = agent_memory::raw_store::hash_of(&format!("worldsea-sandbox:{domain}:{tag}"));
        let a = u32::from_str_radix(&hex[0..8], 16).map_err(|e| format!("SID 派生解析失败: {e}"))?;
        let b = u32::from_str_radix(&hex[8..16], 16).map_err(|e| format!("SID 派生解析失败: {e}"))?;
        Self::alloc(SECURITY_NON_UNIQUE_AUTHORITY, &[a, b])
    }

    pub fn as_psid(&self) -> PSID {
        self.0
    }

    /// SID 相等判定（测试 / 审计锚点）
    pub fn equals(&self, other: &OwnedSid) -> bool {
        unsafe { EqualSid(self.0, other.0) != 0 }
    }
}

impl Drop for OwnedSid {
    fn drop(&mut self) {
        unsafe {
            FreeSid(self.0);
        }
    }
}

// ─── 受限令牌 ─────────────────────────────────────────────

/// 受限令牌（`CreateRestrictedToken` 派生；Drop 时 `CloseHandle`）
pub struct RestrictedToken(HANDLE);

unsafe impl Send for RestrictedToken {}
unsafe impl Sync for RestrictedToken {}

impl RestrictedToken {
    /// 从当前进程令牌派生：限制 SID = [logon SID, Everyone] + `extras`（工作区 / 私有 temp 能力 SID）
    ///
    /// `extras` 为空 = read-only 语义（无任何写能力）；带工作区 SID = workspace-write 语义。
    pub fn derive(extras: &[&OwnedSid]) -> Result<Self, String> {
        unsafe {
            let mut base: HANDLE = std::ptr::null_mut();
            // TOKEN_ASSIGN_PRIMARY 是 CreateProcessAsUserW 的准入前提（缺失 → 拒绝访问 5；
            // 口径对齐 dsh sandbox-windows-acl/token.ts 的 OpenProcessToken 请求集）
            if OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ADJUST_DEFAULT | TOKEN_ASSIGN_PRIMARY,
                &mut base,
            ) == 0
            {
                return Err(win_err("OpenProcessToken"));
            }
            // 令牌组缓冲保活到 CreateRestrictedToken 返回（logon SID 指针指向缓冲内部）
            let groups_buf = match token_groups_buffer(base) {
                Ok(b) => b,
                Err(e) => {
                    CloseHandle(base);
                    return Err(e);
                }
            };
            let logon_ptr = match find_logon_sid(&groups_buf) {
                Ok(p) => p,
                Err(e) => {
                    CloseHandle(base);
                    return Err(e);
                }
            };
            let everyone = OwnedSid::everyone()?;

            let mut restricting: Vec<SID_AND_ATTRIBUTES> = vec![
                SID_AND_ATTRIBUTES {
                    Sid: logon_ptr,
                    Attributes: 0,
                },
                SID_AND_ATTRIBUTES {
                    Sid: everyone.as_psid(),
                    Attributes: 0,
                },
            ];
            for extra in extras {
                restricting.push(SID_AND_ATTRIBUTES {
                    Sid: extra.as_psid(),
                    Attributes: 0,
                });
            }

            let mut new_token: HANDLE = std::ptr::null_mut();
            let ok = CreateRestrictedToken(
                base,
                WRITE_RESTRICTED | DISABLE_MAX_PRIVILEGE | LUA_TOKEN,
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
                restricting.len() as u32,
                restricting.as_ptr(),
                &mut new_token,
            );
            CloseHandle(base);
            if ok == 0 {
                return Err(win_err("CreateRestrictedToken"));
            }
            Ok(Self(new_token))
        }
    }

    fn handle(&self) -> HANDLE {
        self.0
    }

    /// 裸令牌句柄（供 PTY 模块受限挂载 ConPTY；不转移所有权）
    pub(crate) fn raw_handle(&self) -> HANDLE {
        self.0
    }
}

impl Drop for RestrictedToken {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

/// 读取令牌组缓冲（`TokenGroups`；长度两段式）
unsafe fn token_groups_buffer(token: HANDLE) -> Result<Vec<u8>, String> {
    let mut len = 0u32;
    let _ = GetTokenInformation(token, TokenGroups, std::ptr::null_mut(), 0, &mut len);
    if len == 0 {
        return Err(win_err("GetTokenInformation(TokenGroups) 长度探测"));
    }
    let mut buf = vec![0u8; len as usize];
    if GetTokenInformation(
        token,
        TokenGroups,
        buf.as_mut_ptr() as *mut c_void,
        len,
        &mut len,
    ) == 0
    {
        return Err(win_err("GetTokenInformation(TokenGroups)"));
    }
    Ok(buf)
}

/// 在令牌组缓冲中定位 logon SID（返回指向缓冲内部的有效指针；调用方负责缓冲保活）
unsafe fn find_logon_sid(buf: &[u8]) -> Result<PSID, String> {
    let groups = &*(buf.as_ptr() as *const TOKEN_GROUPS);
    let entries = std::slice::from_raw_parts(groups.Groups.as_ptr(), groups.GroupCount as usize);
    for g in entries {
        if g.Attributes & SE_GROUP_LOGON_ID == SE_GROUP_LOGON_ID {
            return Ok(g.Sid);
        }
    }
    Err("令牌中未找到 logon SID（保活不变量缺失，拒绝派生）".into())
}

// ─── ACL 授予 / 撤销 ──────────────────────────────────────

/// 给目录授予受限 SID 的写 ACE（可继承到子目录与文件）
///
/// # 返回
/// `Ok(true)` = 本次实际授予（触发传播）；`Ok(false)` = 已存在同 SID ACE（exact-ACE skip）
pub fn grant_write(dir: &Path, sid: &OwnedSid) -> Result<bool, String> {
    let wdir = to_wide(&dir.to_string_lossy());
    unsafe {
        let mut old_acl: *mut ACL = std::ptr::null_mut();
        let mut sd: PSID = std::ptr::null_mut();
        let rc = GetNamedSecurityInfoW(
            wdir.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_acl,
            std::ptr::null_mut(),
            &mut sd as *mut PSID as *mut _,
        );
        if rc != 0 {
            return Err(format!("GetNamedSecurityInfoW 失败（Win32 {rc}）"));
        }
        if !old_acl.is_null() && acl_has_sid(old_acl, sid) {
            LocalFree(sd as _);
            return Ok(false); // exact-ACE skip（免重复全树传播）
        }
        let mut ea: EXPLICIT_ACCESS_W = std::mem::zeroed();
        ea.grfAccessPermissions = WRITE_MASK;
        ea.grfAccessMode = SET_ACCESS;
        ea.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
        ea.Trustee = trustee_for(sid);

        let mut new_acl: *mut ACL = std::ptr::null_mut();
        let rc = SetEntriesInAclW(1, &ea, old_acl, &mut new_acl);
        if rc != 0 {
            LocalFree(sd as _);
            return Err(format!("SetEntriesInAclW 失败（Win32 {rc}）"));
        }
        let rc = SetNamedSecurityInfoW(
            wdir.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            new_acl,
            std::ptr::null_mut(),
        );
        LocalFree(new_acl as _);
        LocalFree(sd as _);
        if rc != 0 {
            return Err(format!("SetNamedSecurityInfoW 失败（Win32 {rc}）"));
        }
        Ok(true)
    }
}

/// 撤销目录上该受限 SID 的 ACE（`REVOKE_ACCESS`；用于私有 temp 清理）
pub fn revoke_write(dir: &Path, sid: &OwnedSid) -> Result<(), String> {
    let wdir = to_wide(&dir.to_string_lossy());
    unsafe {
        let mut old_acl: *mut ACL = std::ptr::null_mut();
        let mut sd: PSID = std::ptr::null_mut();
        let rc = GetNamedSecurityInfoW(
            wdir.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_acl,
            std::ptr::null_mut(),
            &mut sd as *mut PSID as *mut _,
        );
        if rc != 0 {
            return Err(format!("GetNamedSecurityInfoW 失败（Win32 {rc}）"));
        }
        let mut ea: EXPLICIT_ACCESS_W = std::mem::zeroed();
        ea.grfAccessPermissions = WRITE_MASK;
        ea.grfAccessMode = REVOKE_ACCESS;
        ea.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
        ea.Trustee = trustee_for(sid);

        let mut new_acl: *mut ACL = std::ptr::null_mut();
        let rc = SetEntriesInAclW(1, &ea, old_acl, &mut new_acl);
        if rc != 0 {
            LocalFree(sd as _);
            return Err(format!("SetEntriesInAclW(REVOKE) 失败（Win32 {rc}）"));
        }
        let rc = SetNamedSecurityInfoW(
            wdir.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            new_acl,
            std::ptr::null_mut(),
        );
        LocalFree(new_acl as _);
        LocalFree(sd as _);
        if rc != 0 {
            return Err(format!("SetNamedSecurityInfoW(REVOKE) 失败（Win32 {rc}）"));
        }
        Ok(())
    }
}

/// 构造 `TRUSTEE_W`（`TRUSTEE_IS_SID` 形态）
fn trustee_for(sid: &OwnedSid) -> TRUSTEE_W {
    TRUSTEE_W {
        pMultipleTrustee: std::ptr::null_mut(),
        MultipleTrusteeOperation: 0, // NO_MULTIPLE_TRUSTEE
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_UNKNOWN,
        ptstrName: sid.as_psid() as *mut u16,
    }
}

/// DACL 中是否已存在该 SID 的允许型 ACE
unsafe fn acl_has_sid(acl: *mut ACL, sid: &OwnedSid) -> bool {
    let mut info: ACL_SIZE_INFORMATION = std::mem::zeroed();
    if GetAclInformation(
        acl,
        &mut info as *mut _ as *mut c_void,
        std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
        AclSizeInformation,
    ) == 0
    {
        return false;
    }
    for i in 0..info.AceCount {
        let mut ace: *mut c_void = std::ptr::null_mut();
        if GetAce(acl, i, &mut ace) == 0 {
            continue;
        }
        let hdr = &*(ace as *const ACE_HEADER);
        if hdr.AceType != ACCESS_ALLOWED_ACE_TYPE {
            continue;
        }
        let allowed = &*(ace as *const ACCESS_ALLOWED_ACE);
        let ace_sid = &allowed.SidStart as *const u32 as PSID;
        if EqualSid(ace_sid, sid.as_psid()) != 0 {
            return true;
        }
    }
    false
}

// ─── 受限 spawn（管道 stdio + 挂起创建 → Job → resume）──────

/// 受限执行请求
pub struct SpawnRequest<'a> {
    /// 完整命令行文本（调用方用 [`cmdline_for_cmd`] / [`cmdline_from_argv`] 构造；
    /// `lpApplicationName` 传 null，程序名按 PATH 解析）
    pub command: &'a str,
    pub cwd: Option<&'a Path>,
    /// 显式环境覆盖（含 TMP/TEMP 重写）；父环境经 `env_scrub` 清洗后合并
    pub env: Vec<(String, String)>,
    /// 额外创建标志（控制台行为：0 / `CREATE_NO_WINDOW` / `DETACHED_PROCESS` 等）
    pub flags: u32,
}

/// 受限子进程（Drop 未等待即终止主进程；残留子树由 Job Drop 整树回收）
pub struct ConfinedChild {
    process: HANDLE,
    stdout: Option<std::fs::File>,
    stderr: Option<std::fs::File>,
    job: Option<crate::job::WinJob>,
    pid: u32,
}

unsafe impl Send for ConfinedChild {}

impl ConfinedChild {
    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn take_stdout(&mut self) -> Option<std::fs::File> {
        self.stdout.take()
    }

    pub fn take_stderr(&mut self) -> Option<std::fs::File> {
        self.stderr.take()
    }

    /// 等待退出：`Ok(Some(code))` = 已退出；`Ok(None)` = 超时（进程仍在）
    pub async fn wait_timeout(&mut self, timeout: Duration) -> Result<Option<i32>, String> {
        let h = self.process as usize; // 句柄值跨线程投递（spawn_blocking 的 Send 约束）
        let ms = timeout.as_millis().min(u32::MAX as u128) as u32;
        let rc = tokio::task::spawn_blocking(move || unsafe { WaitForSingleObject(h as HANDLE, ms) })
            .await
            .map_err(|e| format!("等待任务失败: {e}"))?;
        if rc == WAIT_TIMEOUT {
            return Ok(None);
        }
        if rc != WAIT_OBJECT_0 {
            return Err(format!("WaitForSingleObject 异常返回（{rc}）"));
        }
        let mut code = 0u32;
        if unsafe { GetExitCodeProcess(self.process, &mut code) } == 0 {
            return Err(win_err("GetExitCodeProcess"));
        }
        Ok(Some(code as i32))
    }

    /// 终止主进程（残留子树由 Job Drop 回收）
    pub fn kill(&self) {
        unsafe {
            TerminateProcess(self.process, 1);
        }
    }
}

impl Drop for ConfinedChild {
    fn drop(&mut self) {
        unsafe {
            TerminateProcess(self.process, 1); // 未退出即终止（对齐「future drop 即 kill」语义）
            CloseHandle(self.process);
        }
        // 显式顺序：先终止主进程，再关 Job（KILL_ON_JOB_CLOSE 整树回收）
        self.job.take();
    }
}

/// 受限 spawn：`cmd.exe /C <command>` 以受限令牌挂起创建 → 挂 Job → resume
pub fn spawn_confined(token: &RestrictedToken, req: &SpawnRequest<'_>) -> Result<ConfinedChild, String> {
    unsafe {
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: 1,
        };
        let (out_r, out_w) = make_pipe(&sa)?;
        let (err_r, err_w) = match make_pipe(&sa) {
            Ok(v) => v,
            Err(e) => {
                CloseHandle(out_r);
                CloseHandle(out_w);
                return Err(e);
            }
        };

        // 环境块：父环境清洗 + 显式覆盖（含 TMP/TEMP 重写）——与命令执行 / PTY 同口径
        let env_block = crate::pty::conpty_passthrough::build_env_block(&req.env);
        let mut cmdline = to_wide(req.command);
        let cwd_wide = req.cwd.map(|p| to_wide(&p.to_string_lossy()));

        let mut si: STARTUPINFOW = std::mem::zeroed();
        si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = INVALID_HANDLE_VALUE;
        si.hStdOutput = out_w;
        si.hStdError = err_w;

        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
        let ok = CreateProcessAsUserW(
            token.handle(),
            std::ptr::null(),
            cmdline.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1, // bInheritHandles=TRUE（管道的子端已标记可继承）
            CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED | req.flags,
            env_block.as_ptr() as *const c_void,
            cwd_wide.as_ref().map(|w| w.as_ptr()).unwrap_or(std::ptr::null()),
            &si,
            &mut pi,
        );
        // 子端写句柄在 spawn 后立即关闭（父侧只保留读端）
        CloseHandle(out_w);
        CloseHandle(err_w);
        if ok == 0 {
            CloseHandle(out_r);
            CloseHandle(err_r);
            return Err(win_err("CreateProcessAsUserW"));
        }

        // 受限进程（P1 语义）：挂入 KILL_ON_JOB_CLOSE 的 Job——挂起创建期挂接，收口「spawn 后 assign」竞态
        let job = crate::job::WinJob::new()?;
        if let Err(e) = job.assign_handle(pi.hProcess) {
            tracing::warn!("受限进程 Job 挂接失败（残留子进程可能无法整树回收）: {e}");
        }
        let resumed = ResumeThread(pi.hThread);
        if resumed == u32::MAX {
            tracing::warn!("ResumeThread 失败（子进程可能停滞，等待超时后由 Job 回收）");
        }
        CloseHandle(pi.hThread);

        Ok(ConfinedChild {
            process: pi.hProcess,
            stdout: Some(std::fs::File::from_raw_handle(out_r)),
            stderr: Some(std::fs::File::from_raw_handle(err_r)),
            job: Some(job),
            pid: pi.dwProcessId,
        })
    }
}

/// 创建匿名管道：两端可继承，父端读句柄随即置为不可继承
unsafe fn make_pipe(sa: &SECURITY_ATTRIBUTES) -> Result<(HANDLE, HANDLE), String> {
    let mut r: HANDLE = std::ptr::null_mut();
    let mut w: HANDLE = std::ptr::null_mut();
    if CreatePipe(&mut r, &mut w, sa, 0) == 0 {
        return Err(win_err("CreatePipe"));
    }
    if SetHandleInformation(r, HANDLE_FLAG_INHERIT, 0) == 0 {
        CloseHandle(r);
        CloseHandle(w);
        return Err(win_err("SetHandleInformation"));
    }
    Ok((r, w))
}

/// SID 长度（供测试/日志；避免 dead_code 告警的显式使用点）
pub fn sid_len(sid: &OwnedSid) -> u32 {
    unsafe { GetLengthSid(sid.as_psid()) }
}

// ─── 每工作区沙箱状态与受限命令入口（E3-2 收口）────────────

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// 每工作区沙箱状态（进程级缓存）
///
/// - **工作区 SID 确定性**：由规范化 root 派生——跨进程/会话复用同一**常驻** ACE（exact-ACE skip 免重复传播）；
/// - **私有 temp 随机**：每进程每工作区一个随机目录（与工作区互不包含），ACE 可撤销；
///   进程退出后残渣惰性无害（新进程新目录新 SID，不授权任何后续令牌）。
pub struct WorkspaceSandbox {
    /// 规范化工作区根（注册表键；已剥 `\\?\` 前缀）
    pub root: String,
    pub ws_sid: OwnedSid,
    pub temp_dir: PathBuf,
    pub temp_sid: OwnedSid,
}

static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<WorkspaceSandbox>>>> = OnceLock::new();

/// 取得（或建立）工作区沙箱状态：授予工作区写 ACE + 建私有 temp 并授予
///
/// 授予在注册表锁内完成（命令非高并发场景；避免并发建出重复 temp 目录）。
pub fn workspace_sandbox(root: &Path) -> Result<Arc<WorkspaceSandbox>, String> {
    let key = std::fs::canonicalize(root)
        .unwrap_or_else(|_| root.to_path_buf())
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();
    let registry = REGISTRY.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = registry.lock().map_err(|_| "沙箱注册表锁中毒".to_string())?;
    if let Some(sb) = map.get(&key) {
        return Ok(Arc::clone(sb));
    }
    let ws_sid = OwnedSid::derive("workspace", &key)?;
    grant_write(root, &ws_sid)?;
    let temp_dir = private_temp_dir(&key)?;
    let temp_sid = OwnedSid::derive("temp", &temp_dir.to_string_lossy())?;
    grant_write(&temp_dir, &temp_sid)?;
    let sb = Arc::new(WorkspaceSandbox {
        root: key.clone(),
        ws_sid,
        temp_dir,
        temp_sid,
    });
    map.insert(key, Arc::clone(&sb));
    Ok(sb)
}

/// 私有 temp 目录：`%TEMP%/worldsea-sandbox/<pid>-<hash>`（与工作区互不包含，满足 ACE 不重叠约束）
fn private_temp_dir(key: &str) -> Result<PathBuf, String> {
    let tag = agent_memory::raw_store::hash_of(&format!("temp-dir:{key}"));
    let dir = std::env::temp_dir()
        .join("worldsea-sandbox")
        .join(format!("{}-{}", std::process::id(), &tag[..12]));
    std::fs::create_dir_all(&dir).map_err(|e| format!("建私有 temp 目录失败: {e}"))?;
    Ok(dir)
}

/// 受限执行一条命令（E3-2 收口入口）
///
/// - `ReadOnly`：限制 SID 仅 [logon SID, Everyone]——无任何写能力；
/// - `WorkspaceWrite`：追加工作区 + 私有 temp 能力 SID，并把 TMP/TEMP 重写到私有 temp；
/// - 控制台标志取 **0**（与既有普通通路同口径——std 只用 `CREATE_UNICODE_ENVIRONMENT`）。
///   实测排除的两案：`CREATE_NO_WINDOW` 在受限令牌下死于 `STATUS_DLL_INIT_FAILED (0xC0000142)`；
///   `DETACHED_PROCESS` 与 powershell 不兼容（静默不执行，非受限亦复现）。
pub fn spawn_confined_command(
    spec: &agent_runtime::sandbox::SandboxSpec,
    cmdline: &str,
    cwd: Option<&Path>,
    env: Vec<(String, String)>,
) -> Result<ConfinedChild, String> {
    use agent_runtime::sandbox::SandboxMode;
    match spec.mode {
        SandboxMode::ReadOnly => {
            let token = RestrictedToken::derive(&[])?;
            spawn_confined(
                &token,
                &SpawnRequest {
                    command: cmdline,
                    cwd,
                    env,
                    flags: 0,
                },
            )
        }
        SandboxMode::WorkspaceWrite => {
            let sb = workspace_sandbox(&spec.root)?;
            let token = RestrictedToken::derive(&[&sb.ws_sid, &sb.temp_sid])?;
            let mut env = env;
            let temp = sb.temp_dir.to_string_lossy().to_string();
            // TMP/TEMP 重写：子进程写临时文件落在私有 temp（D5 口径；npm/pip 等缓存经环境重定向）
            env.push(("TMP".to_string(), temp.clone()));
            env.push(("TEMP".to_string(), temp));
            spawn_confined(
                &token,
                &SpawnRequest {
                    command: cmdline,
                    cwd,
                    env,
                    flags: 0,
                },
            )
        }
    }
}

// ─── PTY 受限会话位与会话级 temp（E3-3）─────────────────────

/// PTY 会话级私有 temp（每会话独立目录 + 独立随机 SID）
///
/// 生命周期（设计 §4.5）：会话创建时建立并授予（TMP/TEMP 重写到该目录）；会话销毁时
/// 撤销 ACE + 删除目录；进程崩溃残渣惰性无害（uuid 目录 → 新会话新 SID，不授权任何后续令牌）。
/// 目录与工作区互不包含（`%TEMP%/worldsea-sandbox/pty-<uuid>`），满足 ACE 不重叠约束。
pub struct SessionTemp {
    pub dir: PathBuf,
    pub sid: OwnedSid,
}

impl SessionTemp {
    /// 建立会话级私有 temp 目录并授予写 ACE
    pub fn create() -> Result<Self, String> {
        let dir = std::env::temp_dir()
            .join("worldsea-sandbox")
            .join(format!("pty-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).map_err(|e| format!("建 PTY 会话 temp 目录失败: {e}"))?;
        let sid = OwnedSid::derive("pty-temp", &dir.to_string_lossy())?;
        grant_write(&dir, &sid)?;
        Ok(Self { dir, sid })
    }

    /// 撤销授予并删除目录（会话销毁调用；best-effort——失败不阻塞销毁，残渣惰性无害）
    pub fn revoke_and_remove(&self) {
        if let Err(e) = revoke_write(&self.dir, &self.sid) {
            tracing::warn!(target: "sandbox", "PTY 会话 temp 撤销失败（残渣惰性无害）: {e}");
        }
        if let Err(e) = std::fs::remove_dir_all(&self.dir) {
            tracing::warn!(target: "sandbox", "PTY 会话 temp 删除失败: {e}");
        }
    }
}

/// PTY 受限会话位（E3-3 挂载 ConPTY 三件套：受限令牌 + TMP/TEMP 覆盖 + 会话级 temp）
pub struct PtySessionBits {
    token: RestrictedToken,
    env: Vec<(String, String)>,
    temp: Option<SessionTemp>,
}

impl PtySessionBits {
    /// 裸令牌句柄的 Send 包装（传 `pty::open_pty` 受限挂载参数；不转移所有权——
    /// 子进程创建完成后即可释放。裸 HANDLE 跨 await 会破坏 future Send，故经 `HHandle` 承载）
    pub(crate) fn raw_token(&self) -> crate::pty::conpty_passthrough::HHandle {
        crate::pty::conpty_passthrough::HHandle(self.token.raw_handle())
    }

    /// 附加环境（TMP/TEMP 重写；ReadOnly 为空）
    pub fn env(&self) -> &[(String, String)] {
        &self.env
    }

    /// 取走会话级 temp（存入 `ShellSession`，会话销毁时撤销）
    pub fn take_temp(&mut self) -> Option<SessionTemp> {
        self.temp.take()
    }
}

/// 构造 PTY 受限会话位（E3-3 入口）
///
/// - `ReadOnly`：仅受限令牌（无任何写能力；不重写 TMP/TEMP）；
/// - `WorkspaceWrite`：受限令牌（工作区 SID + 会话级 temp SID）+ TMP/TEMP 重写到会话 temp；
/// - 任一环节失败 → `Err`（调用方 fail-closed 拒绝创建会话，D3 口径）。
pub fn pty_session_bits(spec: &agent_runtime::sandbox::SandboxSpec) -> Result<PtySessionBits, String> {
    use agent_runtime::sandbox::SandboxMode;
    match spec.mode {
        SandboxMode::ReadOnly => Ok(PtySessionBits {
            token: RestrictedToken::derive(&[])?,
            env: Vec::new(),
            temp: None,
        }),
        SandboxMode::WorkspaceWrite => {
            let sb = workspace_sandbox(&spec.root)?;
            let temp = SessionTemp::create()?;
            let token = RestrictedToken::derive(&[&sb.ws_sid, &temp.sid])?;
            let dir = temp.dir.to_string_lossy().to_string();
            Ok(PtySessionBits {
                token,
                env: vec![
                    ("TMP".to_string(), dir.clone()),
                    ("TEMP".to_string(), dir),
                ],
                temp: Some(temp),
            })
        }
    }
}

// ─── spike 测试（真机 Windows 验证机制可行性；E3-2 spike，2026-09-18）──

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, DETACHED_PROCESS};

    fn canonical(dir: &Path) -> String {
        std::fs::canonicalize(dir)
            .unwrap_or_else(|_| PathBuf::from(dir))
            .to_string_lossy()
            .to_string()
    }

    /// 非 verbatim 形式的绝对路径：cmd.exe 把 `\\?\` 前缀当 UNC 路径拒绝（"UNC 路径不受支持"）
    fn plain_abs(dir: &Path) -> String {
        canonical(dir)
            .trim_start_matches(r"\\?\")
            .to_string()
    }

    async fn read_all(f: Option<std::fs::File>) -> String {
        use tokio::io::AsyncReadExt;
        let Some(f) = f else {
            return String::new();
        };
        let mut file = tokio::fs::File::from_std(f);
        let mut buf = Vec::new();
        let _ = file.read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).into_owned()
    }

    /// 受限执行一条命令，返回（退出码, stdout, stderr）
    async fn run_confined(
        token: &RestrictedToken,
        req: &SpawnRequest<'_>,
    ) -> (Option<i32>, String, String) {
        let mut child = spawn_confined(token, req).expect("受限 spawn 应成功");
        let out = read_all(child.take_stdout()).await;
        let err = read_all(child.take_stderr()).await;
        let code = child
            .wait_timeout(Duration::from_secs(30))
            .await
            .expect("等待应成功");
        (code, out, err)
    }

    #[test]
    fn sid_derivation_is_deterministic_and_domain_separated() {
        let a = OwnedSid::derive("workspace", "C:/ws").unwrap();
        let b = OwnedSid::derive("workspace", "C:/ws").unwrap();
        let other_path = OwnedSid::derive("workspace", "C:/other").unwrap();
        let other_domain = OwnedSid::derive("temp", "C:/ws").unwrap();
        assert!(a.equals(&b), "同域同 tag 应确定性派生同一 SID");
        assert!(!a.equals(&other_path), "不同 tag 应派生不同 SID");
        assert!(!a.equals(&other_domain), "域分离：不同 domain 应派生不同 SID");
        assert!(sid_len(&a) >= 8, "SID 长度应有效");
    }

    #[test]
    fn restricted_token_derives_with_and_without_extras() {
        // read-only 语义（无 extra）与 workspace-write 语义（带工作区 SID）均应可派生
        let ro = RestrictedToken::derive(&[]).expect("read-only 受限令牌应可派生");
        drop(ro);
        let ws = OwnedSid::derive("workspace", "C:/ws").unwrap();
        let rw = RestrictedToken::derive(&[&ws]).expect("workspace-write 受限令牌应可派生");
        drop(rw);
    }

    /// read-only：子进程能正常启动（保活 SID 有效）且无任何写能力
    #[tokio::test]
    async fn readonly_child_runs_but_cannot_write() {
        let dir = tempfile::tempdir().unwrap();
        let token = RestrictedToken::derive(&[]).unwrap();

        let (code, out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd("echo hello"),
                cwd: Some(dir.path()),
                env: vec![],
                flags: 0,
            },
        )
        .await;
        assert_eq!(code, Some(0), "只读受限子进程应能启动并退出 0；stderr={err}");
        assert!(out.contains("hello"), "应捕获 stdout：{out}");

        // 写：read-only 无任何写能力 → 文件不得出现
        let target = dir.path().join("ro-write.txt");
        let (_code, _out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd(&format!("echo x > \"{}\"", target.display())),
                cwd: Some(dir.path()),
                env: vec![],
                flags: 0,
            },
        )
        .await;
        assert!(!target.exists(), "read-only 下写应被拒（stderr={err}）");
    }

    /// workspace-write：区内可写 / 区外写拒 / 任意路径读不受限；授予幂等（exact-ACE skip）
    #[tokio::test]
    async fn workspace_write_boundary_and_read_freedom() {
        let ws_dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let ws_sid = OwnedSid::derive("workspace", &canonical(ws_dir.path())).unwrap();

        assert!(grant_write(ws_dir.path(), &ws_sid).unwrap(), "首次授予应发生");
        assert!(
            !grant_write(ws_dir.path(), &ws_sid).unwrap(),
            "重复授予应跳过（exact-ACE skip）"
        );

        let token = RestrictedToken::derive(&[&ws_sid]).unwrap();

        // 区内写 → 成功
        let inner = ws_dir.path().join("inner.txt");
        let (code, _out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd(&format!("echo inside > \"{}\"", inner.display())),
                cwd: Some(ws_dir.path()),
                env: vec![],
                flags: 0,
            },
        )
        .await;
        assert!(inner.exists(), "工作区内写应成功（code={code:?}, stderr={err}）");

        // 区外写 → 拒绝（文件不得出现）
        let out_file = outside.path().join("outer.txt");
        let (_code, _out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd(&format!("echo outside > \"{}\"", out_file.display())),
                cwd: Some(ws_dir.path()),
                env: vec![],
                flags: 0,
            },
        )
        .await;
        assert!(
            !out_file.exists(),
            "工作区外写应被系统拒绝（stderr={err}）"
        );

        // 任意路径读 → 不受限
        let readme = outside.path().join("readme.txt");
        std::fs::write(&readme, "readable-anywhere").unwrap();
        let (code, out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd(&format!("type \"{}\"", readme.display())),
                cwd: Some(ws_dir.path()),
                env: vec![],
                flags: 0,
            },
        )
        .await;
        assert_eq!(code, Some(0), "读任意路径应成功（stderr={err}）");
        assert!(out.contains("readable-anywhere"), "应读到内容：{out}");
    }

    /// 私有 temp：TMP/TEMP 重写到已授予目录 → 可写；%TEMP% 展开为重写后的路径
    #[tokio::test]
    async fn private_temp_write_and_env_rewrite() {
        let temp = tempfile::tempdir().unwrap();
        let temp_path = canonical(temp.path());
        let temp_sid = OwnedSid::derive("temp", &temp_path).unwrap();
        grant_write(temp.path(), &temp_sid).unwrap();

        let token = RestrictedToken::derive(&[&temp_sid]).unwrap();
        let (_code, out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd("echo %TEMP% & echo x > \"%TEMP%\\t.txt\""),
                cwd: Some(temp.path()),
                env: vec![
                    ("TMP".to_string(), temp_path.clone()),
                    ("TEMP".to_string(), temp_path.clone()),
                ],
                flags: 0,
            },
        )
        .await;
        assert!(
            out.to_lowercase().contains(&temp_path.to_lowercase()),
            "%TEMP% 应展开为重写后的私有目录：{out}（stderr={err}）"
        );
        assert!(
            temp.path().join("t.txt").exists(),
            "私有 temp 内写应成功（stderr={err}）"
        );
    }

    /// 未授予的「兄弟 temp」不可写（会话间私有 temp 隔离语义）
    #[tokio::test]
    async fn sibling_temp_is_not_writable() {
        let temp_a = tempfile::tempdir().unwrap();
        let temp_b = tempfile::tempdir().unwrap();
        let sid_a = OwnedSid::derive("temp", &canonical(temp_a.path())).unwrap();
        grant_write(temp_a.path(), &sid_a).unwrap();

        // 令牌只带 A 的 temp SID；对 B 的写应被拒
        let token = RestrictedToken::derive(&[&sid_a]).unwrap();
        let target_b = temp_b.path().join("b.txt");
        let (_code, _out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd(&format!("echo x > \"{}\"", target_b.display())),
                cwd: Some(temp_a.path()),
                env: vec![],
                flags: 0,
            },
        )
        .await;
        assert!(!target_b.exists(), "兄弟 temp 写应被拒（stderr={err}）");
    }

    /// 控制台标志矩阵（spike 探查）：受限令牌下三种控制台行为是否可用
    ///
    /// dsh 记录：受限令牌下 `CREATE_NO_WINDOW` / `CREATE_NEW_CONSOLE` 会在 DLL 初始化阶段死亡
    /// （`STATUS_DLL_INIT_FAILED 0xC0000142`）——本测试在真机验证并对 GUI 场景（无控制台父进程）选型。
    #[tokio::test]
    async fn spawn_flag_variants_availability() {
        let token = RestrictedToken::derive(&[]).unwrap();
        let variants: [(&str, u32); 3] = [
            ("none", 0),
            ("create_no_window", CREATE_NO_WINDOW),
            ("detached_process", DETACHED_PROCESS),
        ];
        let mut ok_variants: Vec<&str> = Vec::new();
        let mut failed: Vec<String> = Vec::new();
        for (name, flags) in variants {
            let (code, out, err) = run_confined(
                &token,
                &SpawnRequest {
                    command: &cmdline_for_cmd("echo hi"),
                    cwd: None,
                    env: vec![],
                    flags,
                },
            )
            .await;
            if code == Some(0) && out.contains("hi") {
                ok_variants.push(name);
            } else {
                failed.push(format!("{name}: code={code:?} err={err}"));
            }
        }
        // 基线：无控制台标志必须可用（保活 SID 有效性的最小断言）
        assert!(
            ok_variants.contains(&"none"),
            "无标志变体必须可用；可用={ok_variants:?} 失败={failed:?}"
        );
        // 结论输出（spike 探查记录，供 GUI 场景（无控制台父进程）选型）
        println!("[spike] 受限令牌下控制台标志可用性：可用={ok_variants:?} 失败={failed:?}");
    }

    /// R2 探针：以给定令牌（None=对照）挂载 ConPTY 并尝试交互执行
    ///
    /// 返回（是否可交互执行, 诊断串）
    async fn conpty_probe(
        token: Option<*mut c_void>,
        dir: &Path,
        escape: &Path,
    ) -> (bool, String) {
        use crate::pty::conpty_passthrough::PassthroughPty;
        use std::io::{Read, Write};

        // 清理上一轮残留（保证「越界写」判定针对本轮）
        let _ = std::fs::remove_file(escape);

        let pty = match PassthroughPty::spawn_with_token(
            "cmd.exe",
            &plain_abs(dir),
            &[],
            80,
            24,
            token,
        ) {
            Ok(p) => p,
            Err(e) => return (false, format!("spawn 失败: {e}")),
        };
        // DSR 应答（对齐 spawn_passthrough：ConPTY 启动发 ESC[6n，不回则子进程输出挂起）
        {
            let mut hs_reader = match pty.try_clone_reader() {
                Ok(r) => r,
                Err(e) => return (false, format!("读端克隆失败: {e}")),
            };
            let mut hs_buf = [0u8; 64];
            let mut dsr_found = false;
            for _ in 0..4 {
                match hs_reader.read(&mut hs_buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if crate::pty::conpty_passthrough::find_dsr(&hs_buf[..n]).is_some() {
                            dsr_found = true;
                            break;
                        }
                    }
                }
            }
            if dsr_found {
                let mut hs_writer = match pty.try_clone_writer() {
                    Ok(w) => w,
                    Err(e) => return (false, format!("写端克隆失败: {e}")),
                };
                if hs_writer.write_all(b"\x1b[1;1R").and_then(|_| hs_writer.flush()).is_err() {
                    return (false, "DSR 应答写入失败".into());
                }
            }
        }
        let mut writer = pty.try_clone_writer().expect("写端句柄");
        let mut reader = pty.try_clone_reader().expect("读端句柄");
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        tokio::time::sleep(Duration::from_millis(400)).await;
        // 两行发送：cmd 按「整行解析期」展开 %VAR%（同一行内 set 后立即引用拿到的是空值）
        let first = "set M=AAA\r\n";
        if let Err(e) = writer.write_all(first.as_bytes()) {
            return (false, format!("写会话失败: {e}"));
        }
        writer.flush().ok();
        tokio::time::sleep(Duration::from_millis(200)).await;
        let second = format!("echo %M%B & echo x > \"{}\"\r\n", escape.display());
        if let Err(e) = writer.write_all(second.as_bytes()) {
            return (false, format!("写会话失败: {e}"));
        }
        writer.flush().ok();

        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        let mut acc = String::new();
        let mut interactive = false;
        while std::time::Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                acc.push_str(&String::from_utf8_lossy(&chunk));
                if acc.contains("AAAB") {
                    interactive = true;
                    break;
                }
            }
        }
        let exit = pty.try_wait().ok().flatten();
        let _ = pty.kill();
        let diag = format!(
            "退出码={exit:?} 捕获={:?} 越界写={}",
            acc.chars().take(160).collect::<String>(),
            if escape.exists() { "已写入" } else { "未写入" }
        );
        (interactive, diag)
    }

    /// R2 探查：受限令牌 × 自研 ConPTY passthrough 组合（dsh 未验证其 PTY 通道）
    ///
    /// 对照组（无令牌）必须可交互（既有能力回归）；受限变体记录结论（决定 E3-3 的 PTY 覆盖路线）。
    #[tokio::test]
    async fn conpty_with_restricted_token_probe() {
        let dir = tempfile::tempdir().unwrap();
        let escape = dir.path().join("pty-escape.txt");

        let (control_ok, control_diag) = conpty_probe(None, dir.path(), &escape).await;
        assert!(control_ok, "对照组（无令牌）ConPTY 应可交互：{control_diag}");

        let token = RestrictedToken::derive(&[]).unwrap();
        let (token_ok, token_diag) =
            conpty_probe(Some(token.raw_handle()), dir.path(), &escape).await;
        if token_ok {
            assert!(!escape.exists(), "受限 PTY 会话的越界写应被拒");
        }
        println!("[spike] R2 ConPTY×受限令牌：可交互={token_ok} 诊断={token_diag}");
    }

    /// E3-2 收口补探：受限令牌下 powershell 的 argv 形态可用性（引用 / 语言模式 / 退出码）
    #[tokio::test]
    async fn powershell_confined_argv_probe() {
        let ws = tempfile::tempdir().unwrap();
        let spec = agent_runtime::sandbox::SandboxSpec {
            mode: agent_runtime::sandbox::SandboxMode::WorkspaceWrite,
            root: ws.path().to_path_buf(),
        };
        let script = "Write-Output CONFINED-OK";
        let direct = cmdline_from_argv(&[
            "powershell.exe".to_string(),
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-Command".to_string(),
            script.to_string(),
        ]);
        let wrapped = cmdline_for_cmd(&direct);
        for (name, cmdline, flags) in [
            ("direct+none", &direct, 0u32),
            ("direct+detached", &direct, DETACHED_PROCESS),
            ("cmd-wrap+none", &wrapped, 0u32),
            ("cmd-wrap+detached", &wrapped, DETACHED_PROCESS),
        ] {
            let token = RestrictedToken::derive(&[]).unwrap(); // read-only 也足以测「能否执行脚本」
            let mut child = spawn_confined(
                &token,
                &SpawnRequest {
                    command: cmdline,
                    cwd: Some(ws.path()),
                    env: vec![],
                    flags,
                },
            )
            .unwrap();
            let out = read_all(child.take_stdout()).await;
            let err = read_all(child.take_stderr()).await;
            let code = child.wait_timeout(Duration::from_secs(30)).await.unwrap();
            println!(
                "[probe] {name}: code={code:?} out={:?} err={:?}",
                out.trim(),
                err.trim()
            );
        }
        let _ = &spec;
    }

    /// E3-2 收口补探②：**非受限**对照——powershell 在 DETACHED / NO_WINDOW 下是否可用（判断与令牌是否相关）
    #[tokio::test]
    async fn powershell_plain_flag_matrix_probe() {
        for (name, flags) in [
            ("none", 0u32),
            ("create_no_window", CREATE_NO_WINDOW),
            ("detached_process", DETACHED_PROCESS),
        ] {
            let mut cmd = tokio::process::Command::new("powershell.exe");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", "Write-Output PLAIN-OK"]);
            if flags != 0 {
                cmd.creation_flags(flags);
            }
            let out = cmd.output().await.unwrap();
            println!(
                "[probe] plain-powershell {name}: code={:?} out={:?} err={:?}",
                out.status.code(),
                String::from_utf8_lossy(&out.stdout).trim(),
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
    }

    /// R4 补探：WSL 拒绝访问的成因定位——把 INTERACTIVE（S-1-5-4）加入限制 SID 是否能让 wsl.exe 启动？
    ///
    /// 结论影响 D9 的可选项（是否值得为该通道放宽令牌清单；放宽代价：Public 树可写，dsh 明确排除该 SID）。
    #[tokio::test]
    async fn wsl_with_interactive_sid_probe() {
        let plain = tokio::process::Command::new("wsl.exe")
            .args(["-e", "true"])
            .output()
            .await;
        if !matches!(&plain, Ok(o) if o.status.success()) {
            println!("[spike] R4 补探：本机 WSL 不可用，跳过");
            return;
        }
        let baseline = RestrictedToken::derive(&[]).unwrap();
        let interactive = OwnedSid::alloc(
            SID_IDENTIFIER_AUTHORITY {
                Value: [0, 0, 0, 0, 0, 5],
            },
            &[4],
        )
        .unwrap();
        let with_interactive = RestrictedToken::derive(&[&interactive]).unwrap();
        let (a, _o1, _e1) = run_confined(
            &baseline,
            &SpawnRequest {
                command: &cmdline_for_cmd("wsl.exe -e true"),
                cwd: None,
                env: vec![],
                flags: 0,
            },
        )
        .await;
        let (b, o2, e2) = run_confined(
            &with_interactive,
            &SpawnRequest {
                command: &cmdline_for_cmd("wsl.exe -e true"),
                cwd: None,
                env: vec![],
                flags: 0,
            },
        )
        .await;
        println!(
            "[spike] R4 补探：基准令牌 exit={a:?}；含 INTERACTIVE exit={b:?} out={:?} err={:?}",
            o2.trim(),
            e2.trim()
        );
    }

    /// R4 探查：bash 工具在 Windows 经 `wsl.exe`——受限令牌能否约束 Linux 侧写（含 /mnt/c 映射）？
    ///
    /// 结论决定 D9（登记限制 / 评估改通道）；无 WSL 环境自动跳过。
    #[tokio::test]
    async fn wsl_channel_confinement_probe() {
        // 第一段：非受限探针——区分「本机无 WSL」与「受限令牌下起不来」
        let plain = tokio::process::Command::new("wsl.exe")
            .args(["-e", "true"])
            .output()
            .await;
        let plain_ok = matches!(&plain, Ok(o) if o.status.success());
        if !plain_ok {
            println!(
                "[spike] R4：本机 WSL 不可用（plain={plain:?}），跳过探查"
            );
            return;
        }

        let token = RestrictedToken::derive(&[]).unwrap(); // read-only（什么 Windows 侧写都不许）
        let (probe_code, probe_out, probe_err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd("wsl.exe -e true"),
                cwd: None,
                env: vec![],
                flags: 0,
            },
        )
        .await;
        println!(
            "[spike] R4：plain WSL 可用；受限令牌下 wsl.exe 启动 exit={probe_code:?} out={:?} err={:?}",
            probe_out.trim(),
            probe_err.trim()
        );
        if probe_code != Some(0) {
            return; // 受限令牌起不来 wsl.exe：通道不可用（同样构成结论）
        }

        let dir = tempfile::tempdir().unwrap();
        let win_path = canonical(dir.path());
        // C:\Users\... → /mnt/c/Users/...
        let wsl_path = {
            let mut chars = win_path.chars();
            let drive = chars.next().unwrap_or('c').to_ascii_lowercase();
            let rest: String = chars.collect();
            format!("/mnt/{drive}{}", rest.replace('\\', "/"))
        };
        let (_code, out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd(&format!("wsl.exe -e sh -c \"echo x > {wsl_path}/wsl.txt\"")),
                cwd: Some(dir.path()),
                env: vec![],
                flags: 0,
            },
        )
        .await;
        let escaped = dir.path().join("wsl.txt").exists();
        println!(
            "[spike] R4 WSL 通道探查：Windows 侧文件={} | out={} err={}",
            if escaped { "已写入（旁路）" } else { "未写入（被拦）" },
            out.trim(),
            err.trim()
        );
    }

    // ─── E3-3（2026-09-18，真机）：PTY 受限会话位与会话级 temp ───

    /// E3-3：PTY 会话位形态——ReadOnly 仅令牌（无 env / 无 temp）；WorkspaceWrite 重写 TMP/TEMP
    #[test]
    fn pty_session_bits_shapes() {
        use agent_runtime::sandbox::{SandboxMode, SandboxSpec};
        let ws = tempfile::tempdir().unwrap();

        let mut ro = pty_session_bits(&SandboxSpec {
            mode: SandboxMode::ReadOnly,
            root: ws.path().to_path_buf(),
        })
        .expect("ReadOnly 会话位应可构造");
        assert!(ro.env().is_empty(), "ReadOnly 不应重写 TMP/TEMP");
        assert!(ro.take_temp().is_none(), "ReadOnly 不应建立会话 temp");

        let mut rw = pty_session_bits(&SandboxSpec {
            mode: SandboxMode::WorkspaceWrite,
            root: ws.path().to_path_buf(),
        })
        .expect("WorkspaceWrite 会话位应可构造");
        let env: Vec<(String, String)> = rw.env().to_vec();
        assert!(
            env.iter().any(|(k, _)| k == "TMP") && env.iter().any(|(k, _)| k == "TEMP"),
            "WorkspaceWrite 应重写 TMP/TEMP: {env:?}"
        );
        assert!(
            env.iter().all(|(_, v)| v.contains("worldsea-sandbox")),
            "TMP/TEMP 应指向私有 temp: {env:?}"
        );
        let temp = rw.take_temp().expect("WorkspaceWrite 应建立会话 temp");
        assert!(temp.dir.exists(), "会话 temp 目录应已建立");
        temp.revoke_and_remove();
    }

    /// E3-3（真机）：会话级 temp 生命周期——建立授予后可写；撤销 + 删除后目录消失
    #[tokio::test]
    async fn session_temp_lifecycle_revoke_and_remove() {
        let temp = SessionTemp::create().unwrap();
        let dir = temp.dir.clone();
        let token = RestrictedToken::derive(&[&temp.sid]).unwrap();

        let (code, _out, err) = run_confined(
            &token,
            &SpawnRequest {
                command: &cmdline_for_cmd(&format!("echo x > \"{}\\t.txt\"", dir.display())),
                cwd: Some(&dir),
                env: vec![],
                flags: 0,
            },
        )
        .await;
        assert!(
            dir.join("t.txt").exists(),
            "会话 temp 内写应成功（code={code:?}, stderr={err}）"
        );

        temp.revoke_and_remove();
        assert!(!dir.exists(), "撤销 + 删除后会话 temp 目录应消失");
    }
}