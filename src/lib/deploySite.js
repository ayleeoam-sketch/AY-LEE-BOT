import { CREATOR, isCreatorHub } from '../branding.js'
import { startPairing, cleanPhone } from './pair.js'
import { readSession, isToken } from './deployStore.js'
import { parseInviteCode } from '../../plugins/config/forcejoin.js'

/**
 * The VENOM MD deploy portal — served by the keep-alive HTTP server.
 *
 * Pairing on the website is only enabled on the official creator hub.
 * Everyone else still sees how to get the bot and where to join.
 */

const jobs = new Map() // id -> { status, code, token, error, phone }

function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(body)
  return true
}

export function siteHtml({ hub, publicUrl }) {
  const pairBlock = hub
    ? `<section class="card">
        <h2>1. Pair here — no session ID to copy</h2>
        <p>Join the official group first, then enter your WhatsApp number. We give you an 8-digit code. After it links you get a short <b>SESSION_TOKEN</b>.</p>
        <form id="pair-form">
          <label>WhatsApp number (country code, no +)</label>
          <input id="phone" inputmode="numeric" placeholder="2348012345678" required />
          <label>Your name (shown as bot owner)</label>
          <input id="name" placeholder="Micheal" />
          <button type="submit">Get pairing code</button>
        </form>
        <div id="pair-out" hidden></div>
      </section>
      <section class="card">
        <h2>2. Deploy with the token</h2>
        <p>One Web Service. Three env vars. That is the whole setup.</p>
        <pre>SESSION_TOKEN=VNM-XXXXXX
OWNER_NUMBER=2348012345678
OWNER_NAME=Your Name</pre>
        <div class="btns">
          <a class="btn render" href="https://dashboard.render.com/web/new" target="_blank" rel="noopener">Deploy on Render</a>
          <a class="btn rail" href="https://railway.app/new" target="_blank" rel="noopener">Deploy on Railway</a>
          <a class="btn koyeb" href="https://app.koyeb.com/services/deploy?type=git&amp;repository=MykelGoal/VENOM-MD-BOT" target="_blank" rel="noopener">Deploy on Koyeb</a>
          <a class="btn heroku" href="https://dashboard.heroku.com/new?template=https://github.com/MykelGoal/VENOM-MD-BOT" target="_blank" rel="noopener">Deploy on Heroku</a>
        </div>
      </section>`
    : `<section class="card">
        <h2>Pairing lives on the official VENOM MD</h2>
        <p>This copy cannot mint sessions. Message the creator, send <b>.owner</b> then <b>.pair</b>.</p>
        <div class="btns">
          <a class="btn wa" href="${CREATOR.wa}">Chat ${CREATOR.name}</a>
        </div>
      </section>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VENOM MD — get your own bot</title>
<style>
  :root { --bg:#0b0614; --card:#160d24; --line:#3b2460; --acc:#a855f7; --ok:#34d399; --txt:#f5f3ff; --muted:#c4b5fd; }
  * { box-sizing:border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:
    radial-gradient(900px 400px at 10% -10%, #4c1d95 0%, transparent 50%),
    radial-gradient(700px 300px at 110% 10%, #6d28d9 0%, transparent 45%), var(--bg);
    color:var(--txt); }
  main { max-width:760px; margin:0 auto; padding:32px 18px 80px; }
  h1 { font-size:2rem; margin:0 0 6px; letter-spacing:.04em; }
  .sub { color:var(--muted); margin:0 0 22px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; margin:16px 0; }
  a { color:#e9d5ff; }
  label { display:block; font-size:.85rem; color:var(--muted); margin:10px 0 4px; }
  input { width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--line); background:#0b0614; color:var(--txt); font-size:1rem; }
  button, .btn { display:inline-block; margin-top:12px; padding:12px 16px; border:0; border-radius:10px; background:var(--acc); color:#fff; font-weight:700; text-decoration:none; cursor:pointer; }
  .btns { display:flex; flex-wrap:wrap; gap:10px; }
  .btn.render { background:#46e3b7; color:#06231b; }
  .btn.rail { background:#ff8700; }
  .btn.koyeb { background:#ff009d; }
  .btn.heroku { background:#430098; }
  .btn.wa { background:#25d366; color:#06230f; }
  pre { background:#0b0614; padding:12px; border-radius:10px; overflow:auto; }
  .code { font-size:1.6rem; letter-spacing:.2em; color:var(--ok); font-weight:800; }
  footer { color:var(--muted); font-size:.85rem; margin-top:28px; }
</style>
</head>
<body>
<main>
  <h1>⚡ VENOM MD</h1>
  <p class="sub">Built by ${CREATOR.name}. Pair once. Deploy anywhere. No giant session IDs.</p>

  <section class="card">
    <h2>Join first — required</h2>
    <p>The bot does not answer people who are not in the official group.</p>
    <div class="btns">
      <a class="btn wa" href="${CREATOR.group}">Join the official group</a>
      <a class="btn" href="${CREATOR.wa}">Message the creator</a>
    </div>
  </section>

  ${pairBlock}

  <section class="card">
    <h2>WhatsApp commands</h2>
    <p><b>.owner</b> — creator card (works even if the bot is in private mode)</p>
    <p><b>.pair 234…</b> — pairing code + deploy token, official bot only</p>
    <p><b>.getbot</b> — this whole walkthrough in chat</p>
  </section>

  <footer>Repo <a href="${CREATOR.repo}">${CREATOR.repo}</a>${publicUrl ? ` · this hub ${publicUrl}` : ''}</footer>
</main>
<script>
const form = document.getElementById('pair-form')
if (form) {
  const out = document.getElementById('pair-out')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const phone = document.getElementById('phone').value
    const ownerName = document.getElementById('name').value
    out.hidden = false
    out.innerHTML = 'Asking WhatsApp for a code…'
    const r = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, ownerName })
    })
    const data = await r.json()
    if (!data.ok) { out.innerHTML = data.error || 'Failed'; return }
    const poll = async () => {
      const s = await fetch('/api/pair/' + data.id).then((x) => x.json())
      if (s.code) {
        out.innerHTML = '<p>Type this on your phone → <b>Linked devices → Link with phone number</b></p><div class="code">' + s.code + '</div><p>' + (s.status || '') + '</p>'
      }
      if (s.token) {
        out.innerHTML += '<p>Linked. Your token:</p><pre>SESSION_TOKEN=' + s.token + '</pre><p>Join the group if you have not: <a href="${CREATOR.group}">${CREATOR.group}</a></p>'
        return
      }
      if (s.error) { out.innerHTML += '<p>' + s.error + '</p>'; return }
      setTimeout(poll, 2000)
    }
    poll()
  })
}
</script>
</body>
</html>`
}

export async function handleDeployHttp(req, res, { publicUrl }) {
  const url = new URL(req.url, 'http://localhost')
  const hub = isCreatorHub()

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' })
    return res.end()
  }

  if (url.pathname === '/api/session/' + url.pathname.split('/').pop() || url.pathname.startsWith('/api/session/')) {
    const token = url.pathname.split('/').pop()
    if (!isToken(token)) return json(res, 400, { ok: false, error: 'bad token' })
    const row = await readSession(token)
    if (!row?.sessionId) return json(res, 404, { ok: false, error: 'unknown or expired token' })
    return json(res, 200, { ok: true, sessionId: row.sessionId, phone: row.phone })
  }

  if (url.pathname === '/api/pair' && req.method === 'POST') {
    if (!hub) return json(res, 403, { ok: false, error: 'Pairing only runs on the official VENOM MD.' })
    const raw = await readBody(req)
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch { return json(res, 400, { ok: false, error: 'invalid json' }) }
    const phone = cleanPhone(body.phone)
    if (phone.length < 10) return json(res, 400, { ok: false, error: 'Give a full international number.' })
    const id = `${phone}-${Date.now()}`
    const job = { id, phone, status: 'starting', code: '', token: '', error: '' }
    jobs.set(id, job)
    startPairing({
      phone,
      ownerName: body.ownerName || '',
      onCode: (code) => { job.code = code; job.status = 'waiting' }
    }).then((r) => {
      if (r.ok) { job.token = r.token; job.status = 'done' }
      else { job.error = r.error; job.status = 'failed' }
    })
    return json(res, 200, { ok: true, id })
  }

  if (url.pathname.startsWith('/api/pair/') && req.method === 'GET') {
    const id = url.pathname.slice('/api/pair/'.length)
    const job = jobs.get(id)
    if (!job) return json(res, 404, { ok: false, error: 'unknown job' })
    return json(res, 200, job)
  }

  if (url.pathname === '/api/status' || url.pathname === '/health') return false

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/deploy' || url.pathname === '/index.html')) {
    const html = siteHtml({ hub, publicUrl })
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store'
    })
    res.end(html)
    return true
  }

  return false
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export { parseInviteCode }
export default handleDeployHttp
