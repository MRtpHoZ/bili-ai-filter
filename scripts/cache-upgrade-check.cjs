// 验收 #6 升级路径：只有 msg 字段的旧 argueCache 起跑，关键字过滤仍然生效。
// 模拟 chrome API 加载 background.js，喂一份旧格式缓存，验证会重新取回 title/desc。
// 非 CI，人工跑：node scripts/cache-upgrade-check.cjs
const fs = require('fs');
const path = require('path');

const storageData = {
  // 旧格式：只有 msg + ts，没有 title/desc
  argueCache: {
    BV1hQ4e6SE32: { msg: '含AI生成内容', ts: Date.now() },
  },
};
let fetchCount = 0;

global.chrome = {
  storage: {
    local: {
      get(key) {
        return Promise.resolve({ [key]: storageData[key] });
      },
      set(obj) {
        Object.assign(storageData, obj);
        return Promise.resolve();
      },
    },
  },
  runtime: { onMessage: { addListener() {} } },
};

global.fetch = async () => {
  fetchCount++;
  return {
    json: async () => ({
      code: 0,
      data: {
        argue_info: { argue_msg: '含AI生成内容' },
        title: '【ai】红花蟒蛇娘娘肚子疼',
        desc: '复刻《西游记》七绝山红蟒精，孙悟空是娘化版',
      },
    }),
  };
};

let handler = null;
chrome.runtime.onMessage.addListener = (h) => { handler = h; };

require('../background.js');
require('../core.js');
const { parseKeywords, matchesKeyword } = globalThis.Qingliu;

(async () => {
  await new Promise((r) => setTimeout(r, 0));
  const resp = await new Promise((resolve) => {
    handler({ type: 'QUERY_ARGUE', bvids: ['BV1hQ4e6SE32'] }, null, resolve);
  });
  const entry = resp.results['BV1hQ4e6SE32'];
  console.log('旧缓存条目只有 msg，触发重新 fetch 次数:', fetchCount);
  console.log('返回结果含 title/desc:', JSON.stringify(entry));
  const kws = parseKeywords([' 蛇 ']);
  console.log('关键字 [蛇] 命中标题:', matchesKeyword(entry.title, entry.desc, kws));
  const ok = fetchCount === 1 && entry.title && entry.desc && matchesKeyword(entry.title, entry.desc, kws);
  console.log(ok ? 'PASS #6 升级路径' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
