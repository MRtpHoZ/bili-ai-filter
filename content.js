// 内容脚本：发现卡片 → IntersectionObserver 提前 200px 触发 → 走后台查标注 → 命中则淡出+隐藏。
// 卡片 DOM 选择器集中在一处（CARD_SELECTORS），首页改版失效时是安全一侧（全部可见）。
(() => {
  'use strict';

  const { extractBvid, shouldFilter, DEFAULT_KNOWN_TYPES, DEFAULT_SELECTED_TYPES, migrateSettings, STORAGE_DEFAULTS } = globalThis.Qingliu;

  const CARD_SELECTORS = [
    '.bili-video-card',
    '.video-page-card-small',
    '.rank-list-item',
  ];
  const LINK_SELECTOR = 'a[href*="/video/BV"]';
  const ROOT_MARGIN = '200px';
  const FADE_MS = 150;

  let enabled = true;
  let selectedTypes = new Set(DEFAULT_SELECTED_TYPES);
  let whitelist = new Set();
  let knownTypes = new Set(DEFAULT_KNOWN_TYPES);
  let filteredCount = 0;

  const cards = new Map(); // cardEl -> rec
  const hiddenStack = []; // 最近隐藏的 rec，撤销按 LIFO 弹
  let undoEl = null;
  let observer = null;
  let discoverTimer = null;

  function isVideoPage() {
    return /^https:\/\/www\.bilibili\.com\/video\/BV/i.test(location.href);
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
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
    const rec = { card, bvid, msg: undefined, querying: false, hidden: false };
    cards.set(card, rec);
    if (observer) observer.observe(card);
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

  function showCard(rec) {
    if (!rec.hidden) return;
    rec.hidden = false;
    rec.card.style.display = '';
    rec.card.style.opacity = '';
    rec.card.style.transition = '';
    const i = hiddenStack.indexOf(rec);
    if (i !== -1) hiddenStack.splice(i, 1);
    filteredCount = Math.max(0, filteredCount - 1);
    updateUndo();
  }

  function hideCard(rec) {
    if (rec.hidden) return;
    rec.hidden = true;
    const card = rec.card;
    card.style.transition = `opacity ${FADE_MS}ms ease`;
    card.style.opacity = '0';
    setTimeout(() => {
      if (!rec.hidden) {
        card.style.opacity = '';
        card.style.transition = '';
        return;
      }
      card.style.display = 'none';
      card.style.opacity = '';
      card.style.transition = '';
    }, FADE_MS);
    hiddenStack.push(rec);
    filteredCount++;
    updateUndo();
  }

  function decide(rec) {
    if (enabled && shouldFilter(rec.msg, selectedTypes) && !whitelist.has(rec.bvid)) {
      hideCard(rec);
    } else {
      showCard(rec);
    }
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
      } else {
        rec.msg = r.msg;
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
    enabled = !!data.enabled;
    selectedTypes = new Set(data.selectedTypes || []);
    whitelist = new Set(data.whitelist || []);
    knownTypes = new Set(data.knownTypes || []);
    reapplyAll();
  }

  async function loadSettings() {
    const raw = await chrome.storage.local.get(STORAGE_DEFAULTS);
    const data = migrateSettings(raw);
    if (data !== raw) {
      chrome.storage.local.set({
        schemaVersion: data.schemaVersion,
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
    if (!r || r.error || !r.msg) return;
    if (!knownTypes.has(r.msg)) {
      knownTypes.add(r.msg);
      chrome.storage.local.set({ knownTypes: [...knownTypes] });
    }
    if (enabled && shouldFilter(r.msg, selectedTypes) && !whitelist.has(bvid)) {
      showBanner(r.msg);
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
        filteredCount,
        selectedTypes: [...selectedTypes],
        knownTypes: [...knownTypes],
      });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = ['enabled', 'selectedTypes', 'whitelist', 'knownTypes'];
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
