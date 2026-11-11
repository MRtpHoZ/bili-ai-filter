// 后台服务：所有对 api.bilibili.com 的请求都从这里发出（host_permissions 保证跨域），
// 内容脚本只发消息、不直接 fetch。并发上限 4，单请求超时 2s，成功结果缓存 24h。
(() => {
  'use strict';

  const TTL_MS = 24 * 60 * 60 * 1000;
  const CONCURRENCY = 4;
  const TIMEOUT_MS = 2000;
  const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
  const CACHE_KEY = 'argueCache';

  const cache = new Map();
  const rateLimitedUntil = new Map();
  let cacheLoaded = null;

  function loadCache() {
    if (!cacheLoaded) {
      cacheLoaded = chrome.storage.local.get(CACHE_KEY).then((data) => {
        const raw = data[CACHE_KEY] || {};
        const now = Date.now();
        let pruned = false;
        for (const [bvid, entry] of Object.entries(raw)) {
          if (entry && entry.ts && now - entry.ts < TTL_MS) {
            cache.set(bvid, entry);
          } else {
            pruned = true;
          }
        }
        if (pruned) persistCache();
        return cache;
      });
    }
    return cacheLoaded;
  }

  function persistCache() {
    const obj = {};
    for (const [bvid, entry] of cache) obj[bvid] = entry;
    chrome.storage.local.set({ [CACHE_KEY]: obj });
  }

  function setCached(bvid, msg, title, desc) {
    cache.set(bvid, { msg, title, desc, ts: Date.now() });
    persistCache();
  }

  function fetchArgue(bvid) {
    return new Promise((resolve) => {
      const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      fetch(url, { credentials: 'include', signal: ctrl.signal })
        .then((res) => res.json())
        .then((json) => {
          if (json.code === -352 || json.code === -412) {
            resolve({ error: 'ratelimited' });
          } else if (json.code !== 0) {
            resolve({ error: 'api:' + json.code });
          } else {
            const data = json.data || {};
            const msg =
              (data.argue_info && data.argue_info.argue_msg) || '';
            const title = data.title || '';
            const desc = data.desc || '';
            resolve({ msg, title, desc });
          }
        })
        .catch((e) => {
          resolve({ error: e && e.name === 'AbortError' ? 'timeout' : 'network' });
        })
        .finally(() => clearTimeout(timer));
    });
  }

  const queue = [];
  let active = 0;

  function schedule(fn) {
    return new Promise((resolve, reject) => {
      queue.push(() => Promise.resolve().then(fn).then(resolve, reject));
      pump();
    });
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const task = queue.shift();
      active++;
      task().finally(() => {
        active--;
        pump();
      });
    }
  }

  async function queryMany(bvids) {
    await loadCache();
    const results = {};
    const jobs = [];
    for (const bvid of bvids) {
      const hit = cache.get(bvid);
      // 旧缓存只有 msg、没有 title/desc，当未命中重新取，否则关键字过滤会静默失效。
      if (hit && typeof hit.title === 'string' && typeof hit.desc === 'string') {
        results[bvid] = { msg: hit.msg, title: hit.title, desc: hit.desc };
        continue;
      }
      const until = rateLimitedUntil.get(bvid);
      if (until && Date.now() < until) {
        results[bvid] = { error: 'ratelimited' };
        continue;
      }
      jobs.push(
        schedule(async () => {
          const r = await fetchArgue(bvid);
          if (r.msg !== undefined) {
            setCached(bvid, r.msg, r.title, r.desc);
            results[bvid] = { msg: r.msg, title: r.title, desc: r.desc };
          } else if (r.error === 'ratelimited') {
            rateLimitedUntil.set(bvid, Date.now() + RATE_LIMIT_COOLDOWN_MS);
            results[bvid] = { error: 'ratelimited' };
          } else {
            results[bvid] = { error: r.error };
          }
        })
      );
    }
    await Promise.all(jobs);
    return { results };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'QUERY_ARGUE' && Array.isArray(msg.bvids)) {
      const bvids = [...new Set(msg.bvids)];
      queryMany(bvids).then(sendResponse, () => sendResponse({ results: {} }));
      return true;
    }
  });
})();
