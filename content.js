// 内容脚本：发现卡片 → IntersectionObserver 提前 200px 触发 → 走后台查标注 → 命中按 mode 隐藏。
// 卡片 DOM 选择器集中在一处（CARD_SELECTORS），首页改版失效时是安全一侧（全部可见）。
(() => {
  'use strict';

  const { extractBvid, shouldFilter, matchesKeyword, firstMatchedKeyword, parseKeywords, DEFAULT_KNOWN_TYPES, DEFAULT_SELECTED_TYPES, DEFAULT_MODE, migrateSettings, STORAGE_DEFAULTS } = globalThis.Qingliu;

  const CARD_SELECTORS = [
    '.bili-video-card',
    '.video-page-card-small',
    '.rank-list-item',
  ];
  const LINK_SELECTOR = 'a[href*="/video/BV"]';
  const ROOT_MARGIN = '200px';
  const FADE_MS = 150;

  let enabled = true;
  let mode = DEFAULT_MODE; // 'placeholder'（占位，排版不变）| 'reflow'（补位，后面顶上来）
  let selectedTypes = new Set(DEFAULT_SELECTED_TYPES);
  let whitelist = new Set();
  let knownTypes = new Set(DEFAULT_KNOWN_TYPES);
  let keywords = [];
  let filteredCount = 0;

  const cards = new Map(); // cardEl -> rec
  const hiddenStack = []; // 补位模式的撤销栈，按 LIFO 弹
  let undoEl = null;
  let observer = null;
  let discoverTimer = null;

  function isVideoPage() {
    return /^https:\/\/www\.bilibili\.com\/video\/BV/i.test(location.href);
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '.qingliu-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#f1f2f3;border-radius:6px;color:#9499a0;font-size:13px;box-sizing:border-box;}',
      '.qingliu-placeholder-btn{cursor:pointer;border:1px solid #c9ccd0;background:#fff;border-radius:4px;font-size:12px;color:#61666d;padding:3px 12px;}',
      '.qingliu-placeholder-btn:hover{color:#00aeec;border-color:#00aeec;}',
      '.qingliu-undo{position:fixed;left:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:12px;padding:9px 14px;background:#fff;border:1px solid #e3e5e7;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.08);font-size:13px;color:#61666d;}',
      '.qingliu-undo-btn{cursor:pointer;border:none;background:none;padding:0;font-size:13px;color:#00aeec;}',
      '.qingliu-undo-btn:hover{text-decoration:underline;}',
      '.qingliu-banner{position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fb7299;color:#fff;text-align:center;padding:8px 40px;font-size:14px;line-height:1.5;}',
      '.qingliu-banner-close{position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:18px;line-height:1;opacity:.85;}',
    ].join('\n');
    document.documentElement.appendChild(style);
  }

  function findCard(anchor) {
    for (const sel of CARD_SELECTORS) {
      const c = anchor.closest(sel);
      if (c) return c;
    }
    return null;
  }

  function readBvid(card) {
    const anchors = card.querySelectorAll(LINK_SELECTOR);
    for (const a of anchors) {
      const b = extractBvid(a.href);
      if (b) return b;
    }
    return null;
  }

  function registerCard(card, bvid) {
    if (cards.has(card)) return;
    const rec = { card, bvid, msg: undefined, title: undefined, desc: undefined, querying: false, hidden: false, placeholder: null, gridItem: null, restorePosition: false };
    cards.set(card, rec);
    if (observer) observer.observe(card);
  }

  // 首页卡片有两种：直接挂在网格下，或外面包一层 .feed-card。两种模式都要先定位到
  // 「网格项」那一层（往上走到 parent 是 grid 容器的元素），否则藏里层卡片外面那层还占格。
  function gridItemOf(card) {
    let el = card;
    while (el && el.parentElement) {
      if (getComputedStyle(el.parentElement).display === 'grid') return el;
      el = el.parentElement;
    }
    return card;
  }

  function buildPlaceholder(rec) {
    const el = document.createElement('div');
    el.className = 'qingliu-placeholder';
    const label = document.createElement('span');
    label.textContent = '已隐藏 1 个视频';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qingliu-placeholder-btn';
    btn.textContent = '撤销';
    btn.addEventListener('click', () => {
      whitelist.add(rec.bvid);
      chrome.storage.local.set({ whitelist: [...whitelist] });
      showCard(rec);
    });
    el.append(label, btn);
    return el;
  }

  function updateUndo() {
    const n = hiddenStack.length;
    if (n === 0) {
      if (undoEl) { undoEl.remove(); undoEl = null; }
      return;
    }
    if (!undoEl) {
      undoEl = document.createElement('div');
      undoEl.className = 'qingliu-undo';
      const label = document.createElement('span');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qingliu-undo-btn';
      btn.textContent = '撤销';
      btn.addEventListener('click', undoLast);
      undoEl.append(label, btn);
      document.documentElement.appendChild(undoEl);
    }
    undoEl.querySelector('span').textContent = `已隐藏 ${n} 个视频`;
  }

  function undoLast() {
    const rec = hiddenStack.pop();
    if (!rec) return;
    whitelist.add(rec.bvid);
    chrome.storage.local.set({ whitelist: [...whitelist] });
    showCard(rec);
  }

  // 统一恢复：无论当前是哪种模式，把卡片所有可能的隐藏痕迹清干净，再回计数。
  function showCard(rec) {
    if (!rec.hidden) return;
    rec.hidden = false;
    const gridItem = rec.gridItem || rec.card;
    gridItem.style.display = '';
    gridItem.style.opacity = '';
    gridItem.style.transition = '';
    rec.card.style.visibility = '';
    if (rec.placeholder && rec.placeholder.isConnected) rec.placeholder.remove();
    rec.placeholder = null;
    if (rec.restorePosition && rec.gridItem) rec.gridItem.style.position = '';
    rec.restorePosition = false;
    rec.gridItem = null;
    const i = hiddenStack.indexOf(rec);
    if (i !== -1) hiddenStack.splice(i, 1);
    filteredCount = Math.max(0, filteredCount - 1);
    updateUndo();
  }

  function hideCard(rec) {
    if (rec.hidden) return;
    rec.hidden = true;
    const gridItem = gridItemOf(rec.card);
    rec.gridItem = gridItem;

    if (mode === 'reflow') {
      // 补位：隐藏整个网格项，grid 自动把后面卡片顶上来。
      gridItem.style.transition = `opacity ${FADE_MS}ms ease`;
      gridItem.style.opacity = '0';
      setTimeout(() => {
        if (!rec.hidden) {
          gridItem.style.opacity = '';
          gridItem.style.transition = '';
          return;
        }
        gridItem.style.display = 'none';
        gridItem.style.opacity = '';
        gridItem.style.transition = '';
      }, FADE_MS);
      hiddenStack.push(rec);
      filteredCount++;
      updateUndo();
    } else {
      // 占位：藏里层内容，原位铺整格灰块，不动布局。
      if (getComputedStyle(gridItem).position === 'static') {
        gridItem.style.position = 'relative';
        rec.restorePosition = true;
      }
      rec.card.style.visibility = 'hidden';
      const ph = buildPlaceholder(rec);
      rec.placeholder = ph;
      gridItem.appendChild(ph);
      filteredCount++;
    }
  }

  function decide(rec) {
    const hit =
      enabled &&
      !whitelist.has(rec.bvid) &&
      (shouldFilter(rec.msg, selectedTypes) || matchesKeyword(rec.title, rec.desc, keywords));
    if (hit) hideCard(rec);
    else showCard(rec);
  }

  async function queryBvids(recs) {
    const bvids = [...new Set(recs.map((r) => r.bvid))];
    let results = {};
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'QUERY_ARGUE', bvids });
      results = (resp && resp.results) || {};
    } catch (e) {
      results = {};
    }
    for (const rec of recs) {
      rec.querying = false;
      const r = results[rec.bvid];
      if (!r || r.error) {
        rec.msg = undefined;
        rec.title = undefined;
        rec.desc = undefined;
      } else {
        rec.msg = r.msg;
        rec.title = r.title;
        rec.desc = r.desc;
        if (r.msg && !knownTypes.has(r.msg)) {
          knownTypes.add(r.msg);
          chrome.storage.local.set({ knownTypes: [...knownTypes] });
        }
      }
    }
    for (const rec of recs) decide(rec);
  }

  function discover() {
    for (const [card, rec] of cards) {
      if (!card.isConnected) {
        if (rec.hidden) {
          filteredCount = Math.max(0, filteredCount - 1);
          const i = hiddenStack.indexOf(rec);
          if (i !== -1) hiddenStack.splice(i, 1);
        }
        if (rec.placeholder && rec.placeholder.isConnected) rec.placeholder.remove();
        cards.delete(card);
        if (observer) observer.unobserve(card);
        continue;
      }
      const bvid = readBvid(card);
      if (bvid && bvid !== rec.bvid) {
        // 卡片元素被复用（换一换 / 无限滚动）：按 bvid 重新判断，不按节点缓存。
        if (rec.hidden) showCard(rec);
        rec.bvid = bvid;
        rec.msg = undefined;
        rec.title = undefined;
        rec.desc = undefined;
        rec.querying = false;
        if (observer) {
          observer.unobserve(card);
          observer.observe(card);
        }
      }
    }
    for (const a of document.querySelectorAll(LINK_SELECTOR)) {
      const bvid = extractBvid(a.href);
      if (!bvid) continue;
      const card = findCard(a);
      if (!card) continue;
      registerCard(card, bvid);
    }
    updateUndo();
  }

  function reapplyAll() {
    for (const rec of cards.values()) {
      if (rec.msg !== undefined) decide(rec);
    }
    if (enabled && observer) {
      for (const card of cards.keys()) {
        observer.unobserve(card);
        observer.observe(card);
      }
    }
  }

  function applySettings(data) {
    const newMode = data.mode === 'reflow' ? 'reflow' : 'placeholder';
    const modeChanged = newMode !== mode;
    enabled = !!data.enabled;
    selectedTypes = new Set(data.selectedTypes || []);
    whitelist = new Set(data.whitelist || []);
    knownTypes = new Set(data.knownTypes || []);
    keywords = parseKeywords(data.keywords);
    mode = newMode;
    if (modeChanged) {
      // 模式变了：先把已隐藏的全部恢复，再按新模式重新判断，避免旧模式的痕迹残留。
      for (const rec of cards.values()) {
        if (rec.hidden) showCard(rec);
      }
    }
    reapplyAll();
  }

  async function loadSettings() {
    const raw = await chrome.storage.local.get(STORAGE_DEFAULTS);
    const data = migrateSettings(raw);
    if (data !== raw) {
      chrome.storage.local.set({
        schemaVersion: data.schemaVersion,
        mode: data.mode,
        selectedTypes: data.selectedTypes,
        knownTypes: data.knownTypes,
      });
    }
    applySettings(data);
  }

  function bannerText(msg) {
    return msg === '含AI生成内容' ? '此视频含 AI 生成内容' : `此视频${msg}`;
  }

  function showBanner(msg) {
    const el = document.createElement('div');
    el.className = 'qingliu-banner';
    const span = document.createElement('span');
    span.textContent = bannerText(msg);
    const close = document.createElement('span');
    close.className = 'qingliu-banner-close';
    close.textContent = '×';
    close.addEventListener('click', () => el.remove());
    el.append(span, close);
    document.documentElement.appendChild(el);
  }

  async function handleVideoPage() {
    if (!enabled) return;
    const bvid = extractBvid(location.href);
    if (!bvid) return;
    let r;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'QUERY_ARGUE', bvids: [bvid] });
      r = resp && resp.results && resp.results[bvid];
    } catch (e) {
      return;
    }
    if (!r || r.error) return;
    if (r.msg && !knownTypes.has(r.msg)) {
      knownTypes.add(r.msg);
      chrome.storage.local.set({ knownTypes: [...knownTypes] });
    }
    if (!enabled || whitelist.has(bvid)) return;
    if (shouldFilter(r.msg, selectedTypes)) {
      showBanner(r.msg);
    } else {
      const kw = firstMatchedKeyword(r.title, r.desc, keywords);
      if (kw) showBanner(`命中关键字「${kw}」`);
    }
  }

  function scheduleDiscover() {
    if (discoverTimer) return;
    discoverTimer = setTimeout(() => {
      discoverTimer = null;
      discover();
    }, 200);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'GET_STATE') {
      sendResponse({
        enabled,
        mode,
        filteredCount,
        selectedTypes: [...selectedTypes],
        knownTypes: [...knownTypes],
      });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = ['enabled', 'mode', 'selectedTypes', 'whitelist', 'knownTypes', 'keywords'];
    if (keys.some((k) => changes[k])) loadSettings();
  });

  function start() {
    injectStyle();
    observer = new IntersectionObserver((entries) => {
      const recs = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const rec = cards.get(entry.target);
        if (!rec || !enabled || rec.msg !== undefined || rec.querying) continue;
        rec.querying = true;
        recs.push(rec);
      }
      if (recs.length) queryBvids(recs);
    }, { rootMargin: ROOT_MARGIN });

    loadSettings().then(() => {
      discover();
      new MutationObserver(() => scheduleDiscover()).observe(document.body, {
        childList: true,
        subtree: true,
      });
      if (isVideoPage()) handleVideoPage();
    });
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
