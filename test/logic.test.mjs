import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

await import('../core.js');
const Q = globalThis.Qingliu;

test('extractBvid 从各类 href 精确提取 BV 号', () => {
  assert.equal(Q.extractBvid('//www.bilibili.com/video/BV1hQ4e6SE32'), 'BV1hQ4e6SE32');
  assert.equal(Q.extractBvid('https://www.bilibili.com/video/BV1vmWJ6LEmW?spm_id_from=333.999'), 'BV1vmWJ6LEmW');
  assert.equal(Q.extractBvid('https://www.bilibili.com/video/BV18GW76hEdg/'), 'BV18GW76hEdg');
  assert.equal(Q.extractBvid('/video/BV1JM4H6hEVi'), 'BV1JM4H6hEVi');
  assert.equal(Q.extractBvid('https://www.bilibili.com/video/BV12m4j6bEFx?p=2'), 'BV12m4j6bEFx');
  assert.equal(Q.extractBvid('https://www.bilibili.com/video/BV1WEWs66EBP'), 'BV1WEWs66EBP');
  assert.equal(Q.extractBvid('https://www.bilibili.com/video/BV1DuW46sEUc'), 'BV1DuW46sEUc');
});

test('extractBvid 对非视频链接返回 null', () => {
  assert.equal(Q.extractBvid('https://www.bilibili.com/'), null);
  assert.equal(Q.extractBvid('https://www.bilibili.com/video/'), null);
  assert.equal(Q.extractBvid(''), null);
  assert.equal(Q.extractBvid(null), null);
  assert.equal(Q.extractBvid('https://www.bilibili.com/video/av170001'), null);
});

test('shouldFilter 精确匹配，绝不模糊包含', () => {
  const selected = new Set(['含AI生成内容']);
  assert.equal(Q.shouldFilter('含AI生成内容', selected), true);
  assert.equal(Q.shouldFilter('含虚构演绎内容', selected), false);
  // 模糊包含的反例：影视解说/跑酷里的「AI」不能命中
  assert.equal(Q.shouldFilter('此内容涉及 AI 剧情解说', selected), false);
  assert.equal(Q.shouldFilter('', selected), false);
  assert.equal(Q.shouldFilter(undefined, selected), false);
});

test('无标注(空串)一律不过滤', () => {
  const selected = new Set(Q.DEFAULT_KNOWN_TYPES);
  assert.equal(Q.shouldFilter('', selected), false);
});

test('默认勾选两种 AI 类型', () => {
  assert.deepEqual(Q.DEFAULT_SELECTED_TYPES, [
    '含AI生成内容',
    '作者声明：该视频使用人工智能合成技术',
  ]);
  assert.ok(Q.DEFAULT_KNOWN_TYPES.includes('含AI生成内容'));
  assert.ok(Q.DEFAULT_KNOWN_TYPES.includes('作者声明：该视频使用人工智能合成技术'));
});

test('manifest 结构合法且覆盖目标页面', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.host_permissions.includes('https://api.bilibili.com/*'));
  const matches = manifest.content_scripts[0].matches;
  assert.ok(matches.includes('https://www.bilibili.com/*'));
  assert.ok(matches.includes('https://search.bilibili.com/*'));
  // 只允许 bilibili 域，example.com 不会被注入
  assert.ok(matches.every((m) => m.includes('bilibili.com')));
  // core.js 必须在 content.js 之前加载
  const js = manifest.content_scripts[0].js;
  assert.ok(js.indexOf('core.js') < js.indexOf('content.js'));
  // manifest 引用的文件必须存在（加载未打包扩展时缺文件会直接报错）
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...js,
  ];
  for (const f of files) {
    assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `缺少文件 ${f}`);
  }
});

test('全类型取消勾选 = 不过滤任何视频', () => {
  assert.equal(Q.shouldFilter('含AI生成内容', new Set()), false);
  assert.equal(Q.shouldFilter('含虚构演绎内容', new Set()), false);
});

test('新类型「作者声明：该视频使用人工智能合成技术」默认被过滤', () => {
  const selected = new Set(Q.DEFAULT_SELECTED_TYPES);
  assert.equal(Q.shouldFilter('作者声明：该视频使用人工智能合成技术', selected), true);
});

test('其他已观测类型仍默认不过滤', () => {
  const selected = new Set(Q.DEFAULT_SELECTED_TYPES);
  assert.equal(Q.shouldFilter('含虚构演绎内容', selected), false);
  assert.equal(Q.shouldFilter('个人观点，仅供参考', selected), false);
  assert.equal(Q.shouldFilter('专业动作，非专业人士请勿模仿', selected), false);
  assert.equal(Q.shouldFilter('内容含营销信息', selected), false);
});

test('精确匹配不受影响：近义不误杀', () => {
  const selected = new Set(Q.DEFAULT_SELECTED_TYPES);
  assert.equal(Q.shouldFilter('该视频使用人工智能合成技术', selected), false);
  assert.equal(Q.shouldFilter('含AI生成内容', selected), true);
  assert.equal(Q.shouldFilter('', selected), false);
});

test('旧 profile 升级：schemaVersion 落后时补进新默认类型', () => {
  const old = {
    enabled: true,
    selectedTypes: ['含AI生成内容'],
    knownTypes: ['含AI生成内容', '含虚构演绎内容', '个人观点，仅供参考', '专业动作，非专业人士请勿模仿'],
  };
  const migrated = Q.migrateSettings(old);
  assert.notEqual(migrated, old);
  assert.equal(migrated.schemaVersion, Q.SCHEMA_VERSION);
  assert.ok(migrated.selectedTypes.includes('作者声明：该视频使用人工智能合成技术'));
  assert.ok(migrated.selectedTypes.includes('含AI生成内容'));
  assert.ok(migrated.knownTypes.includes('作者声明：该视频使用人工智能合成技术'));
});

test('旧 profile 升级：补默认隐藏方式为补位', () => {
  const migrated = Q.migrateSettings({ enabled: true, selectedTypes: [], knownTypes: [] });
  assert.equal(migrated.mode, Q.DEFAULT_MODE);
  assert.equal(Q.DEFAULT_MODE, 'reflow');
});

test('旧 profile 升级：已选的补位方式保留', () => {
  const migrated = Q.migrateSettings({ enabled: true, selectedTypes: [], knownTypes: [], mode: 'reflow' });
  assert.equal(migrated.mode, 'reflow');
});

test('已是最新 schemaVersion 则原样返回，不重写', () => {
  const cur = { schemaVersion: Q.SCHEMA_VERSION, selectedTypes: ['含AI生成内容'], knownTypes: [] };
  assert.equal(Q.migrateSettings(cur), cur);
});

test('STORAGE_DEFAULTS 点名 schemaVersion，get 能把它读出来', () => {
  assert.equal(Q.STORAGE_DEFAULTS.schemaVersion, 1);
  assert.ok(Q.STORAGE_DEFAULTS.selectedTypes.includes('作者声明：该视频使用人工智能合成技术'));
});

test('接线：当前版本 + 用户取消默认类型 → 不被补回', () => {
  // 模拟 chrome.storage.local.get(defaults)：只返回 defaults 里点名的 key
  const storage = {
    schemaVersion: Q.SCHEMA_VERSION,
    selectedTypes: [],
    knownTypes: [],
    enabled: true,
    whitelist: [],
  };
  const raw = Object.fromEntries(
    Object.keys(Q.STORAGE_DEFAULTS).map((k) => [k, k in storage ? storage[k] : Q.STORAGE_DEFAULTS[k]])
  );
  const out = Q.migrateSettings(raw);
  assert.equal(out, raw);
  assert.deepEqual(out.selectedTypes, []);
});

test('关键字：命中标题', () => {
  assert.equal(Q.matchesKeyword('【ai】红花蟒蛇娘娘肚子疼', '复刻《西游记》七绝山红蟒精', ['蛇']), true);
  assert.equal(Q.matchesKeyword('无关标题', '无关描述', ['蛇']), false);
});

test('关键字：命中描述', () => {
  assert.equal(Q.matchesKeyword('标题不含词', '复刻《西游记》七绝山红蟒精', ['蟒精']), true);
});

test('关键字：大小写不敏感', () => {
  assert.equal(Q.matchesKeyword('AI 生成视频', '', ['ai']), true);
  assert.equal(Q.matchesKeyword('ai 生成视频', '', ['AI']), true);
  assert.equal(Q.matchesKeyword('Ai 生成视频', '', ['AI']), true);
});

test('关键字：空词被 trim 后丢掉，不会整页杀光', () => {
  assert.deepEqual(Q.parseKeywords(['  ', 'AI', '', ' 蛇 ']), ['AI', '蛇']);
  assert.equal(Q.matchesKeyword('任意标题', '任意描述', ['   ', '']), false);
});

test('关键字：多词任一命中', () => {
  const kws = ['蟒蛇', '奥特曼'];
  assert.equal(Q.matchesKeyword('奥特曼打怪兽', '', kws), true);
  assert.equal(Q.matchesKeyword('完全无关', '也无关', kws), false);
});

test('关键字：一个词都不填时不过滤', () => {
  assert.equal(Q.matchesKeyword('含AI生成内容', '描述', []), false);
  assert.equal(Q.matchesKeyword('含AI生成内容', '描述', undefined), false);
  assert.equal(Q.matchesKeyword('含AI生成内容', '描述', null), false);
});

test('关键字：firstMatchedKeyword 返回命中的词，没命中返回 null', () => {
  assert.equal(Q.firstMatchedKeyword('【ai】红花蟒蛇娘娘肚子疼', '复刻', ['蛇', '蟒']), '蛇');
  assert.equal(Q.firstMatchedKeyword('标题不含', '七绝山红蟒精', ['蟒精']), '蟒精');
  assert.equal(Q.firstMatchedKeyword('无关标题', '无关描述', ['蛇']), null);
  assert.equal(Q.firstMatchedKeyword('无关', '无关', []), null);
});
