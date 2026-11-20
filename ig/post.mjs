// 인스타 자동 게시 프로그램
// ig/queue/<계정>/<YYYY-MM-DD-HHMM>_<이름>/ 폴더를 시간 순서대로 보고,
// 올릴 시간이 지난 것을 인스타그램 공식 연결(Graph API)로 하나씩 올린다.
// 폴더 이름은 영문·숫자로 (인스타가 주소를 읽기 쉽게). 폴더 안: 사진 1.jpg 2.jpg ... (여러 장이면 넘겨 보는 게시물) 또는 video.mp4 (릴스), 그리고 caption.txt
// 올린 기록은 ig/posted.json 에 남기고 같은 것을 두 번 올리지 않는다.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const QUEUE = path.join(ROOT, 'queue');
const LOG = path.join(ROOT, 'posted.json');
const ACCOUNTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'accounts.json'), 'utf8'));
const MEDIA_BASE = (process.env.IG_MEDIA_BASE || 'https://drbeautylab.co.kr/ig/queue').replace(/\/$/, '');
const GRAPH = process.env.IG_GRAPH_BASE || 'https://graph.facebook.com';
const DRY = process.env.DRY_RUN === '1';

const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : {};
const save = () => fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 한국 시간 기준 "지금"
function nowKST() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return d.toISOString().slice(0, 16).replace('T', '-').replace(':', ''); // YYYY-MM-DD-HHMM
}

async function api(method, url, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(method === 'GET' ? `${url}?${body}` : url, method === 'GET' ? {} : { method, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`인스타 응답 오류: ${JSON.stringify(j.error || j)}`);
  return j;
}

async function waitReady(id, token, maxTries = 30) {
  for (let i = 0; i < maxTries; i++) {
    const j = await api('GET', `${GRAPH}/${id}`, { fields: 'status_code', access_token: token });
    if (j.status_code === 'FINISHED') return;
    if (j.status_code === 'ERROR' || j.status_code === 'EXPIRED') throw new Error(`준비 실패: ${j.status_code}`);
    await sleep(10000);
  }
  throw new Error('영상 처리 시간이 너무 오래 걸림');
}

async function urlOk(u) {
  try { const r = await fetch(u, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

async function publish(acct, dir, rel) {
  const igId = acct.igId || process.env[acct.idSecret], token = process.env[acct.tokenSecret];
  if (!igId || !token) throw new Error(`${acct.name}: 연결 정보(${acct.idSecret}, ${acct.tokenSecret})가 설정에 없음`);
  const files = fs.readdirSync(dir);
  const caption = fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8').trim();
  const url = f => `${MEDIA_BASE}/${rel.split(path.sep).map(encodeURIComponent).join('/')}/${encodeURIComponent(f)}`;
  const video = files.find(f => /\.mp4$/i.test(f));
  const images = files.filter(f => /^\d+\.jpe?g$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  const media = video ? [video] : images;
  if (!media.length) throw new Error('올릴 사진(1.jpg …)이나 영상(video.mp4)이 없음');
  if (images.length > 10) throw new Error('사진은 한 게시물에 10장까지');
  // 사이트에 아직 안 올라간 파일이면 다음 시간에 다시 시도
  for (const f of media) if (!(await urlOk(url(f)))) return { skip: `파일이 아직 사이트에 없음: ${f}` };
  if (DRY) return { dry: media.map(url) };

  const base = `${GRAPH}/${igId}`;
  let creation;
  if (video) {
    const cover = files.find(f => /^cover\.jpe?g$/i.test(f));
    const p = { media_type: 'REELS', video_url: url(video), caption, share_to_feed: 'true', access_token: token };
    if (cover) p.cover_url = url(cover);
    creation = (await api('POST', `${base}/media`, p)).id;
    await waitReady(creation, token);
  } else if (images.length === 1) {
    creation = (await api('POST', `${base}/media`, { image_url: url(images[0]), caption, access_token: token })).id;
    await waitReady(creation, token);
  } else {
    const kids = [];
    for (const f of images) {
      const id = (await api('POST', `${base}/media`, { image_url: url(f), is_carousel_item: 'true', access_token: token })).id;
      await waitReady(id, token); kids.push(id);
    }
    creation = (await api('POST', `${base}/media`, { media_type: 'CAROUSEL', children: kids.join(','), caption, access_token: token })).id;
    await waitReady(creation, token);
  }
  const done = await api('POST', `${base}/media_publish`, { creation_id: creation, access_token: token });
  return { id: done.id };
}

// 릴스 시험 모드: 시험 영상으로 릴스 준비만 해 보고 실제로 올리지는 않는다 (준비본은 24시간 뒤 자동으로 사라짐)
if (process.env.TEST_REEL === '1') {
  const testUrl = (process.env.IG_TEST_REEL_URL || 'https://drbeautylab.co.kr/ig/test/reel-test.mp4');
  let bad = false;
  for (const acct of Object.values(ACCOUNTS)) {
    const igId = acct.igId || process.env[acct.idSecret], token = process.env[acct.tokenSecret];
    if (!igId || !token) { console.log(`${acct.name}: 연결 정보 없음 (건너뜀)`); continue; }
    try {
      const id = (await api('POST', `${GRAPH}/${igId}/media`, { media_type: 'REELS', video_url: testUrl, caption: '시험', share_to_feed: 'false', access_token: token })).id;
      await waitReady(id, token);
      console.log(`${acct.name}: 릴스 준비 성공 (올리지 않음)`);
    } catch (e) { bad = true; console.log(`${acct.name}: 릴스 준비 실패 — ${e.message}`); }
  }
  process.exit(bad ? 1 : 0);
}
// 연결 확인만 하는 모드: 실제로 올리지 않고 계정 이름만 읽어 본다
if (process.env.CHECK_ONLY === '1') {
  let bad = false;
  for (const acct of Object.values(ACCOUNTS)) {
    const igId = acct.igId || process.env[acct.idSecret], token = process.env[acct.tokenSecret];
    if (!igId || !token) { console.log(`${acct.name}: 연결 정보 없음 (아직 설정 전)`); continue; }
    try {
      const j = await api('GET', `${GRAPH}/${igId}`, { fields: 'username', access_token: token });
      const lim = await api('GET', `${GRAPH}/${igId}/content_publishing_limit`, { fields: 'quota_usage,config', access_token: token }).catch(e => ({ err: e.message }));
      console.log(`${acct.name}: 연결 정상 (@${j.username}) 게시 한도 ${JSON.stringify(lim.data?.[0] || lim.err)}`);
    } catch (e) { bad = true; console.log(`${acct.name}: 연결 실패 — ${e.message}`); }
  }
  process.exit(bad ? 1 : 0);
}
const now = process.env.NOW_KST || nowKST();
let changed = false, failed = false;
const MAX_TRIES = 3;
let stopAll = false;
async function findPosted(acct, dir) {
  const igId = acct.igId || process.env[acct.idSecret], token = process.env[acct.tokenSecret];
  const cap = fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8').trim();
  const j = await api('GET', `${GRAPH}/${igId}/media`, { fields: 'id,caption,timestamp', limit: '10', access_token: token });
  const hit = (j.data || []).find(m => (m.caption || '').trim() === cap && Date.now() - Date.parse(m.timestamp) < 3 * 86400e3);
  return hit?.id || null;
}
for (const [key, acct] of Object.entries(ACCOUNTS)) {
  const adir = path.join(QUEUE, key);
  if (!fs.existsSync(adir)) continue;
  const due = fs.readdirSync(adir).filter(n => /^\d{4}-\d{2}-\d{2}-\d{4}_/.test(n)).sort()
    .filter(n => n.slice(0, 15) <= now && !log[`${key}/${n}`]?.id)
    // 같은 게시물은 최대 3번까지만 시도 (계속 다시 시도하면 메타가 비정상 활동으로 막을 수 있음)
    .filter(n => { const t = log[`${key}/${n}`]?.tries || 0; if (t >= MAX_TRIES) console.log(`${acct.name} ${n}: ${t}번 실패해서 멈춤 — 확인 후 posted.json에서 이 줄을 지우면 다시 시도`); return t < MAX_TRIES; });
  if (!due.length) { console.log(`${acct.name}: 올릴 차례 없음`); continue; }
  if (!(acct.igId || process.env[acct.idSecret]) || !process.env[acct.tokenSecret]) { console.log(`${acct.name}: 아직 연결 정보가 없어 건너뜀 (${due.length}개 대기)`); continue; }
  if (stopAll) { console.log(`${acct.name}: 인증 오류로 이번 실행은 멈춤`); continue; }
  const name = due[0]; // 한 번에 계정당 하나씩만
  const rel = path.join(key, name);
  try {
    // 지난번에 실제로는 올라갔는데 기록만 못 남긴 경우(중복 게시 방지): 최근 게시물 설명글과 비교
    if (log[`${key}/${name}`]?.tries) {
      const already = await findPosted(acct, path.join(adir, name));
      if (already) { log[rel.split(path.sep).join('/')] = { id: already, at: new Date().toISOString(), note: '이미 올라가 있던 것 확인' }; changed = true; console.log(`${acct.name} ${name}: 이미 올라가 있음 (${already}) — 다시 올리지 않음`); continue; }
    }
    const r = await publish(acct, path.join(adir, name), rel);
    if (r.skip) { console.log(`${acct.name} ${name}: 건너뜀 — ${r.skip}`); continue; }
    if (r.dry) { console.log(`${acct.name} ${name}: (시험) 올릴 파일`, r.dry); continue; }
    log[rel.split(path.sep).join('/')] = { id: r.id, at: new Date().toISOString() };
    changed = true;
    console.log(`${acct.name} ${name}: 올림 (${r.id})`);
  } catch (e) {
    failed = true;
    const k = rel.split(path.sep).join('/');
    log[k] = { error: String(e.message).slice(0, 500), at: new Date().toISOString(), tries: (log[k]?.tries || 0) + 1 };
    changed = true;
    console.error(`${acct.name} ${name}: 실패 — ${e.message}`);
    // 토큰·권한·차단 같은 인증 오류면 다른 계정도 같은 앱이라 바로 멈춘다
    if (/OAuthException|"code":(190|200|10|368|4|17|32|613)\b/.test(e.message)) stopAll = true;
  }
}
if (changed) save();
if (failed) process.exitCode = 1; // 실패하면 깃허브가 알림 메일을 보낸다
