// ========== 视图元素 ==========
const homeView = document.getElementById('homeView');
const configView = document.getElementById('configView');

// 生成 Basic Auth 请求头（支持 UTF-8 用户名/密码）
function getAuthHeader(user, password) {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

// 主页元素
const connBadge = document.getElementById('connBadge');
const domainText = document.getElementById('domainText');
const subInfo = document.getElementById('subInfo');
const lastSyncBox = document.getElementById('lastSyncBox');
const lastSyncTime = document.getElementById('lastSyncTime');
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


// 支持 hover 显示/隐藏
const sponsorBtn = document.getElementById('sponsorBtn');
const sponsorArea = document.getElementById('sponsorArea');
let sponsorHideTimer = null;
let savedStatusText = null;
let savedStatusBarClass = null;

function showSponsor() {
  if (sponsorHideTimer) { clearTimeout(sponsorHideTimer); sponsorHideTimer = null; }
  if (sponsorArea) sponsorArea.classList.add('show');
  if (statusDiv) {
    if (savedStatusText === null) {
      savedStatusText = statusDiv.textContent;
      savedStatusBarClass = statusDiv.parentElement ? statusDiv.parentElement.className : null;
    }
    statusDiv.textContent = '感谢支持！';
  }
}
function hideSponsor() {
  if (sponsorHideTimer) clearTimeout(sponsorHideTimer);
  sponsorHideTimer = setTimeout(() => {
    if (sponsorArea) sponsorArea.classList.remove('show');
    if (statusDiv && savedStatusText !== null) {
      statusDiv.textContent = savedStatusText;
      if (savedStatusBarClass !== null && statusDiv.parentElement) {
        statusDiv.parentElement.className = savedStatusBarClass;
      }
      savedStatusText = null;
      savedStatusBarClass = null;
    }
  }, 150);
}

const sponsorText = document.getElementById('sponsorText');
if (sponsorBtn && sponsorArea) {
  sponsorBtn.addEventListener('mouseenter', showSponsor);
  sponsorBtn.addEventListener('mouseleave', hideSponsor);
  sponsorArea.addEventListener('mouseenter', showSponsor);
  sponsorArea.addEventListener('mouseleave', hideSponsor);
  // 图标和区域点击都跳转
  sponsorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open('https://jagshen.github.io/Mini-bookmark-sync/support.html', '_blank');
  });
}
const backBtn = document.getElementById('backBtn');
const saveBtn = document.getElementById('saveBtn');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const clearConfigBtn = document.getElementById('clearConfigBtn');
const syncEnabledCb = document.getElementById('syncEnabled');
const intervalSelect = document.getElementById('intervalSelect');
const syncTypeSelect = document.getElementById('syncTypeSelect');
const configStatus = document.getElementById('configStatus');
const syncOptions = document.getElementById('syncOptions');

// 同步启用 checkbox 切换时展开/折叠选项
syncEnabledCb.addEventListener('change', () => {
  if (syncEnabledCb.checked) {
    syncOptions.classList.remove('hide');
  } else {
    syncOptions.classList.add('hide');
  }
});

// ========== 配置表单：输入即缓存草稿 ==========
// 用户在配置页的任何改动都会自动写入 chrome.storage.local[webdav_config_draft]，
// 即使没点「保存」就关闭弹窗，下次打开配置页也会回填。
function bindDraftAutosave() {
  const textFields = ['webdav_url', 'webdav_user', 'webdav_password', 'webdav_path'];
  textFields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', scheduleDraftSave);
  });
  syncEnabledCb.addEventListener('change', scheduleDraftSave);
  intervalSelect.addEventListener('change', scheduleDraftSave);
  syncTypeSelect.addEventListener('change', scheduleDraftSave);
}

// ========== 输入框聚焦提示 ==========
function bindFieldHints() {
  const pathInput = document.getElementById('webdav_path');
  const pathHint = document.getElementById('pathHint');
  if (!pathInput || !pathHint) return;
  pathInput.addEventListener('focus', () => pathHint.classList.add('show'));
  pathInput.addEventListener('blur', () => pathHint.classList.remove('show'));
}

// ========== 密码显示/隐藏切换 ==========
function bindPasswordToggle() {
  const btn = document.getElementById('togglePasswordBtn');
  const input = document.getElementById('webdav_password');
  if (!btn || !input) return;
  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    if (showing) {
      input.type = 'password';
      btn.textContent = '👁';
      btn.title = '显示密码';
      btn.setAttribute('aria-label', '显示密码');
      btn.setAttribute('aria-pressed', 'false');
    } else {
      input.type = 'text';
      btn.textContent = '🙈';
      btn.title = '隐藏密码';
      btn.setAttribute('aria-label', '隐藏密码');
      btn.setAttribute('aria-pressed', 'true');
    }
  });
}

// 把密码输入框恢复到隐藏状态（用于离开配置页、保存后等场景）
function resetPasswordVisibility() {
  const btn = document.getElementById('togglePasswordBtn');
  const input = document.getElementById('webdav_password');
  if (input) input.type = 'password';
  if (btn) {
    btn.textContent = '👁';
    btn.title = '显示密码';
    btn.setAttribute('aria-label', '显示密码');
    btn.setAttribute('aria-pressed', 'false');
  }
}

// ========== 工具函数 ==========

// 自定义确认模态框（替代 window.confirm，样式与扩展 UI 一致）
// 用法：const ok = await openConfirm({ title, body, okText, cancelText, danger });
function openConfirm(opts) {
  const { title = '确认操作', body = '', okText = '确定', cancelText = '取消', danger = true, icon = '!' } = opts || {};
  const overlay = document.getElementById('confirmModal');
  const titleEl = document.getElementById('confirmTitle');
  const bodyEl = document.getElementById('confirmBody');
  const iconEl = document.getElementById('confirmIcon');
  const okBtn = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if (!overlay || !okBtn || !cancelBtn) {
    // 兜底退回原生 confirm（极端情况下 DOM 缺失）
    return Promise.resolve(window.confirm((title ? title + '\n\n' : '') + body.replace(/<[^>]+>/g, '')));
  }
  titleEl.textContent = title;
  bodyEl.innerHTML = body; // 允许传入 HTML，调用方自行控制
  iconEl.textContent = icon;
  okBtn.textContent = okText;
  cancelBtn.textContent = cancelText;
  okBtn.className = 'modal-btn ' + (danger ? 'modal-btn-danger' : 'modal-btn-cancel');

  return new Promise((resolve) => {
    const cleanup = (result) => {
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden', 'true');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlay = (e) => { if (e.target === overlay) cleanup(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    // 聚焦到取消按钮，避免误触确认
    setTimeout(() => cancelBtn.focus(), 50);
  });
}

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

// "上次同步"文案（右侧时间部分）：
//  格式：YYYY-MM-DD HH:MM（<相对时间>）
//  相对时间规则：
//    < 5 秒      → 刚刚
//    < 60 秒     → N秒前
//    < 60 分钟   → N分钟前
//    今天（>=1h）→ 今天
//    昨天        → 昨天
//    前天        → 前天
//    更早        → 不显示括号
function formatLastSyncText(ts) {
  if (!ts) return '从未';
  const now = new Date();
  const then = new Date(ts);
  const diffMs = now.getTime() - ts;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  const pad = (n) => String(n).padStart(2, '0');

  // 绝对时间部分始终显示
  const absolute =
    `${then.getFullYear()}-${pad(then.getMonth() + 1)}-${pad(then.getDate())} ` +
    `${pad(then.getHours())}:${pad(then.getMinutes())}`;

  // 按自然日算"今天/昨天/前天"
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.floor((startOfDay(now) - startOfDay(then)) / 86400000);

  let rel = '';
  if (diffSec < 5) {
    rel = '刚刚';
  } else if (diffSec < 60) {
    rel = `${diffSec}秒前`;
  } else if (diffSec < 3600) {
    rel = `${Math.floor(diffSec / 60)}分钟前`;
  } else if (dayDiff === 0) {
    rel = '今天';
  } else if (dayDiff === 1) {
    rel = '昨天';
  } else if (dayDiff === 2) {
    rel = '前天';
  } else {
    rel = ''; // 超过前天不显示括号
  }

  return rel ? `${absolute}（${rel}）` : absolute;
}

function renderLastSync(ts) {
  lastSyncTime.innerText = formatLastSyncText(ts);
  if (ts) lastSyncBox.classList.remove('never');
  else lastSyncBox.classList.add('never');
}

function renderAutoSync(enabled, interval, type) {
  if (enabled) {
    const typeLabel = type === 'upload' ? '上传' : type === 'download' ? '下载' : '合并';
    autoSyncTag.innerText = `每 ${interval || 30} 分钟${typeLabel}`;
    autoSyncTag.classList.remove('off');
  } else {
    autoSyncTag.innerText = '未启用自动同步(右上角启用)';
    autoSyncTag.classList.add('off');
  }
}

// 渲染右上角滑块开关。依赖两个状态：
//  - configured：WebDAV 四项填全了吗（未配置时开关灰掉、不允许切换）
//  - enabled：sync_enabled 状态
// 文字规则：启用时显示"同步中"；未启用时不显示文字，只留开关。
function renderBadge(configured, enabled) {
  // DOM 结构固定：<span class="auto-switch"><span class="switch-label">…</span><span class="switch-track">…</span></span>
  const label = connBadge.querySelector('.switch-label');
  if (!configured) {
    if (label) label.innerText = '';
    connBadge.className = 'auto-switch off disabled';
    connBadge.title = '请先完成 WebDAV 配置';
    connBadge.setAttribute('aria-checked', 'false');
    return;
  }
  if (enabled) {
    if (label) label.innerText = '同步中';
    connBadge.className = 'auto-switch';
    connBadge.setAttribute('aria-checked', 'true');
    connBadge.title = '点击关闭自动同步';
  } else {
    if (label) label.innerText = '';
    connBadge.className = 'auto-switch off';
    connBadge.setAttribute('aria-checked', 'false');
    connBadge.title = '点击启用自动同步';
  }
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

// 状态栏显示规则：
//   - 未配置 → 不显示状态（由 emptyHero 展示）
//   - 已配置 → 异步测试连接，根据结果显示"配置就绪"或"配置未就绪"
async function updateHomeStatus() {
  if (homeView.classList.contains('hide')) return;
  const r = await chrome.storage.local.get([
    'webdav_url', 'webdav_user', 'webdav_password', 'webdav_bookmark_path',
    'last_sync_count'
  ]);
  const configured = !!(r.webdav_url && r.webdav_user && r.webdav_password);
  if (!configured) {
    setStatus('');
    renderProgressLine(null);
    return;
  }

  setStatus('正在检查配置...');
  renderProgressLine(null);

  // 通过 background 发请求检查连通性，避免 popup（extension page）触发 HTTP 认证弹窗
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'checkConfig',
      webdavUrl: r.webdav_url,
      webdavUser: r.webdav_user,
      webdavPassword: r.webdav_password,
      webdavPath: r.webdav_bookmark_path
    });
    if (result && result.ok) {
      setStatus('配置就绪', 'ok');
      await chrome.storage.local.set({ ever_connected: true });
    } else {
      setStatus('配置未就绪');
      renderProgressLine(null);
    }
  } catch (e) {
    // SW 未就绪等场景
    setStatus('配置未就绪');
    renderProgressLine(null);
  }
}

// 显示/隐藏操作记录行
function renderProgressLine(count, action) {
  const el = document.getElementById('progressLine');
  if (!el) return;
  if (count === null || count === undefined || count === '') {
    el.classList.add('hide');
    el.innerText = '';
    return;
  }
  el.classList.remove('hide');
  if (action) {
    el.innerText = `操作记录：${action}，共 ${count} 条书签`;
  } else {
    el.innerText = `进度：${count} 条`;
  }
}

// ========== 视图切换 ==========
function showHome() {
  // 离开配置页时把密码恢复为隐藏，避免下次打开还是明文
  resetPasswordVisibility();
  configView.classList.add('hide');
  homeView.classList.remove('hide');
  loadAll();
}
function showConfig() {
  resetPasswordVisibility();
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
    'sync_type',
    'ever_connected',
    'test_passed'       // 旧字段，迁移用
  ]);

  // 迁移：旧字段 test_passed → ever_connected
  if (result.test_passed === true && !result.ever_connected) {
    await chrome.storage.local.set({ ever_connected: true });
    result.ever_connected = true;
  }

  const configured = renderHome(result);
  renderLastSync(result.last_sync_at);
  renderAutoSync(!!result.sync_enabled, result.sync_interval, result.sync_type);
  renderBadge(configured, !!result.sync_enabled);
  updateHomeStatus();
}

// ========== 配置表单草稿（未保存态缓存） ==========
const DRAFT_KEY = 'webdav_config_draft';
let draftSaveTimer = null;
// 进入配置页时 storage 里"已保存"的基线值，用来对比当前表单是否 dirty
let savedBaseline = null;

// 收集当前表单值
function collectFormValues() {
  return {
    webdav_url: document.getElementById('webdav_url').value,
    webdav_user: document.getElementById('webdav_user').value,
    webdav_password: document.getElementById('webdav_password').value,
    webdav_bookmark_path: document.getElementById('webdav_path').value,
    sync_enabled: syncEnabledCb.checked,
    sync_interval: parseInt(intervalSelect.value, 10) || 30,
    sync_type: syncTypeSelect.value || 'merge'
  };
}

// 判断草稿是否与已保存配置有实质差异
function draftDiffersFromSaved(draft, saved) {
  if (!draft) return false;
  const normPath = (p) => normalizeBookmarkPathSafe(p);
  return (
    (draft.webdav_url || '') !== (saved.webdav_url || '') ||
    (draft.webdav_user || '') !== (saved.webdav_user || '') ||
    (draft.webdav_password || '') !== (saved.webdav_password || '') ||
    normPath(draft.webdav_bookmark_path) !== normPath(saved.webdav_bookmark_path) ||
    !!draft.sync_enabled !== !!saved.sync_enabled ||
    (draft.sync_interval || 30) !== (saved.sync_interval || 30) ||
    (draft.sync_type || 'merge') !== (saved.sync_type || 'merge')
  );
}

// 防抖写入草稿
function scheduleDraftSave() {
  // UI 立即反馈，不等防抖
  updateDirtyUI();

  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(async () => {
    const draft = collectFormValues();
    draft._ts = Date.now();
    try {
      await chrome.storage.local.set({ [DRAFT_KEY]: draft });
    } catch (e) {
      // 忽略存储异常，草稿非关键路径
    }
  }, 300);
}

// 清除草稿（保存成功或用户主动清除时调用）
async function clearDraft() {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  try {
    await chrome.storage.local.remove(DRAFT_KEY);
  } catch (e) { /* ignore */ }
}

// ========== 脏态 UI：哪些字段改了 / 顶部条幅 / 保存按钮强调 ==========
// 字段级对比规则
function fieldIsDirty(key, current, baseline) {
  if (!baseline) return false;
  const a = current[key];
  const b = baseline[key];
  if (key === 'webdav_bookmark_path') {
    return normalizeBookmarkPathSafe(a) !== normalizeBookmarkPathSafe(b);
  }
  if (key === 'sync_enabled') return !!a !== !!b;
  if (key === 'sync_interval') return (a || 30) !== (b || 30);
  if (key === 'sync_type') return (a || 'merge') !== (b || 'merge');
  return (a || '') !== (b || '');
}

// 刷新脏态 UI
function updateDirtyUI() {
  if (!savedBaseline) return;
  const current = collectFormValues();

  const fieldMap = {
    webdav_url: document.getElementById('webdav_url'),
    webdav_user: document.getElementById('webdav_user'),
    webdav_password: document.getElementById('webdav_password'),
    webdav_bookmark_path: document.getElementById('webdav_path'),
    sync_interval: intervalSelect,
    sync_type: syncTypeSelect
  };

  let anyDirty = false;
  for (const key of Object.keys(fieldMap)) {
    const el = fieldMap[key];
    if (!el) continue;
    const dirty = fieldIsDirty(key, current, savedBaseline);
    el.classList.toggle('dirty-field', dirty);
    if (dirty) anyDirty = true;
  }

  // syncEnabled 的高亮挂在父 row 上
  const syncRow = document.getElementById('syncEnabledRow');
  const syncDirty = fieldIsDirty('sync_enabled', current, savedBaseline);
  if (syncRow) syncRow.classList.toggle('dirty-field', syncDirty);
  if (syncDirty) anyDirty = true;

  // 保存按钮脉冲
  saveBtn.classList.toggle('dirty', anyDirty);
}

async function loadConfigForm() {
  const result = await chrome.storage.local.get([
    'webdav_url',
    'webdav_user',
    'webdav_password',
    'webdav_bookmark_path',
    'sync_enabled',
    'sync_interval',
    'sync_type',
    DRAFT_KEY
  ]);

  const saved = {
    webdav_url: result.webdav_url || '',
    webdav_user: result.webdav_user || '',
    webdav_password: result.webdav_password || '',
    webdav_bookmark_path: result.webdav_bookmark_path || '/minibookmark',
    sync_enabled: !!result.sync_enabled,
    sync_interval: result.sync_interval || 30,
    sync_type: result.sync_type || 'merge'
  };
  // 记录基线用于脏态对比
  savedBaseline = { ...saved };

  const draft = result[DRAFT_KEY];
  const hasDraft = draft && draftDiffersFromSaved(draft, saved);
  const source = hasDraft ? draft : saved;

  document.getElementById('webdav_url').value = source.webdav_url || '';
  document.getElementById('webdav_user').value = source.webdav_user || '';
  document.getElementById('webdav_password').value = source.webdav_password || '';
  document.getElementById('webdav_path').value = source.webdav_bookmark_path || '';
  syncEnabledCb.checked = !!source.sync_enabled;
  intervalSelect.value = String(source.sync_interval || 30);
  syncTypeSelect.value = source.sync_type || 'merge';

  // 根据同步启用状态展开/折叠同步选项
  if (syncEnabledCb.checked) {
    syncOptions.classList.remove('hide');
  } else {
    syncOptions.classList.add('hide');
  }

  if (hasDraft) {
    configStatus.innerText = '已恢复上次未保存的修改，点击「保存」生效，或点击 🗑 丢弃。';
    configStatus.className = 'status-bar ok';
  } else {
    configStatus.innerText = '';
    configStatus.className = 'status-bar';
  }

  // 根据当前填充值刷新脏态提示（草稿场景下会直接高亮）
  updateDirtyUI();
}

// ========== 配置页动作：统一保存 ==========
saveBtn.onclick = async () => {
  const url = document.getElementById('webdav_url').value.trim();
  const user = document.getElementById('webdav_user').value.trim();
  const password = document.getElementById('webdav_password').value;
  const rawPath = document.getElementById('webdav_path').value.trim();
  const enabled = syncEnabledCb.checked;
  const interval = parseInt(intervalSelect.value, 10);
  const syncType = syncTypeSelect.value || 'merge';

  if (!url || !user || !password) {
    configStatus.innerText = '请填写完整的 WebDAV 地址、用户名和密码';
    configStatus.className = 'status-bar err';
    return;
  }

  // 验证路径非空（至少指定一个文件夹）
  if (!rawPath || rawPath === '/') {
    configStatus.innerText = '请填写云端文件路径，至少指定一个文件夹，如 /minibookmark';
    configStatus.className = 'status-bar err';
    return;
  }

  // 验证 WebDAV URL 格式
  if (!/^https?:\/\/.+/.test(url)) {
    configStatus.innerText = 'WebDAV 地址必须以 http:// 或 https:// 开头';
    configStatus.className = 'status-bar err';
    return;
  }

  // 用 normalizeBookmarkPath 做安全校验（非法会抛错），但存储仍用清理过的原始值，
  // 保持"用户输入什么 → storage 里存什么"的直观性，每次使用时再由 normalize 追加文件名。
  try {
    normalizeBookmarkPath(rawPath);
  } catch (e) {
    configStatus.innerText = e.message;
    configStatus.className = 'status-bar err';
    return;
  }
  const path = rawPath.startsWith('/') ? rawPath : '/' + rawPath;

  // 保存配置（不重置 ever_connected，连接是否成功过是独立记录）
  await chrome.storage.local.set({
    webdav_url: url,
    webdav_user: user,
    webdav_password: password,
    webdav_bookmark_path: path,
    sync_enabled: enabled,
    sync_interval: interval,
    sync_type: syncType
  });

  // 动态申请 WebDAV 域名的 host 权限（先检查是否已有，避免重复弹窗）
  try {
    const origin = new URL(url).origin + '/*';
    const hasPermission = await new Promise((resolve) => {
      chrome.permissions.contains({ origins: [origin] }, (result) => resolve(result));
    });
    if (!hasPermission) {
      await new Promise((resolve, reject) => {
        chrome.permissions.request({ origins: [origin] }, (granted) => {
          if (granted) resolve(); else reject(new Error('用户拒绝了域名访问授权'));
        });
      });
    }
  } catch (permErr) {
    configStatus.innerText = '需要 WebDAV 域名访问权限才能同步，请点击"保存"重新尝试并允许授权';
    configStatus.className = 'status-bar err';
    return;
  }

  await chrome.runtime.sendMessage({ action: 'updateSyncInterval' });

  // 保存成功后清除草稿
  await clearDraft();

  // 基线更新为刚保存的值，脏态清零
  savedBaseline = {
    webdav_url: url,
    webdav_user: user,
    webdav_password: password,
    webdav_bookmark_path: path,
    sync_enabled: enabled,
    sync_interval: interval,
    sync_type: syncType
  };
  updateDirtyUI();

  configStatus.innerText = '已保存';
  configStatus.className = 'status-bar ok';

  setTimeout(showHome, 400);
};

clearConfigBtn.onclick = async () => {
  // 仅清空当前表单（草稿态），不动 storage 里的正式配置。
  // 用户必须点「保存」才真正落库；若直接返回，下次进配置页仍能看到之前的配置。
  document.getElementById('webdav_url').value = '';
  document.getElementById('webdav_user').value = '';
  document.getElementById('webdav_password').value = '';
  document.getElementById('webdav_path').value = '';
  syncEnabledCb.checked = false;
  intervalSelect.value = '30';
  syncTypeSelect.value = 'merge';
  syncOptions.classList.add('hide');

  // 同时清除未保存草稿，避免下次打开又被恢复
  await clearDraft();

  // 刷新脏态 UI：若基线里本来有值，现在被清空就会整排高亮提示需要点保存
  updateDirtyUI();

  configStatus.innerText = '已清空表单（点击「保存」后生效）';
  configStatus.className = 'status-bar ok';
};

// ========== 删除配置（强操作：需要确认，真正清空 storage，回到创建页） ==========
const deleteConfigBtn = document.getElementById('deleteConfigBtn');
if (deleteConfigBtn) {
  deleteConfigBtn.onclick = async () => {
    const ok = await openConfirm({
      title: '删除配置？',
      body: '此操作不可撤销。<span class="note-inline">本地书签不受影响</span>',
      okText: '删除',
      cancelText: '取消',
      danger: true,
      icon: '⚠'
    });
    if (!ok) return;

    await chrome.storage.local.remove([
      'webdav_url',
      'webdav_user',
      'webdav_password',
      'webdav_bookmark_path',
      'sync_enabled',
      'sync_interval',
      'sync_type',
      'ever_connected',
      'last_sync_at',
      'last_sync_count',
      DRAFT_KEY
    ]);

    // 通知 background 按新配置重建 alarm（无配置会自动关闭定时器）
    try { await chrome.runtime.sendMessage({ action: 'updateSyncInterval' }); } catch (e) { /* ignore */ }

    // 清表单、清草稿、清基线
    document.getElementById('webdav_url').value = '';
    document.getElementById('webdav_user').value = '';
    document.getElementById('webdav_password').value = '';
    document.getElementById('webdav_path').value = '';
    syncEnabledCb.checked = false;
    intervalSelect.value = '30';
    syncTypeSelect.value = 'merge';
    syncOptions.classList.add('hide');
    savedBaseline = null;
    if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null; }

    // 回到主页，renderHome 会因为无配置自动切到创建页
    showHome();
  };
}

// ========== 配置页「测试连接」按钮（复用 testConnectionConfig，需先申请权限） ==========
testConnectionBtn.onclick = async () => {
  const url = document.getElementById('webdav_url').value.trim();
  const user = document.getElementById('webdav_user').value.trim();
  const password = document.getElementById('webdav_password').value;
  const rawPath = document.getElementById('webdav_path').value.trim();

  if (!url || !user || !password) {
    configStatus.innerText = '请填写完整的 WebDAV 地址、用户名和密码';
    configStatus.className = 'status-bar err';
    return;
  }
  if (!rawPath || rawPath === '/') {
    configStatus.innerText = '请填写云端文件路径，至少指定一个文件夹，如 /minibookmark';
    configStatus.className = 'status-bar err';
    return;
  }
  if (!/^https?:\/\/.+/.test(url)) {
    configStatus.innerText = 'WebDAV 地址必须以 http:// 或 https:// 开头';
    configStatus.className = 'status-bar err';
    return;
  }

  // 归一化路径用于实际测试（normalize 内部已做安全校验，非法会抛错）
  let path;
  try {
    path = normalizeBookmarkPath(rawPath);
  } catch (e) {
    configStatus.innerText = e.message;
    configStatus.className = 'status-bar err';
    return;
  }

  // 先检查是否已有域名权限
  let hasPermission = false;
  try {
    const origin = new URL(url).origin + '/*';
    hasPermission = await new Promise((resolve) => {
      chrome.permissions.contains({ origins: [origin] }, (result) => resolve(result));
    });
  } catch (e) {}
  if (!hasPermission) {
    configStatus.innerText = '正在请求权限...';
    configStatus.className = 'status-bar';
    try {
      hasPermission = await new Promise((resolve, reject) => {
        chrome.permissions.request({
          origins: [new URL(url).origin + '/*']
        }, (granted) => {
          if (granted) resolve(true); else reject(new Error('用户拒绝了授权'));
        });
      });
    } catch (e) {
      configStatus.innerText = '需要授权才能测试连接，请点击「允许」';
      configStatus.className = 'status-bar err';
      return;
    }
  }

  configStatus.innerText = '正在测试连接...';
  // 走 background 测试连接，避免 popup 弹 HTTP 认证框
  // 传原始路径，让 background 自己做 normalize（避免双重 normalize）
  const result = await chrome.runtime.sendMessage({
    action: 'testConnection',
    webdavUrl: url,
    webdavUser: user,
    webdavPassword: password,
    webdavPath: rawPath
  });
  if (result && result.success) {
    configStatus.innerText = result.message;
    configStatus.className = 'status-bar ok';
    await chrome.storage.local.set({ ever_connected: true });
  } else {
    configStatus.innerText = (result && result.message) ? result.message : '连接失败（SW 未就绪，请重试）';
    configStatus.className = 'status-bar err';
  }
};

// 仅用于 UI 比较（脏态、草稿 diff）：容忍非法输入，不抛错。
// 因为用户正在输入框打字时可能处于中间非法状态（如只打了一个 #），
// 这些场景只是"判断两个值是否相等"，不需要真实归一化。
function normalizeBookmarkPathSafe(raw) {
  try { return normalizeBookmarkPath(raw); }
  catch (_) { return '__INVALID__:' + (raw || ''); }
}

// ========== 路径归一化 + 安全校验（与 background.js 保持一致，修改时两边同步） ==========
function normalizeBookmarkPath(raw) {
  let p = (raw || '').trim().replace(/\\/g, '/');
  if (!p || p === '/') return '';
  if (!p.startsWith('/')) p = '/' + p;

  // 安全校验：字符白名单
  if (!/^\/[a-zA-Z0-9_.\-/]*$/.test(p)) {
    throw new Error('路径只能包含字母、数字、-、_、/、. 且必须以 / 开头');
  }
  // 安全校验：分段禁止 . / ..
  const segments = p.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new Error('路径不能包含 . 或 .. 段');
    }
  }

  if (p.endsWith('/')) return p + 'bookmarks.json';
  const lastSeg = segments[segments.length - 1];
  if (lastSeg.includes('.')) return p;
  return p + '/bookmarks.json';
}

// 把 base URL 和 path 安全拼接
function joinWebDAVUrl(baseUrl, path) {
  const cleanBase = (baseUrl || '').replace(/\/+$/, '');
  const rawSegments = (path || '').replace(/^\/+|\/+$/g, '').split('/');
  const encoded = rawSegments
    .filter(s => s.length > 0)
    .map(s => encodeURIComponent(s))
    .join('/');
  return cleanBase + '/' + encoded;
}

// 测试 WebDAV 连接（可复用，不申请权限，适合主页状态检测）
// ===== 手动同步：统一走 background，确保与自动同步共享同一把互斥锁 =====
// 操作记录文案映射：按钮文案 / storage 里 last_sync_count 回填时用的 action 名
const SYNC_ACTION_LABELS = {
  upload:   { running: '正在上传...',   successTag: '上传成功', failPrefix: '上传失败：' },
  download: { running: '正在下载...',   successTag: '下载成功', failPrefix: '下载失败：' },
  merge:    { running: '正在合并两端...', successTag: '合并成功', failPrefix: '合并失败：' }
};

async function runSyncAction(action) {
  const label = SYNC_ACTION_LABELS[action];
  setStatus(label.running);
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ action });
  } catch (e) {
    // popup 在消息回来前被关闭、SW 异常等场景
    setStatus(label.failPrefix + (e.message || String(e)), 'err');
    return;
  }
  if (resp && resp.success) {
    setStatus(resp.message || label.successTag, 'ok');
  } else {
    setStatus(label.failPrefix + ((resp && resp.message) || '未知错误'), 'err');
  }
  const { last_sync_at, last_sync_count } = await chrome.storage.local.get(['last_sync_at', 'last_sync_count']);
  renderLastSync(last_sync_at);
  renderProgressLine(last_sync_count, label.successTag);
}

uploadBtn.onclick   = () => runSyncAction('upload');
downloadBtn.onclick = () => runSyncAction('download');
syncBtn.onclick     = () => runSyncAction('merge');

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
};

// ========== 监听 storage 变化 ==========
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.last_sync_at) {
    renderLastSync(changes.last_sync_at.newValue);
  }
  if (changes.last_sync_count) {
    renderProgressLine(changes.last_sync_count.newValue, '自动同步');
  }
  if (changes.ever_connected) {
    updateHomeStatus();
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

// "上次同步"仅在 popup 打开时计算一次，不做实时读秒刷新
// 下次打开 popup 自然会重新计算相对时间

// 入口
bindDraftAutosave();
bindPasswordToggle();
bindFieldHints();
loadAll();
