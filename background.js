// background.js

// ========== 常量定义 ==========
const SYNC_ALARM = 'webdav_bookmark_auto_sync';

const ROOT_ID = 'root';
const HOME_FOLDER_ID = '__home_folder__';

const FOLDER_TITLES = {
  bookmarkBar: ['书签栏', 'bookmarks bar', '收藏夹栏'],
  otherBookmarks: ['其他书签', 'other bookmarks', '其他收藏夹'],
  mobileBookmarks: ['移动设备书签', 'mobile bookmarks'],
  berryHome: ['berry主页', 'berry home']
};

const BERRY_HOME_TITLE = 'Berry主页';

// ========== 同步互斥锁 ==========
// MV3 Service Worker 可能被随时回收，因此用 storage 里的时间戳做分布式锁。
// 内存变量只作为同一次 SW 生命周期内的快路径，真正判定以 storage 为准。
const SYNC_LOCK_KEY = 'sync_lock_at';
const SYNC_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟后强制视为过期
let _memLock = false;

async function acquireSyncLock(reason) {
  if (_memLock) return false;
  const r = await chrome.storage.local.get([SYNC_LOCK_KEY]);
  const lockedAt = r[SYNC_LOCK_KEY] || 0;
  if (lockedAt && Date.now() - lockedAt < SYNC_LOCK_TIMEOUT_MS) {
    return false;
  }
  _memLock = true;
  await chrome.storage.local.set({ [SYNC_LOCK_KEY]: Date.now() });
  return true;
}

async function releaseSyncLock() {
  _memLock = false;
  try { await chrome.storage.local.remove(SYNC_LOCK_KEY); } catch (_) {}
}

// 本地快照备份 key：importBookmarksFromData 清空本地前会先写一份，防止
// Service Worker 中途被回收导致本地书签丢失。
const LOCAL_BACKUP_KEY = 'local_backup_before_import';

// 读取自动同步设置
async function getSyncSettings() {
  const r = await chrome.storage.local.get(['sync_enabled', 'sync_interval', 'sync_type']);
  return {
    enabled: !!r.sync_enabled,
    interval: Math.max(5, Math.min(1440, parseInt(r.sync_interval, 10) || 30)),
    type: r.sync_type || 'merge'
  };
}

// 根据设置重新建立 alarm
async function rescheduleAlarm() {
  await chrome.alarms.clear(SYNC_ALARM);
  const { enabled, interval } = await getSyncSettings();
  if (!enabled) {
    return;
  }
  chrome.alarms.create(SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: interval
  });
}

// 自动同步：根据用户配置的 sync_type 决定执行哪种同步策略。
//   - 'upload'   → 上传书签（本地覆盖云端）
//   - 'download' → 下载书签（云端覆盖本地）
//   - 'merge'    → 合并书签（两端合并，默认）
async function runAutoSync(reason) {
  if (!await acquireSyncLock(reason)) return;
  try {
    // 检查 host 权限
    const cfg = await getWebDAVConfig();
    if (!await hasHostPermission(cfg.url)) {
      return;
    }
    const { type } = await getSyncSettings();
    let result;
    if (type === 'upload') {
      result = await uploadToCloud();
    } else if (type === 'download') {
      result = await downloadFromCloud();
    } else {
      result = await mergeSync();
    }
  } catch (e) {
    console.error('[sync] 自动同步异常:', e);
  } finally {
    await releaseSyncLock();
  }
}

// 插件安装/更新
chrome.runtime.onInstalled.addListener(async (details) => {
  await rescheduleAlarm();
  // 仅浏览器更新或插件更新时才自动同步，首次安装（install）不立即同步，
  // 避免用户还没配置就被云端空数据覆盖本地书签。
  if (details.reason === 'update') {
    const { enabled } = await getSyncSettings();
    if (enabled) runAutoSync('onInstalled-update');
  }
});

// 浏览器启动
chrome.runtime.onStartup.addListener(async () => {

  // 检查是否有未完成导入留下的快照备份 —— 如果有，说明上次清空后 SW 被杀了
  try {
    const r = await chrome.storage.local.get([LOCAL_BACKUP_KEY]);
    const backup = r[LOCAL_BACKUP_KEY];
    if (backup && backup.data && Array.isArray(backup.data.bookmarks)) {
      // 检查当前本地书签是否为空（被清空后没恢复）
      const tree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
      const root = tree && tree[0];
      let totalBookmarks = 0;
      const rootChildren = (root && root.children) || [];
      for (const topNode of rootChildren) {
        if (topNode.children) totalBookmarks += topNode.children.length;
      }
      if (totalBookmarks === 0 && backup.data.bookmarks.length > 0) {
        console.warn(`[sync] 检测到本地书签为空但有 ${backup.data.bookmarks.length} 条快照备份，正在恢复...`);
        await importBookmarksFromData(backup.data);
      } else {
        // 本地不为空，说明上次导入成功了，只是快照没来得及清理
        await chrome.storage.local.remove(LOCAL_BACKUP_KEY);
      }
    }
  } catch (e) {
    console.error('[sync] 启动时检查/恢复快照失败:', e);
  }

  await rescheduleAlarm();
  const { enabled } = await getSyncSettings();
  if (enabled) runAutoSync('onStartup');
});

// 定时触发
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) runAutoSync('alarm');
});

// 从 storage 获取 WebDAV 配置
async function getWebDAVConfig() {
  const result = await chrome.storage.local.get([
    'webdav_url',
    'webdav_user',
    'webdav_password',   // 这里存储应用密码
    'webdav_bookmark_path'
  ]);
  return {
    url: result.webdav_url || '',
    user: result.webdav_user || '',
    password: result.webdav_password || '',
    path: result.webdav_bookmark_path || '/bookmarks.json'
  };
}

// 生成 Basic Auth 头
// 注意：btoa 不支持非 Latin1 字符，用户名/密码含中文/emoji 会抛异常。
// 这里先用 TextEncoder 转成 UTF-8 字节，再逐字节塞进 btoa。
function getAuthHeader(user, password) {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

// 检查是否拥有对应域名的 host 权限（动态权限申请后才有）
function hasHostPermission(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(false); return; }
    try {
      const origin = new URL(url).origin + '/*';
      chrome.permissions.contains({ origins: [origin] }, resolve);
    } catch (e) { resolve(false); }
  });
}

// 把 base URL 和 path 安全拼接：保证中间只有一个 "/"
// 兼容 path 未以 "/" 开头、base 尾部有多个 "/"、path 含空格/中文/# 等情况
function joinWebDAVUrl(baseUrl, path) {
  const cleanBase = (baseUrl || '').replace(/\/+$/, '');
  const rawSegments = (path || '').replace(/^\/+|\/+$/g, '').split('/');
  // 对每一段做 encodeURIComponent，避免空格、中文、#、? 等字符导致 400/404
  const encoded = rawSegments
    .filter(s => s.length > 0)
    .map(s => encodeURIComponent(s))
    .join('/');
  return cleanBase + '/' + encoded;
}

// 上传书签数据到 WebDAV
async function uploadBookmarks(data) {
  const config = await getWebDAVConfig();
  if (!config.url) {
    throw new Error('WebDAV 地址未配置');
  }
  if (!config.user || !config.password) {
    throw new Error('WebDAV 未配置');
  }
  const fullUrl = joinWebDAVUrl(config.url, config.path);
  const response = await fetch(fullUrl, {
    method: 'PUT',
    headers: {
      'Authorization': getAuthHeader(config.user, config.password),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data, null, 2)
  });
  if (!response.ok) {
    throw new Error(`上传失败: ${response.status} ${response.statusText}`);
  }
  return true;
}

// 从 WebDAV 下载书签数据
async function downloadBookmarks() {
  const config = await getWebDAVConfig();
  if (!config.url) {
    throw new Error('WebDAV 地址未配置');
  }
  if (!config.user || !config.password) {
    throw new Error('WebDAV 未配置');
  }
  const fullUrl = joinWebDAVUrl(config.url, config.path);
  const response = await fetch(fullUrl, {
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(config.user, config.password)
    }
  });
  if (response.status === 404) {
    // 云端还没有书签文件，返回空数据
    return null;
  }
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

// 获取或生成设备 ID（用于标识数据来源）
async function getDeviceId() {
  const result = await chrome.storage.local.get(['berry_device_id']);
  if (result.berry_device_id) return result.berry_device_id;
  const newId = 'berry_' + Math.random().toString(36).slice(2, 10);
  await chrome.storage.local.set({ berry_device_id: newId });
  return newId;
}

// 获取整个书签树并转换为扁平列表格式（与 berry 书签 JSON 格式保持一致）
//
// 映射规则（方案 A：给根级节点加 source 标记，实现双向无损同步）：
//   Chrome 书签栏                                → parentId=ROOT_ID, source='bar'
//   Chrome 其他收藏夹（排除 "Berry主页" 文件夹本身）  → parentId=ROOT_ID, source='other'
//   Chrome 其他收藏夹 → Berry主页 下的内容          → parentId=HOME_FOLDER_ID（剥掉"Berry主页"这层）
//   Chrome 移动设备书签                           → 跳过
async function serializeBookmarks() {
  const deviceId = await getDeviceId();
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      const bookmarks = [];

      // 递归写入一个节点及其所有子孙。
      // rootParentId / rootSource 仅用于"该节点作为根级节点"时的 parentId 和 source；
      // 子孙节点的 parentId 永远跟着 Chrome 的节点 id 走，source 不再下发。
      function traverseNode(node, rootParentId, rootSource) {
        // 跳过空文件夹（Berry 端可能不处理空文件夹）
        if (node.children && node.children.length === 0) return;

        const isFolder = !node.url;
        const entry = {
          id: node.id,
          title: node.title || '',
          url: node.url || '',
          isFolder: isFolder,
          parentId: rootParentId,
          addedAt: node.dateAdded || Date.now(),
          color: '',
          favicon: '',
          customIcon: ''
        };
        // 只有根级节点写 source 字段（'bar' 或 'other'），供下载时回填使用
        if (rootSource) {
          entry.source = rootSource;
        }
        bookmarks.push(entry);
        if (node.children) {
          for (const child of node.children) {
            // 子孙节点的 parentId 跟随 Chrome 节点 id，不再携带 source
            traverseNode(child, node.id, null);
          }
        }
      }

      const root = tree[0];
      const rootChildren = (root && root.children) || [];

      let hasHomeFolderContent = false;

      for (let i = 0; i < rootChildren.length; i++) {
        const topNode = rootChildren[i];
        if (!topNode.children || topNode.children.length === 0) continue;

        const title = (topNode.title || '').toLowerCase();

        // 跳过"移动设备书签"
        if (FOLDER_TITLES.mobileBookmarks.some(t => t.toLowerCase() === title)) continue;

        // 书签栏：所有子项 → parentId=ROOT_ID, source='bar'
        if (FOLDER_TITLES.bookmarkBar.some(t => t.toLowerCase() === title)) {
          for (const child of topNode.children) {
            traverseNode(child, ROOT_ID, 'bar');
          }
          continue;
        }

        // 其他收藏夹：区分 "Berry主页" 文件夹和其他普通子项
        if (FOLDER_TITLES.otherBookmarks.some(t => t.toLowerCase() === title)) {
          for (const child of topNode.children) {
            const childTitle = (child.title || '').toLowerCase();
            const isBerryHome = !child.url && FOLDER_TITLES.berryHome.some(t => t.toLowerCase() === childTitle);

            if (isBerryHome) {
              // Berry主页 文件夹本身不保留，子内容挂到 HOME_FOLDER_ID
              if (child.children) {
                for (const grandChild of child.children) {
                  traverseNode(grandChild, HOME_FOLDER_ID, null);
                  hasHomeFolderContent = true;
                }
              }
            } else {
              // 其他收藏夹的普通子项 → parentId=ROOT_ID, source='other'
              traverseNode(child, ROOT_ID, 'other');
            }
          }
          continue;
        }

        // 兜底：不认识的根级文件夹，按"其他收藏夹"处理
        for (const child of topNode.children) {
          traverseNode(child, ROOT_ID, 'other');
        }
      }


      // 如果 __home_folder__ 下有内容，创建该节点并插入到数组最前面
      // Berry 要求 __home_folder__ 在其子节点之前出现
      if (hasHomeFolderContent) {
        bookmarks.unshift({
          id: HOME_FOLDER_ID,
          title: '主页文件夹',
          url: '',
          isFolder: true,
          parentId: ROOT_ID,
          addedAt: Date.now(),
          color: '',
          favicon: '',
          customIcon: ''
        });
      }

      resolve({
        version: 1,
        lastModified: Date.now(),
        deviceId: deviceId,
        bookmarks: bookmarks
      });
    });
  });
}

// 递归删除所有书签（清空书签栏和其他书签下的所有子节点）
async function clearAllBookmarks() {
  const tree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
  const root = tree && tree[0];
  const children = (root && root.children) || [];

  for (const topNode of children) {
    // 跳过没有子节点的根文件夹
    if (!topNode.children || !topNode.children.length) continue;
    for (const node of topNode.children) {
      await new Promise(r => chrome.bookmarks.removeTree(node.id, r));
    }
  }
}

// 整体导入（先清空，再从扁平列表重建书签树）
//
// 下载映射规则（方案 A：根级节点的 source 字段决定回填目标）：
//   parentId === ROOT_ID 且 source === 'bar'    → Chrome 书签栏
//   parentId === ROOT_ID 且 source === 'other'  → Chrome 其他收藏夹
//   parentId === ROOT_ID 且无 source（老数据兜底） → Chrome 其他收藏夹
//   parentId === HOME_FOLDER_ID              → Chrome 其他收藏夹 → Berry主页 文件夹（自动创建）
async function importBookmarksFromData(cloudData) {
  // cloudData 格式：{ version, lastModified, deviceId, bookmarks: [...] }
  if (!cloudData || !Array.isArray(cloudData.bookmarks)) {
    throw new Error('云端数据格式不兼容，请重新上传一次书签后再同步');
  }
  const bookmarkList = cloudData.bookmarks;

  // 动态获取 Chrome 书签栏和其他书签的真实 ID
  const tree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
  const root = tree && tree[0];
  const rootChildren = (root && root.children) || [];
  let bookmarkBarId = '1';   // 默认值
  let otherBookmarksId = '2'; // 默认值
  for (const topNode of rootChildren) {
    const title = (topNode.title || '').toLowerCase();
    if (FOLDER_TITLES.bookmarkBar.some(t => t.toLowerCase() === title)) {
      bookmarkBarId = topNode.id;
    } else if (FOLDER_TITLES.otherBookmarks.some(t => t.toLowerCase() === title)) {
      otherBookmarksId = topNode.id;
    }
  }

  // ⚠️ 关键：清空前先做一份本地快照，防止 SW 中途被回收导致本地书签永久丢失。
  // 下次启动时可从 storage.local 里的 LOCAL_BACKUP_KEY 恢复。
  try {
    const backup = await serializeBookmarks();
    await chrome.storage.local.set({
      [LOCAL_BACKUP_KEY]: {
        savedAt: Date.now(),
        data: backup
      }
    });
  } catch (e) {
    console.warn('[sync] 本地快照备份失败（继续执行导入）:', e && e.message);
  }

  await clearAllBookmarks();

  // 分流 parentId === ROOT_ID 的根级节点（排除 HOME_FOLDER_ID 本身）
  const rootLevel = bookmarkList.filter(n => n.parentId === ROOT_ID && n.id !== HOME_FOLDER_ID);
  const barChildren = rootLevel.filter(n => n.source === 'bar');
  const otherChildren = rootLevel.filter(n => n.source === 'other');
  const unlabeledChildren = rootLevel.filter(n => n.source !== 'bar' && n.source !== 'other');
  // __home_folder__ 下的内容
  const homeChildren = bookmarkList.filter(n => n.parentId === HOME_FOLDER_ID);


  // 1) source='bar' → 书签栏
  for (const child of barChildren) {
    await buildNode(child, bookmarkBarId, bookmarkList);
  }

  // 2) source='other' → 其他收藏夹
  for (const child of otherChildren) {
    await buildNode(child, otherBookmarksId, bookmarkList);
  }

  // 3) 无 source 标记（来自老版本数据）→ 兜底进其他收藏夹
  //    兼容旧逻辑：若节点本身是"其他书签/其他收藏夹"同名文件夹，剥一层
  for (const child of unlabeledChildren) {
    const title = (child.title || '').toLowerCase();
    if (child.isFolder && FOLDER_TITLES.otherBookmarks.some(t => t.toLowerCase() === title)) {
      const subChildren = bookmarkList.filter(n => n.parentId === child.id);
      for (const sub of subChildren) {
        await buildNode(sub, otherBookmarksId, bookmarkList);
      }
    } else {
      await buildNode(child, otherBookmarksId, bookmarkList);
    }
  }

  // 4) __home_folder__ 的内容 → 在其他收藏夹下创建 "Berry主页" 文件夹并放入
  if (homeChildren.length > 0) {
    const berryHomeFolder = await new Promise((resolve, reject) => {
      chrome.bookmarks.create(
        { parentId: otherBookmarksId, title: BERRY_HOME_TITLE },
        (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        }
      );
    });

    for (const child of homeChildren) {
      await buildNode(child, berryHomeFolder.id, bookmarkList);
    }
  }

  // 导入成功，清除快照
  try { await chrome.storage.local.remove(LOCAL_BACKUP_KEY); } catch (_) {}
}

// 把移动端可能写成 "www.baidu.com" / "baidu.com/path" / "//baidu.com" 的 URL
// 规范化为 Chrome 能接受的带 scheme 形式。无法识别时返回 null，交由上层跳过。
function normalizeUrl(rawUrl) {
  if (!rawUrl) return null;
  let u = String(rawUrl).trim();
  if (!u) return null;

  // 已经是常见合法 scheme 的，直接用
  // chrome.bookmarks.create 支持 http(s)、ftp、file、chrome、about、javascript、data 等
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(u)) {
    return u;
  }
  // 协议相对 URL: //example.com/xxx
  if (u.startsWith('//')) {
    return 'https:' + u;
  }
  // 裸域名 / 带路径：www.baidu.com、baidu.com/path、example.com:8080
  // 粗略判断：至少含一个 "." 或 ":"
  if (/[.:]/.test(u)) {
    return 'https://' + u;
  }
  return null;
}

// 递归创建书签节点（失败时只跳过这一条，不中断整棵树）
async function buildNode(node, chromeParentId, bookmarkList) {
  const createProps = {
    parentId: chromeParentId,
    title: node.title || ''
  };
  if (!node.isFolder && node.url) {
    const fixedUrl = normalizeUrl(node.url);
    if (!fixedUrl) {
      console.warn(`[sync] 跳过非法 URL 书签: title="${node.title}" url="${node.url}"`);
      return; // 这条建不了，子节点也没意义，直接返回
    }
    if (fixedUrl !== node.url) {
    }
    createProps.url = fixedUrl;
  }

  let created;
  try {
    created = await new Promise((resolve, reject) => {
      chrome.bookmarks.create(createProps, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  } catch (err) {
    // 最终兜底：单条失败就跳过，不要让整棵树挂掉
    console.error(
      `[sync] create 失败，已跳过: ${err.message}, parentId="${chromeParentId}" ` +
      `title="${node.title}" url="${createProps.url || ''}"`
    );
    return;
  }

  const children = bookmarkList.filter(n => n.parentId === node.id);
  for (const child of children) {
    await buildNode(child, created.id, bookmarkList);
  }
}

async function uploadToCloud() {
  try {
    const bookmarksData = await serializeBookmarks();
    await uploadBookmarks(bookmarksData);
    await chrome.storage.local.set({ last_sync_at: Date.now() });
    return { success: true, message: "从本地上传成功" };
  } catch (e) {
    console.error('[sync] 上传失败:', e);
    return { success: false, message: '上传失败：' + (e && e.message ? e.message : String(e)) };
  }
}

async function downloadFromCloud() {
  try {
    const cloudData = await downloadBookmarks();
    if (!cloudData) {
      return { success: false, message: "云端没有书签文件" };
    }
    await importBookmarksFromData(cloudData);
    await chrome.storage.local.set({ last_sync_at: Date.now() });
    return { success: true, message: "从云端下载成功" };
  } catch (e) {
    console.error('[sync] 下载失败:', e);
    return { success: false, message: '下载失败：' + (e && e.message ? e.message : String(e)) };
  }
}

// ========== 两端合并 ==========
// 合并策略（v2，基于"路径身份"）：
// 1) 本地先 serialize → localData（含 bookmarks 扁平数组）
// 2) 远端 download → cloudData（可能为 null，表示云端还没有文件）
// 3) 对两边扁平列表递归计算路径身份（把每个节点的父链路径算出来做 key）
//    - 因为 Chrome 节点 id 是本地递增的，两端必然不同，不能作为身份
//    - 路径身份规则：
//        根定位：`ROOT:bar` / `ROOT:other` / `ROOT:home`（__home_folder__ 下的）
//        folder：父路径 + `/F:<title>`
//        leaf  ：父路径 + `/L:<normalizeUrl(url)>`
// 4) 合并后的扁平列表 → importBookmarksFromData 重建本地 + uploadBookmarks 写回云端
// 5) 时间冲突取 max(addedAt)

// 给扁平列表里的每个节点算一个稳定的路径身份，返回 Map<originalId, pathKey>
// 同时对"根落点"的不同也做归一化（source=bar/other、__home_folder__）
function computePathKeys(list) {
  // 建 id → node 索引
  const byId = new Map();
  for (const n of list) byId.set(n.id, n);

  const memo = new Map();
  function pathOf(node) {
    if (memo.has(node.id)) return memo.get(node.id);
    let parentPath;
    if (node.id === HOME_FOLDER_ID) {
      // __home_folder__ 自身归一化为 ROOT:home 这个"位置"
      memo.set(node.id, 'ROOT:home');
      return 'ROOT:home';
    }
    const pid = node.parentId;
    if (pid === ROOT_ID) {
      // 根级：按 source 区分书签栏/其他
      if (node.source === 'bar') parentPath = 'ROOT:bar';
      else parentPath = 'ROOT:other'; // 没标或标为 other 都按其他走
    } else if (pid === HOME_FOLDER_ID) {
      parentPath = 'ROOT:home';
    } else {
      const parent = byId.get(pid);
      if (!parent) {
        // 孤儿：找不到父，当成 ROOT:other 兜底
        parentPath = 'ROOT:other';
      } else {
        parentPath = pathOf(parent);
      }
    }
    const seg = node.isFolder
      ? `F:${(node.title || '').trim()}`
      : `L:${normalizeUrl(node.url) || node.url || ''}`;
    const key = parentPath + '/' + seg;
    memo.set(node.id, key);
    return key;
  }
  for (const n of list) pathOf(n);
  return memo;
}

// 合并两端扁平列表。策略：按"路径身份"去重，两端在同一路径的节点视为同一条书签。
// 时间取 max(addedAt)，title/url 允许后来者更新。
function mergeBookmarkLists(localList, cloudList) {
  const localKeys = computePathKeys(localList || []);
  const cloudKeys = computePathKeys(cloudList || []);

  // Map<pathKey, mergedNode>
  const map = new Map();
  // 记录每侧的 id → 保留下来的节点 id，用于回填子节点 parentId
  const idRemap = new Map(); // key: "L:<origId>" / "C:<origId>" → keptId

  function feed(list, keysMap, tag) {
    if (!Array.isArray(list)) return;
    for (const n of list) {
      const key = keysMap.get(n.id);
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        // 深拷贝第一次出现的节点
        map.set(key, { ...n });
        idRemap.set(`${tag}:${n.id}`, n.id);
      } else {
        idRemap.set(`${tag}:${n.id}`, existing.id);
        if ((n.addedAt || 0) > (existing.addedAt || 0)) {
          existing.addedAt = n.addedAt;
          if (n.title) existing.title = n.title;
          if (!existing.isFolder && n.url) existing.url = n.url;
        }
      }
    }
  }

  feed(localList, localKeys, 'L');
  feed(cloudList, cloudKeys, 'C');

  // 修正 parentId：对合并后的每个节点，若 parentId 指向的是两侧 id，就映射到保留 id
  const merged = [];
  for (const node of map.values()) {
    const copy = { ...node };
    const parent = copy.parentId;
    if (parent && parent !== ROOT_ID && parent !== HOME_FOLDER_ID) {
      const k1 = `L:${parent}`;
      const k2 = `C:${parent}`;
      if (idRemap.has(k1)) copy.parentId = idRemap.get(k1);
      else if (idRemap.has(k2)) copy.parentId = idRemap.get(k2);
    }
    merged.push(copy);
  }

  // 保证 __home_folder__ 存在于列表最前面（如果有内容挂在它下面）
  const hasHomeChildren = merged.some(n => n.parentId === HOME_FOLDER_ID);
  const hasHomeFolder = merged.some(n => n.id === HOME_FOLDER_ID);
  if (hasHomeChildren && !hasHomeFolder) {
    merged.unshift({
      id: HOME_FOLDER_ID,
      title: '主页文件夹',
      url: '',
      isFolder: true,
      parentId: ROOT_ID,
      addedAt: Date.now(),
      color: '',
      favicon: '',
      customIcon: ''
    });
  }
  return merged;
}

async function mergeSync() {
  try {
    const localData = await serializeBookmarks();

    let cloudData = null;
    try {
      cloudData = await downloadBookmarks();
    } catch (e) {
      console.warn('[sync] 下载云端失败，按仅上传处理:', e.message);
    }
    const cloudList = (cloudData && Array.isArray(cloudData.bookmarks)) ? cloudData.bookmarks : [];

    const mergedList = mergeBookmarkLists(localData.bookmarks, cloudList);

    // 给合并后的节点重新分配唯一 id（保留 __home_folder__ 这种虚拟 id 不动）
    // 这一步非常关键：否则两端 Chrome 数字 id 可能碰撞，重建时子节点会挂错位置。
    const renumbered = renumberBookmarks(mergedList);

    const deviceId = await getDeviceId();
    const mergedData = {
      version: 1,
      lastModified: Date.now(),
      deviceId: deviceId,
      bookmarks: renumbered
    };

    // 重建本地
    await importBookmarksFromData(mergedData);
    // 回写云端
    await uploadBookmarks(mergedData);

    await chrome.storage.local.set({ last_sync_at: Date.now() });
    return { success: true, message: '两端合并成功' };
  } catch (e) {
    console.error('[sync] 合并失败:', e);
    return { success: false, message: '合并失败：' + (e && e.message ? e.message : String(e)) };
  }
}

// 给扁平列表重新分配唯一 id（保留 ROOT_ID / HOME_FOLDER_ID 这种特殊 id）
// 返回的新数组：节点 id 为 m1/m2/...，parentId 也会跟着重映射
function renumberBookmarks(list) {
  const idMap = new Map(); // 旧 id → 新 id
  idMap.set(ROOT_ID, ROOT_ID);
  idMap.set(HOME_FOLDER_ID, HOME_FOLDER_ID);
  let counter = 0;
  for (const n of list) {
    if (!idMap.has(n.id)) {
      idMap.set(n.id, 'm' + (++counter));
    }
  }
  return list.map(n => {
    const copy = { ...n };
    copy.id = idMap.get(n.id) || n.id;
    if (n.parentId && idMap.has(n.parentId)) {
      copy.parentId = idMap.get(n.parentId);
    }
    return copy;
  });
}

// ========== 消息处理 ==========
// 通用消息处理函数：带锁的异步操作包装器
async function handleMessageWithLock(actionName, handler) {
  if (!await acquireSyncLock(`manual-${actionName}`)) {
    return { success: false, message: '有同步正在进行，请稍后再试' };
  }
  try {
    return await handler();
  } catch (e) {
    return { success: false, message: e.message || '操作异常' };
  } finally {
    await releaseSyncLock();
  }
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  // 支持 sync action 的消息处理
  const syncActions = {
    'upload': () => handleMessageWithLock('upload', uploadToCloud),
    'download': () => handleMessageWithLock('download', downloadFromCloud),
    'merge': () => handleMessageWithLock('merge', mergeSync)
  };

  if (syncActions[request.action]) {
    // 同步操作前检查 host 权限
    const cfg = await getWebDAVConfig();
    if (!await hasHostPermission(cfg.url)) {
      sendResponse({ success: false, message: '缺少域名访问权限，请重新保存配置以授权' });
      return true;
    }
    syncActions[request.action]().then(sendResponse);
    return true;
  }

  // 配置相关消息
  if (request.action === 'updateSyncInterval') {
    rescheduleAlarm().then(() => sendResponse({ success: true }));
    return true;
  }

  // 测试连接
  if (request.action === 'testConnection') {
    testConnection(request).then(sendResponse);
    return true;
  }
});

// ========== 测试 WebDAV 连接 ==========
async function testConnection(request) {
  const { webdavUrl, webdavUser, webdavPassword, webdavPath } = request;
  const fullUrl = joinWebDAVUrl(webdavUrl, webdavPath);


  try {
    // 先用 HEAD 请求测试连接（更轻量）
    const response = await fetch(fullUrl, {
      method: 'HEAD',
      headers: {
        'Authorization': getAuthHeader(webdavUser, webdavPassword)
      }
    });

    // 404 说明服务器可访问，只是文件不存在（这是正常的）
    if (response.ok || response.status === 404) {
      return { success: true, message: response.status === 404 ? '连接成功，文件尚未创建' : '连接成功' };
    }

    // 其他错误状态
    throw new Error(`连接失败: ${response.status} ${response.statusText}`);
  } catch (e) {
    console.error('[test] 连接测试失败:', e);
    return { success: false, message: e.message || '连接测试失败' };
  }
}
