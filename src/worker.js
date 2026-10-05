/* Halloween大作戦 — 利用回数の記録と集計
   ・POST /api/track   … 回数を1つ足す（日本時間の日付ごと）
   ・GET  /stats?key=… … 日別と累計を見るページ（合言葉つき）
   保存するのは「日付・種類・回数」だけ。IP・端末情報・名前は保存しない。 */

const EVENTS = ['new', 'open', 'stamp', 'complete', 'share'];
const LABELS = {
  new: 'はじめての人',
  open: '開いた人',
  stamp: 'ランタン点灯',
  complete: '7日間達成',
  share: 'シェア',
};
const NOTES = {
  new: '計測開始後、その端末で初めて開いた回数',
  open: '同じ端末は1日1回だけ数える',
  stamp: 'ランタンを灯した回数（消した分は数えない）',
  complete: '7つ全部そろった回数',
  share: '「シェアする」を押した回数',
};
const BOT = /bot|crawl|spider|preview|headless|lighthouse|monitor/i;

function jstDay(ms) {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function track(request, env, url) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  // ほかのサイトからの送信は受け付けない
  if (request.headers.get('Origin') !== url.origin) return new Response(null, { status: 403 });
  if (BOT.test(request.headers.get('User-Agent') || '')) return new Response(null, { status: 204 });

  if (env.TRACK_LIMIT) {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.TRACK_LIMIT.limit({ key: ip });
      if (!success) return new Response(null, { status: 429 });
    } catch (e) { /* 連打よけが使えないときは、そのまま記録する */ }
  }

  let events;
  try {
    const text = await request.text();
    if (text.length > 200) return new Response(null, { status: 413 });
    const e = JSON.parse(text).e;
    events = Array.isArray(e) ? e : [e];
  } catch (e) {
    return new Response(null, { status: 400 });
  }
  events = [...new Set(events)].filter((e) => EVENTS.includes(e));
  if (!events.length) return new Response(null, { status: 400 });

  const day = jstDay(Date.now());
  const stmt = env.DB.prepare(
    'INSERT INTO daily_counts (day, event, count) VALUES (?1, ?2, 1) ' +
    'ON CONFLICT (day, event) DO UPDATE SET count = count + 1'
  );
  await env.DB.batch(events.map((e) => stmt.bind(day, e)));
  return new Response(null, { status: 204 });
}

function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function loadStats(env) {
  const { results } = await env.DB.prepare('SELECT day, event, count FROM daily_counts ORDER BY day').all();
  const byDay = {};
  const totals = Object.fromEntries(EVENTS.map((e) => [e, 0]));
  for (const r of results) {
    if (!EVENTS.includes(r.event)) continue;
    (byDay[r.day] = byDay[r.day] || {})[r.event] = r.count;
    totals[r.event] += r.count;
  }
  // 記録のない日も0として並べる（最初の日〜今日）
  const today = jstDay(Date.now());
  const days = [];
  const first = results.length ? results[0].day : today;
  for (let t = Date.parse(first + 'T00:00:00Z'); ; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d > today) break;
    days.push({ day: d, ...Object.fromEntries(EVENTS.map((e) => [e, (byDay[d] || {})[e] || 0])) });
  }
  return { today, totals, days: days.reverse() };
}

function statsPage({ today, totals, days }) {
  const n = (v) => Number(v).toLocaleString('ja-JP');
  const wd = (d) => '日月火水木金土'[new Date(d + 'T00:00:00Z').getUTCDay()];
  const max = Math.max(1, ...days.map((d) => d.open));
  const todayRow = days.find((d) => d.day === today) || {};
  const cards = EVENTS.map((e) =>
    `<div class="card"><div class="lb">${LABELS[e]}</div><div class="num">${n(totals[e])}</div>` +
    `<div class="sub">今日 ${n(todayRow[e] || 0)}</div><div class="note">${NOTES[e]}</div></div>`
  ).join('');
  const rows = days.map((d) =>
    `<tr><th>${d.day.slice(5).replace('-', '/')}<small>（${wd(d.day)}）</small></th>` +
    EVENTS.map((e) => `<td>${n(d[e])}</td>`).join('') +
    `<td class="bar"><i style="width:${Math.round((d.open / max) * 100)}%"></i></td></tr>`
  ).join('');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Halloween大作戦 利用状況</title>
<style>
:root{--bg:#1b1226;--panel:#2a1d3a;--line:#43305c;--ink:#f6efff;--mute:#b9a8d1;--pumpkin:#ff9a3c;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.6}
main{max-width:860px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:15px;margin:28px 0 10px;color:var(--mute);font-weight:600}
p.lead{margin:0;color:var(--mute);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px}
.lb{font-size:13px;color:var(--mute)}
.num{font-size:30px;font-weight:700;color:var(--pumpkin);font-variant-numeric:tabular-nums;line-height:1.3}
.sub{font-size:13px}
.note{font-size:11px;color:var(--mute);margin-top:6px}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:520px;font-size:14px;font-variant-numeric:tabular-nums}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
thead th{color:var(--mute);font-weight:600;font-size:12px}
tbody th{text-align:left;font-weight:600}
tbody th small{color:var(--mute);font-weight:400}
thead th:first-child{text-align:left}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
td.bar{width:22%;min-width:80px}
td.bar i{display:block;height:8px;border-radius:4px;background:var(--pumpkin);min-width:2px}
.empty{padding:20px;color:var(--mute);text-align:center}
</style></head><body><main>
<h1>🎃 Halloween大作戦 利用状況</h1>
<p class="lead">日付は日本時間。開き直すと最新になります。回数だけを数えていて、個人が分かる情報は保存していません。</p>
<h2>累計</h2>
<div class="cards">${cards}</div>
<h2>日ごと（新しい順）</h2>
<div class="wrap"><table>
<thead><tr><th>日付</th>${EVENTS.map((e) => `<th>${LABELS[e]}</th>`).join('')}<th></th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
</main></body></html>`;
}

async function stats(request, env, url) {
  // 合言葉が未設定・不一致のときは、ページがあること自体を見せない
  if (!env.STATS_KEY || !sameKey(url.searchParams.get('key') || '', env.STATS_KEY)) {
    return new Response('Not Found', { status: 404 });
  }
  const data = await loadStats(env);
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (url.pathname === '/api/stats') return Response.json(data, { headers });
  return new Response(statsPage(data), {
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/track') return track(request, env, url);
    if (url.pathname === '/stats' || url.pathname === '/api/stats') {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
      return stats(request, env, url);
    }
    return new Response('Not Found', { status: 404 });
  },
};
