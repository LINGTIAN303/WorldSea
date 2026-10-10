// WorldSea 安装向导 · 页面流转逻辑（初版：安装/卸载步骤由 Rust mock 事件驱动）
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const curWin = window.__TAURI__.window.getCurrentWindow();

// ---- 页面与步骤定义 ----
// 安装流页面顺序（对应 sidebar 5 步）；卸载流 3 步
const FLOWS = {
  install: {
    sidebar: document.getElementById('sidebar-install'),
    steps: document.getElementById('steps-install'),
    order: ['welcome', 'license', 'location', 'installing', 'install-done'],
  },
  uninstall: {
    sidebar: document.getElementById('sidebar-uninstall'),
    steps: document.getElementById('steps-uninstall'),
    order: ['u-confirm', 'u-progress', 'u-done'],
  },
};

const pages = document.querySelectorAll('.pane-page');
let mode = 'install';
let dataDir = ''; // 真实数据目录（%APPDATA%\com.worldsea.app），由 Rust 返回

const CHECK_SVG =
  '<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M2.5 6.2l2.3 2.3 4.7-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---- 页面切换 + 步骤指示 ----
function showPage(name) {
  pages.forEach((p) => p.classList.toggle('active', p.dataset.page === name));
  const flow = FLOWS[mode];
  const idx = flow.order.indexOf(name);
  if (idx >= 0) {
    flow.steps.querySelectorAll('.step').forEach((el, i) => {
      const dot = el.querySelector('.step-dot');
      el.dataset.state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
      dot.innerHTML = i < idx ? CHECK_SVG : '';
    });
  }
  // 焦点管理：主按钮可用则聚焦；许可页特殊——焦点落复选框（键盘用户可直接 Space 勾选）
  const primary = document.querySelector(`.pane-page[data-page="${name}"] .btn-primary`);
  if (name === 'license') {
    document.getElementById('chk-accept').focus();
  } else if (primary && !primary.disabled) {
    primary.focus();
  }
}

function closeApp() {
  curWin.close();
}

// ---- 启动 ----
async function init() {
  mode = await invoke('get_mode');
  dataDir = await invoke('get_data_dir');
  // 对称设置两个 sidebar：HTML 里只有卸载 sidebar 带 hidden，卸载模式下安装 sidebar 会漏显示
  FLOWS.install.sidebar.hidden = mode !== 'install';
  FLOWS.uninstall.sidebar.hidden = mode !== 'uninstall';
  showPage(FLOWS[mode].order[0]);

  if (mode === 'install') {
    const destInput = document.getElementById('input-dest');
    destInput.value = await invoke('get_default_install_dir');
    const freeMb = await invoke('get_free_space_mb', { path: destInput.value });
    document.getElementById('free-space').textContent = (freeMb / 1024).toFixed(1) + ' GB';
    document.getElementById('kv-datadir').textContent = dataDir;
    fetch('license.txt')
      .then((r) => r.text())
      .then((t) => (document.getElementById('license-box').textContent = t))
      .catch(() => (document.getElementById('license-box').textContent = '许可协议文件缺失。'));
  } else {
    // 卸载模式：从注册表读已安装位置；读不到则按卸载器所在目录处理
    const loc = await invoke('get_install_location');
    document.getElementById('u-kv-dest').textContent = loc || '（按卸载器所在目录清理）';
  }
}

// ---- 关闭按钮 ----
document.getElementById('btn-close').addEventListener('click', closeApp);

// ---- 安装流：欢迎页 ----
document.getElementById('btn-welcome-cancel').addEventListener('click', closeApp);
document.getElementById('btn-welcome-next').addEventListener('click', () => showPage('license'));

// ---- 许可页：勾选后启用下一步并聚焦（键盘 Space 勾选 → Enter 继续） ----
const chkAccept = document.getElementById('chk-accept');
const btnLicenseNext = document.getElementById('btn-license-next');
chkAccept.addEventListener('change', () => {
  btnLicenseNext.disabled = !chkAccept.checked;
  if (!btnLicenseNext.disabled) btnLicenseNext.focus();
});
document.getElementById('btn-license-back').addEventListener('click', () => showPage('welcome'));
btnLicenseNext.addEventListener('click', () => showPage('location'));

// ---- 安装位置页 ----
document.getElementById('btn-location-back').addEventListener('click', () => showPage('license'));
document.getElementById('btn-location-next').addEventListener('click', () => startInstall());

// ---- 安装过程页：进度事件渲染 ----
const installLog = document.getElementById('install-log');
const installBar = document.getElementById('install-progress');
let logLines = [];
let elapsedTimer = null;
let elapsedSec = 0;

function startElapsed() {
  elapsedSec = 0;
  document.getElementById('install-elapsed').textContent = '已用 0 秒';
  elapsedTimer = setInterval(() => {
    elapsedSec += 1;
    document.getElementById('install-elapsed').textContent = `已用 ${elapsedSec} 秒`;
  }, 1000);
}

function stopElapsed() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
}

async function startInstall() {
  installLog.innerHTML = '';
  logLines = [];
  installBar.style.width = '0%';
  showPage('installing');
  startElapsed();
  await invoke('perform_install', {
    dest: document.getElementById('input-dest').value,
    scope: document.querySelector('input[name="scope"]:checked').value,
    desktop: document.getElementById('chk-desktop').checked,
    startmenu: document.getElementById('chk-startmenu').checked,
    contextmenu: document.getElementById('chk-contextmenu').checked,
  });
}

document.getElementById('btn-install-cancel').addEventListener('click', async (e) => {
  e.target.disabled = true;
  await invoke('cancel_install');
});

// ---- 完成页 ----
document.getElementById('btn-done-open').addEventListener('click', () => {
  invoke('open_dir', { path: document.getElementById('input-dest').value });
});
document.getElementById('btn-done-finish').addEventListener('click', async () => {
  if (document.getElementById('chk-launch').checked) {
    await invoke('launch_app', { dest: document.getElementById('input-dest').value });
  }
  closeApp();
});

// ---- 卸载确认页：选择删除数据时强化警示 ----
const uWarnText = document.getElementById('u-warning-text');
const uWarnBox = document.getElementById('u-warning');
const uWarnOriginal = uWarnText.textContent;
document.querySelectorAll('input[name="data"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const purge = document.querySelector('input[name="data"]:checked').value === 'purge';
    uWarnText.textContent = purge
      ? uWarnOriginal + ' 已选择删除作品数据：卸载完成后，所有世界观、文档与笔记将无法恢复。'
      : uWarnOriginal;
    uWarnBox.dataset.tone = purge ? 'danger' : 'warn';
  });
});
document.getElementById('btn-uconfirm-cancel').addEventListener('click', closeApp);
document.getElementById('btn-uconfirm-uninstall').addEventListener('click', async () => {
  const purge = document.querySelector('input[name="data"]:checked').value === 'purge';
  const dd = document.getElementById('u-data-state');
  dd.textContent = purge ? '已删除 · ' + dataDir : '已保留 · ' + dataDir;
  dd.dataset.state = purge ? 'purged' : 'kept';
  document.getElementById('u-log').innerHTML = '';
  logLines = [];
  document.getElementById('u-progress').style.width = '0%';
  showPage('u-progress');
  await invoke('perform_uninstall', { purge });
});

// ---- 卸载完成页 ----
document.getElementById('btn-udone-open').addEventListener('click', () => {
  invoke('open_dir', { path: dataDir });
});
document.getElementById('btn-udone-close').addEventListener('click', closeApp);

// ---- 进度事件（安装/卸载共用一条事件流） ----
function onProgress(payload) {
  const isInstall = mode === 'install';
  const log = isInstall ? installLog : document.getElementById('u-log');
  const bar = isInstall ? installBar : document.getElementById('u-progress');

  if (payload.state === 'active') {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.dataset.state = 'active';
    const span = document.createElement('span');
    span.textContent = payload.text;
    line.appendChild(span);
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    logLines[payload.index] = line;
  } else {
    const line = logLines[payload.index];
    if (line) line.dataset.state = 'done';
    bar.style.width = `${((payload.index + 1) / payload.total) * 100}%`;
  }
}

// 步骤失败：红字日志 + 停止计时 + 恢复取消按钮
listen('installer://failed', (e) => {
  const log = mode === 'install' ? installLog : document.getElementById('u-log');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.dataset.state = 'error';
  const span = document.createElement('span');
  span.textContent = e.payload;
  line.appendChild(span);
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  stopElapsed();
  const cancelBtn = document.getElementById('btn-install-cancel');
  if (cancelBtn) cancelBtn.disabled = false;
});

listen('installer://progress', (e) => onProgress(e.payload));
listen('installer://done', () => {
  if (mode === 'install') {
    stopElapsed();
    document.getElementById('kv-dest').textContent = document.getElementById('input-dest').value;
    showPage('install-done');
  } else {
    showPage('u-done');
  }
});
listen('installer://cancelled', () => {
  stopElapsed();
  document.getElementById('btn-install-cancel').disabled = false;
  showPage('location');
});

init();
