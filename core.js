// 纯逻辑，无浏览器依赖，供 content/background/popup 共享，也可被 node 测试加载。
(function (root) {
  'use strict';

  // BV 号 = "BV" + 10 位 [0-9A-Za-z]，精确匹配，避免把路径后缀吃进去。
  var BVID_RE = /BV[0-9A-Za-z]{10}/;

  // 已实测取值。默认勾前两种 AI 类型，其余由用户勾。新类型运行时追加，不写死上限。
  var DEFAULT_KNOWN_TYPES = [
    '含AI生成内容',
    '作者声明：该视频使用人工智能合成技术',
    '含虚构演绎内容',
    '个人观点，仅供参考',
    '专业动作，非专业人士请勿模仿',
  ];
  var DEFAULT_SELECTED_TYPES = [
    '含AI生成内容',
    '作者声明：该视频使用人工智能合成技术',
  ];

  // 隐藏方式：占位（原位留灰块，排版不变）或补位（后面视频顶上来）。
  var DEFAULT_MODE = 'placeholder';

  // 存储 schema 版本。落后于此值就合并一次当前默认类型再写回。
  var SCHEMA_VERSION = 3;

  // chrome.storage.local 的读取默认值，content/popup 共用。schemaVersion 必须在点名名单里，
  // 否则 get 不会把它读出来，迁移会每次都重跑（默认 1 = v0.1 未迁移）。
  var STORAGE_DEFAULTS = {
    enabled: true,
    mode: DEFAULT_MODE,
    selectedTypes: DEFAULT_SELECTED_TYPES.slice(),
    whitelist: [],
    knownTypes: DEFAULT_KNOWN_TYPES.slice(),
    schemaVersion: 1,
  };

  // 老 profile 升级：版本落后时把当前默认类型合并进已存选择，只跑一次。
  function migrateSettings(data) {
    if (!data || (data.schemaVersion || 1) >= SCHEMA_VERSION) return data;
    var selected = new Set(data.selectedTypes || []);
    var known = new Set(data.knownTypes || []);
    DEFAULT_SELECTED_TYPES.forEach(function (t) { selected.add(t); });
    DEFAULT_KNOWN_TYPES.forEach(function (t) { known.add(t); });
    return Object.assign({}, data, {
      schemaVersion: SCHEMA_VERSION,
      mode: data.mode || DEFAULT_MODE,
      selectedTypes: Array.from(selected),
      knownTypes: Array.from(known),
    });
  }

  function extractBvid(href) {
    var m = String(href || '').match(BVID_RE);
    return m ? m[0] : null;
  }

  // 精确匹配，绝不模糊包含：这是通用提示通道，AI 只是其中一种取值。
  function shouldFilter(msg, selectedTypes) {
    return !!msg && selectedTypes.has(msg);
  }

  root.Qingliu = {
    BVID_RE: BVID_RE,
    SCHEMA_VERSION: SCHEMA_VERSION,
    STORAGE_DEFAULTS: STORAGE_DEFAULTS,
    DEFAULT_KNOWN_TYPES: DEFAULT_KNOWN_TYPES,
    DEFAULT_SELECTED_TYPES: DEFAULT_SELECTED_TYPES,
    DEFAULT_MODE: DEFAULT_MODE,
    extractBvid: extractBvid,
    shouldFilter: shouldFilter,
    migrateSettings: migrateSettings,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
