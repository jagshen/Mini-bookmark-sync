// ========== 视图元素 ==========
const homeView = document.getElementById('homeView');
const configView = document.getElementById('configView');

// 主页元素
const connBadge = document.getElementById('connBadge');
const domainText = document.getElementById('domainText');
const subInfo = document.getElementById('subInfo');
const lastSyncBox = document.getElementById('lastSyncBox');
const autoSyncTag = document.getElementById('autoSyncTag');
const openConfigBtn = document.getElementById('openConfigBtn');
const uploadBtn = document.getElementById('uploadBtn');
const downloadBtn = document.getElementById('downloadBtn');
const syncBtn = document.getElementById('syncBtn');
const statusDiv = document.getElementById('status');
const footerRow = document.getElementById('footerRow');
const addConfigBtn = document.getElementById('addConfigBtn');
const homeCard = document.getElementById('homeCard');
const emptyHero = document.getElementById('emptyHero');

// 赞赏码 hover 显示/隐藏
const sponsorBtn = document.getElementById('sponsorBtn');
const sponsorArea = document.getElementById('sponsorArea');
let sponsorHideTimer = null;

function showSponsor() {
  if (sponsorHideTimer) { clearTimeout(sponsorHideTimer); sponsorHideTimer = null; }
  if (sponsorArea) sponsorArea.classList.add('show');
  if (statusDiv) statusDiv.textContent = '感谢支持！';
}
function hideSponsor() {
  if (sponsorHideTimer) clearTimeout(sponsorHideTimer);
  sponsorHideTimer = setTimeout(() => {
    if (sponsorArea) sponsorArea.classList.remove('show');
    if (statusDiv) statusDiv.textContent = '就绪';
  }, 150);
}

if (sponsorBtn && sponsorArea) {
  sponsorBtn.addEventListener('mouseenter', showSponsor);
  sponsorBtn.addEventListener('mouseleave', hideSponsor);
  sponsorArea.addEventListener('mouseenter', showSponsor);
  sponsorArea.addEventListener('mouseleave', hideSponsor);
}

// 配置页元素
const backBtn = document.getElementById('backBtn');
const saveBtn = document.getElementById('saveBtn');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const clearConfigBtn = document.getElementById('clearConfigBtn');
const syncEnabledCb = document.getElementById('syncEnabled');
const intervalSelect = document.getElementById('intervalSelect');
const syncTypeSelect = document.getElementById('syncTypeSelect');
const configStatus = document.getElementById('configStatus');

// ========== 工具函数 ==========

// 解析域名（从 WebDAV URL 提取 host）
function parseHost(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.host;
  } catch (e) {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

// "上次同步"文案：
//  - 1 小时内：X 分钟之前更新（<1 分钟显示"刚刚更新"）
//  - 超过 1 小时但同一天：今天 HH:MM 更新
//  - 超过一天：YYYY-MM-DD HH:MM 更新
function formatLastSyncText(ts) {
  if (!ts) return '上次同步：从未';
  const now = new Date();
  const then = new Date(ts);
  const diffSec = Math.floor((now.getTime() - ts) / 1000);
  const pad = (n) => String(n).padStart(2, '0');

  if (diffSec < 60) {
    return '上次同步：刚刚更新';
  }
  if (diffSec < 3600) {
    return `上次同步：${Math.floor(diffSec / 60)} 分钟之前更新`;
  }
  const sameDay =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate();
  if (sameDay) {
    return `上次同步：今天 ${pad(then.getHours())}:${pad(then.getMinutes())} 更新`;
  }
  return `上次同步：${then.getFullYear()}-${pad(then.getMonth() + 1)}-${pad(then.getDate())} ` +
         `${pad(then.getHours())}:${pad(then.getMinutes())} 更新`;
}

function renderLastSync(ts) {
  lastSyncBox.innerText = formatLastSyncText(ts);
  if (ts) lastSyncBox.classList.remove('never');
  else lastSyncBox.classList.add('never');
}

function renderAutoSync(enabled, interval, type) {
  if (enabled) {
    const typeLabel = type === 'upload' ? '上传' : type === 'download' ? '下载' : '合并';
    autoSyncTag.innerText = `每 ${interval || 30} 分钟${typeLabel}`;
    autoSyncTag.classList.remove('off');
  } else {
    autoSyncTag.innerText = '未启用自动同步';
    autoSyncTag.classList.add('off');
  }
}

// 渲染右上角「已启用/未启用」徽标。依赖两个状态：
//  - configured：WebDAV 四项填全了吗（未配置时徽标灰掉、不允许切换）
//  - enabled：sync_enabled 状态
function renderBadge(configured, enabled) {
  if (!configured) {
    connBadge.innerText = '● 未启用';
    connBadge.className = 'badge-ok off disabled';
    connBadge.title = '请先完成 WebDAV 配置';
    return;
  }
  if (enabled) {
    connBadge.innerText = '● 已启用';
    connBadge.className = 'badge-ok';
  } else {
    connBadge.innerText = '● 未启用';
    connBadge.className = 'badge-ok off';
  }
  connBadge.title = '点击切换自动同步';
}

// 根据配置完整度切换主页展示
function renderHome(cfg) {
  const configured = !!(cfg.webdav_url && cfg.webdav_user && cfg.webdav_password);
  const host = parseHost(cfg.webdav_url);

  if (configured) {
    domainText.innerText = '极简同步，书签随身带';
    subInfo.innerText = `${cfg.webdav_user || ''}@${host}`;

    homeCard.classList.remove('hide');
    emptyHero.classList.add('hide');
    footerRow.classList.add('hide');

    uploadBtn.disabled = false;
    downloadBtn.disabled = false;
    syncBtn.disabled = false;
  } else {
    // 未配置：隐藏卡片，露出标题区 + 「+ 添加配置」按钮
    homeCard.classList.add('hide');
    emptyHero.classList.remove('hide');
    footerRow.classList.remove('hide');

    uploadBtn.disabled = true;
    downloadBtn.disabled = true;
    syncBtn.disabled = true;
  }
  return configured;
}

function setStatus(text, type) {
  statusDiv.innerText = text || '';
  // 仅改 status-bar 的类（.err / .ok 控制 .status-text 颜色）
  statusDiv.parentElement.className = 'status-bar' + (type ? ' ' + type : '');
}

// ========== 视图切换 ==========
function showHome() {
  configView.classList.add('hide');
  homeView.classList.remove('hide');
  loadAll();
}
function showConfig() {
  homeView.classList.add('hide');
  configView.classList.remove('hide');
  loadConfigForm();
}

openConfigBtn.onclick = showConfig;
addConfigBtn.onclick = showConfig;
backBtn.onclick = showHome;

// ========== 数据加载 ==========
async function loadAll() {
  const result = await chrome.storage.local.get([
    'webdav_url',
    'webdav_user',
    'webdav_password',
    'last_sync_at',
    'sync_enabled',
    'sync_interval',
    'sync_type'
  ]);
  const configured = renderHome(result);
  renderLastSync(result.last_sync_at);
  renderAutoSync(!!result.sync_enabled, result.sync_interval, result.sync_type);
  renderBadge(configured, !!result.sync_enabled);
}

async function loadConfigForm() {
  const result = await chrome.storage.local.get([
    'webdav_url',
    'webdav_user',
    'webdav_password',
    'webdav_bookmark_path',
    'sync_enabled',
    'sync_interval',
    'sync_type'
  ]);
  document.getElementById('webdav_url').value = result.webdav_url || '';
  document.getElementById('webdav_user').value = result.webdav_user || '';
  document.getElementById('webdav_password').value = result.webdav_password || '';
  document.getElementById('webdav_path').value = result.webdav_bookmark_path || '/bookmarks.json';
  syncEnabledCb.checked = !!result.sync_enabled;
  intervalSelect.value = String(result.sync_interval || 30);
  syncTypeSelect.value = result.sync_type || 'merge';
  configStatus.innerText = '';
  configStatus.className = 'status-bar';
}

// ========== 配置页动作：统一保存 ==========
saveBtn.onclick = async () => {
  const url = document.getElementById('webdav_url').value.trim();
  const user = document.getElementById('webdav_user').value.trim();
  const password = document.getElementById('webdav_password').value;
  const path = document.getElementById('webdav_path').value.trim() || '/bookmarks.json';
  const enabled = syncEnabledCb.checked;
  const interval = parseInt(intervalSelect.value, 10);
  const syncType = syncTypeSelect.value || 'merge';

  if (!url || !user || !password) {
    configStatus.innerText = '请填写完整的 WebDAV 地址、用户名和密码';
    configStatus.className = 'status-bar err';
    return;
  }

  // 验证 WebDAV URL 格式
  if (!/^https?:\/\/.+/.test(url)) {
    configStatus.innerText = 'WebDAV 地址必须以 http:// 或 https:// 开头';
    configStatus.className = 'status-bar err';
    return;
  }

  // 验证路径安全性：只允许安全字符，禁止路径注入
  if (!/^\/[a-zA-Z0-9_.\-/]*$/.test(path)) {
    configStatus.innerText = '路径只能包含字母、数字、-、_、/、. 且必须以 / 开头';
    configStatus.className = 'status-bar err';
    return;
  }
  if (path.includes('../') || path.includes('./')) {
    configStatus.innerText = '路径不能包含 ../ 或 ./';
    configStatus.className = 'status-bar err';
    return;
  }

  await chrome.storage.local.set({
    webdav_url: url,
    webdav_user: user,
    webdav_password: password,
    webdav_bookmark_path: path,
    sync_enabled: enabled,
    sync_interval: interval,
    sync_type: syncType
  });

  // 动态申请 WebDAV 域名的 host 权限（收窄权限，符合审核规范）
  try {
    const origin = new URL(url).origin + '/*';
    await new Promise((resolve, reject) => {
      chrome.permissions.request({ origins: [origin] }, (granted) => {
        if (granted) resolve(); else reject(new Error('用户拒绝了域名访问授权'));
      });
    });
  } catch (permErr) {
    configStatus.innerText = '需要 WebDAV 域名访问权限才能同步，请点击"保存"重新尝试并允许授权';
    configStatus.className = 'status-bar err';
    return;
  }

  await chrome.runtime.sendMessage({ action: 'updateSyncInterval' });

  configStatus.innerText = '已保存';
  configStatus.className = 'status-bar ok';

  setTimeout(showHome, 400);
};

clearConfigBtn.onclick = () => {
  // 仅清空当前表单（草稿态），不动 storage。
  // 用户必须点「保存」才真正落库；若直接返回，下次进配置页仍能看到之前的配置。
  document.getElementById('webdav_url').value = '';
  document.getElementById('webdav_user').value = '';
  document.getElementById('webdav_password').value = '';
  document.getElementById('webdav_path').value = '/bookmarks.json';
  syncEnabledCb.checked = false;
  intervalSelect.value = '30';
  syncTypeSelect.value = 'merge';

  configStatus.innerText = '已清空表单（点击「保存」后生效）';
  configStatus.className = 'status-bar ok';
};

// ========== 测试连接 ==========
testConnectionBtn.onclick = async () => {
  const url = document.getElementById('webdav_url').value.trim();
  const user = document.getElementById('webdav_user').value.trim();
  const password = document.getElementById('webdav_password').value;
  const path = document.getElementById('webdav_path').value.trim() || '/bookmarks.json';

  if (!url || !user || !password) {
    configStatus.innerText = '请填写完整的 WebDAV 地址、用户名和密码';
    configStatus.className = 'status-bar err';
    return;
  }

  // 验证 WebDAV URL 格式
  if (!/^https?:\/\/.+/.test(url)) {
    configStatus.innerText = 'WebDAV 地址必须以 http:// 或 https:// 开头';
    configStatus.className = 'status-bar err';
    return;
  }

  // 验证路径安全性
  if (!/^\/[a-zA-Z0-9_.\-/]*$/.test(path)) {
    configStatus.innerText = '路径只能包含字母、数字、-、_、/、. 且必须以 / 开头';
    configStatus.className = 'status-bar err';
    return;
  }
  if (path.includes('../') || path.includes('./')) {
    configStatus.innerText = '路径不能包含 ../ 或 ./';
    configStatus.className = 'status-bar err';
    return;
  }

  configStatus.innerText = '正在测试连接...';
  configStatus.className = 'status-bar';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'testConnection',
      webdavUrl: url,
      webdavUser: user,
      webdavPassword: password,
      webdavPath: path
    });

    if (response && response.success) {
      configStatus.innerText = '连接测试成功！';
      configStatus.className = 'status-bar ok';
    } else {
      configStatus.innerText = (response && response.message) || '连接测试失败';
      configStatus.className = 'status-bar err';
    }
  } catch (e) {
    configStatus.innerText = e.message || '连接测试异常';
    configStatus.className = 'status-bar err';
  }
};

// ========== 主页操作 ==========
async function doAction(action, runningText) {
  setStatus(runningText);
  try {
    const response = await chrome.runtime.sendMessage({ action });
    if (response && response.success) {
      setStatus(response.message || '完成', 'ok');
    } else {
      setStatus((response && response.message) || '操作失败', 'err');
    }
  } catch (e) {
    setStatus(e.message || '操作异常', 'err');
  }
  const { last_sync_at } = await chrome.storage.local.get(['last_sync_at']);
  renderLastSync(last_sync_at);
}

uploadBtn.onclick = () => doAction('upload', '正在上传...');
downloadBtn.onclick = () => doAction('download', '正在下载...');
syncBtn.onclick = () => doAction('merge', '正在合并两端...');

// ========== 徽标点击：切换自动同步 ==========
connBadge.onclick = async () => {
  // 未配置时不允许切换
  if (connBadge.classList.contains('disabled')) {
    setStatus('请先完成 WebDAV 配置', 'err');
    return;
  }
  const r = await chrome.storage.local.get(['sync_enabled']);
  const next = !r.sync_enabled;
  await chrome.storage.local.set({ sync_enabled: next });
  // 通知 background 重建 alarm（启用/停用定时器）
  try { await chrome.runtime.sendMessage({ action: 'updateSyncInterval' }); } catch (e) {}
  setStatus(next ? '已启用自动同步' : '已关闭自动同步', 'ok');
};

// ========== 监听 storage 变化 ==========
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.last_sync_at) {
    renderLastSync(changes.last_sync_at.newValue);
  }
  if (changes.sync_enabled || changes.sync_interval || changes.sync_type) {
    chrome.storage.local.get(
      ['sync_enabled', 'sync_interval', 'sync_type', 'webdav_url', 'webdav_user', 'webdav_password']
    ).then((r) => {
      renderAutoSync(!!r.sync_enabled, r.sync_interval, r.sync_type);
      const configured = !!(r.webdav_url && r.webdav_user && r.webdav_password);
      renderBadge(configured, !!r.sync_enabled);
    });
  }
  if (changes.webdav_url || changes.webdav_user || changes.webdav_password) {
    loadAll();
  }
});

// 每 30s 刷新一下"XX 分钟之前"的相对时间
setInterval(async () => {
  if (homeView.classList.contains('hide')) return;
  const { last_sync_at } = await chrome.storage.local.get(['last_sync_at']);
  renderLastSync(last_sync_at);
}, 30000);

// 入口
loadAll();
