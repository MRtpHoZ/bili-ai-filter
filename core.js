// 纯逻辑，无浏览器依赖，供 content/background/popup 共享，也可被 node 测试加载。
(function (root) {
  'use strict';

  // BV 号 = "BV" + 10 位 [0-9A-Za-z]，精确匹配，避免把路径后缀吃进去。
  var BVID_RE = /BV[0-9A-Za-z]{10}/;

  // 已实测取值。默认只勾第一种，其余由用户勾。新类型运行时追加，不写死上限。
  var DEFAULT_KNOWN_TYPES = [
    '含AI生成内容',
    '含虚构演绎内容',
    '个人观点，仅供参考',
    '专业动作，非专业人士请勿模仿',
  ];
  var DEFAULT_SELECTED_TYPES = ['含AI生成内容'];

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
    DEFAULT_KNOWN_TYPES: DEFAULT_KNOWN_TYPES,
    DEFAULT_SELECTED_TYPES: DEFAULT_SELECTED_TYPES,
    extractBvid: extractBvid,
    shouldFilter: shouldFilter,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
