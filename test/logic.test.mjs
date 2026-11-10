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

test('默认只勾选 AI 生成内容', () => {
  assert.deepEqual(Q.DEFAULT_SELECTED_TYPES, ['含AI生成内容']);
  assert.ok(Q.DEFAULT_KNOWN_TYPES.includes('含AI生成内容'));
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
