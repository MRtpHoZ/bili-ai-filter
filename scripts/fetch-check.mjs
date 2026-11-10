// 数据源核验脚本（非 CI，人工跑）。直接调 B 站接口，核对每个测试样本 BV 的 argue_msg。
const SAMPLE = [
  ['BV1hQ4e6SE32', '含AI生成内容'],
  ['BV1vmWJ6LEmW', '含AI生成内容'],
  ['BV18GW76hEdg', '含AI生成内容'],
  ['BV1JM4H6hEVi', '含虚构演绎内容'],
  ['BV12m4j6bEFx', '含虚构演绎内容'],
  ['BV1WEWs66EBP', '个人观点，仅供参考'],
];

async function argueMsg(bvid) {
  const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const json = await res.json();
  return { code: json.code, msg: (json.data && json.data.argue_info && json.data.argue_info.argue_msg) || '' };
}

let fail = 0;
for (const [bvid, expect] of SAMPLE) {
  const { code, msg } = await argueMsg(bvid);
  const ok = code === 0 && msg === expect;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${bvid}  expect=${JSON.stringify(expect)}  actual=${JSON.stringify(msg)} code=${code}`);
}
process.exit(fail ? 1 : 0);
