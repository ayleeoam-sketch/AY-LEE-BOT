import DB from './database.js'
import log from './logger.js'
import { commands } from './pluginLoader.js'
import { getVar } from './vars.js'
import { addWallet } from './economy.js'
import { chat } from './ai.js'

/**
 * VENOM SCHOOL — the bot teaches its own commands, three times a day.
 *
 * The problem it solves: a 380-command menu is unreadable, so people learn
 * six commands and never discover the rest. Dumping the menu on them does
 * not work. Teaching one command at a time, on a schedule, with a quiz and
 * a register, does — it is a class, and people show up to classes.
 *
 * How a session runs:
 *   1. at the scheduled minute the bot posts the lesson in the classroom
 *   2. a multiple-choice question follows
 *   3. anyone who speaks during the window is marked present; answering
 *      correctly is worth more
 *   4. when the window closes the bot posts the register and tags whoever
 *      missed it, like a teacher reading out absentees
 *
 * Lessons are generated from the live plugin registry, so the syllabus is
 * always exactly what this bot can actually do — install a plugin and it
 * enters the syllabus by itself. An AI key makes the explanations warmer,
 * but everything works with no key at all.
 */

const STATE_KEY = 'state'
const TICK_MS = 60_000

let sock = null
let timer = null

/* ----------------------------- state ----------------------------- */

const defaults = {
  key: STATE_KEY,
  group: '',            // classroom jid
  enabled: false,
  times: '08:00,14:00,20:00',
  tz: process.env.TZ || 'Africa/Lagos',
  index: 0,             // position in the syllabus
  windowMin: 20,        // how long the register stays open
  tagAbsent: true,
  lastSlots: '',        // "2026-08-17:08:00,14:00" - what already ran today
  session: null         // the live session, kept here so a restart resumes it
}

export async function state() {
  const row = await DB.school.findOne({ key: STATE_KEY })
  return { ...defaults, ...(row || {}) }
}

export async function saveState(patch) {
  await DB.school.set({ key: STATE_KEY }, patch)
  return state()
}

/* --------------------------- curriculum --------------------------- */

/**
 * The syllabus: every teachable command, ordered so consecutive lessons come
 * from different categories. Nobody wants four downloader lessons in a row.
 *
 * Owner-only and hidden commands are left out - a class of ordinary members
 * cannot run them, and teaching them just breeds "why doesn't it work".
 */
export function syllabus() {
  const seen = new Set()
  const byCategory = new Map()

  for (const [name, plugin] of commands) {
    if (plugin.name !== name) continue          // skip aliases
    if (plugin.hidden || plugin.owner) continue
    if (seen.has(plugin.name)) continue
    seen.add(plugin.name)

    const cat = plugin.category || 'MISC'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat).push(plugin)
  }

  // round-robin across categories
  const lists = [...byCategory.values()].map((l) => l.sort((a, b) => a.name.localeCompare(b.name)))
  const out = []
  for (let i = 0; lists.some((l) => l[i]); i++) {
    for (const list of lists) if (list[i]) out.push(list[i])
  }
  return out
}

/** The lesson at a given position, wrapping around when the syllabus ends. */
export function lessonAt(index) {
  const all = syllabus()
  if (!all.length) return null
  const plugin = all[index % all.length]
  return { plugin, number: (index % all.length) + 1, total: all.length, cycle: Math.floor(index / all.length) + 1 }
}

/* ------------------------------ quiz ------------------------------ */

/**
 * A three-option question built from the syllabus itself: the right answer
 * plus two other real commands as decoys. No API, no hand-written question
 * bank to maintain, and it stays correct as plugins change.
 */
export function buildQuiz(plugin) {
  const pool = syllabus().filter((p) => p.name !== plugin.name && p.desc)
  const decoys = []
  while (decoys.length < 2 && pool.length) {
    const [pick] = pool.splice(Math.floor(Math.random() * pool.length), 1)
    if (!decoys.some((d) => d.desc === pick.desc)) decoys.push(pick)
  }

  const options = [plugin, ...decoys]
    .map((p) => ({ name: p.name, desc: p.desc }))
    .sort(() => Math.random() - 0.5)

  const answer = 'ABC'[options.findIndex((o) => o.name === plugin.name)]
  return {
    question: `Which of these does *.${plugin.name}* do?`,
    options: options.map((o, i) => `*${'ABC'[i]}.* ${o.desc}`),
    answer
  }
}

/* ---------------------------- teaching ---------------------------- */

const GREETING = {
  morning: { emoji: '🌅', label: 'MORNING CLASS' },
  afternoon: { emoji: '☀️', label: 'AFTERNOON CLASS' },
  evening: { emoji: '🌙', label: 'EVENING CLASS' }
}

export function periodOf(hhmm) {
  const h = Number(String(hhmm).split(':')[0])
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

/**
 * Optional AI polish. Falls back silently to the registry text, which is
 * always accurate - an AI outage must never stop the class.
 */
async function enrich(plugin, prefix) {
  try {
    const { text } = await chat(
      `You are a friendly WhatsApp bot teacher. In 2 short sentences, explain when a normal person would ` +
        `use the command "${prefix}${plugin.name}" (${plugin.desc}). Then give one concrete example line ` +
        `starting with "${prefix}${plugin.name}". No markdown headers, under 45 words total.`,
      { maxTokens: 120, temperature: 0.7, noFallback: false }
    )
    return text.trim().slice(0, 400)
  } catch {
    return ''
  }
}

/** Compose the lesson message. Exported so it can be tested without a socket. */
export async function composeLesson({ plugin, number, total, cycle }, { period = 'morning', prefix = '.' } = {}) {
  const g = GREETING[period]
  const quiz = buildQuiz(plugin)
  const extra = await enrich(plugin, prefix)

  const body =
    `╭━━━〔 ${g.emoji} *${g.label}* 〕━━━╮\n` +
    `┃ 📚 Lesson *${number}* of *${total}*${cycle > 1 ? ` (term ${cycle})` : ''}\n` +
    `┃ 🏷️ Category: *${plugin.category}*\n` +
    `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
    `📖 *TODAY'S COMMAND*\n` +
    `▸ *${prefix}${plugin.name}*\n\n` +
    `💡 *What it does*\n${plugin.desc || 'No description provided.'}\n\n` +
    `⌨️ *How to use it*\n\`${plugin.usage || prefix + plugin.name}\`\n` +
    (plugin.alias?.length ? `\n🔁 *Also called:* ${plugin.alias.map((a) => prefix + a).join(', ')}\n` : '') +
    (plugin.group ? `\n👥 _Groups only._\n` : '') +
    (plugin.admin ? `\n🛡️ _Group admins only._\n` : '') +
    (extra ? `\n🧑‍🏫 *Teacher's note*\n${extra}\n` : '') +
    `\n━━━━━━━━━━━━━━━\n` +
    `❓ *POP QUIZ*\n${quiz.question}\n\n${quiz.options.join('\n')}\n\n` +
    `Answer with *${prefix}answer A* (or just A).\n` +
    `Say *${prefix}present* to be marked present.\n` +
    `_Register closes in ${await windowMinutes()} minutes._`

  return { body, quiz }
}

const windowMinutes = async () => (await state()).windowMin

/* ---------------------------- sessions ---------------------------- */

/** Start a class now. Returns the session, or null when there is nothing to teach. */
export async function startSession({ manual = false, slot = '' } = {}) {
  const st = await state()
  if (!st.group) throw new Error('No classroom set. Run .school on in the group you want to teach in.')

  const lesson = lessonAt(st.index)
  if (!lesson) throw new Error('No teachable commands found.')

  const period = slot ? periodOf(slot) : periodOf(nowHHMM(st.tz))
  const prefix = String(getVar('PREFIX') || '.').replace('multi', '.').replace('none', '')
  const { body, quiz } = await composeLesson(lesson, { period, prefix })

  const session = {
    id: `${dateKey(st.tz)}-${slot || 'manual'}-${lesson.number}`,
    group: st.group,
    command: lesson.plugin.name,
    answer: quiz.answer,
    startedAt: Date.now(),
    endsAt: Date.now() + st.windowMin * 60_000,
    manual
  }

  await saveState({ session, index: st.index + 1 })
  if (sock) await sock.sendMessage(st.group, { text: body })
  log.info(`School: taught .${lesson.plugin.name} (lesson ${lesson.number}/${lesson.total})`)
  return session
}

/** Mark someone present. Returns 'new' | 'already' | 'closed'. */
export async function markPresent(number, { correct = null } = {}) {
  const st = await state()
  const s = st.session
  if (!s || Date.now() > s.endsAt) return 'closed'

  const existing = await DB.attendance.findOne({ session: s.id, number })
  if (existing) {
    // upgrade an answer that came after the check-in
    if (correct !== null && existing.correct === null) {
      await DB.attendance.set({ session: s.id, number }, { correct })
      return 'graded'
    }
    return 'already'
  }

  await DB.attendance.set(
    { session: s.id, number },
    { group: s.group, command: s.command, at: Date.now(), correct }
  )
  return 'new'
}

/** Grade an A/B/C answer. */
export async function submitAnswer(number, letter) {
  const st = await state()
  const s = st.session
  if (!s || Date.now() > s.endsAt) return { ok: false, reason: 'closed' }

  const choice = String(letter || '').trim().toUpperCase().slice(0, 1)
  if (!['A', 'B', 'C'].includes(choice)) return { ok: false, reason: 'invalid' }

  const row = await DB.attendance.findOne({ session: s.id, number })
  if (row && row.correct !== null && row.correct !== undefined) return { ok: false, reason: 'answered' }

  const correct = choice === s.answer
  await DB.attendance.set(
    { session: s.id, number },
    { group: s.group, command: s.command, at: row?.at || Date.now(), correct }
  )

  const reward = Number(getVar('SCHOOL_REWARD')) || 0
  if (correct && reward) await addWallet(`${number}@s.whatsapp.net`, reward)
  return { ok: true, correct, answer: s.answer, command: s.command }
}

/**
 * Close the register: publish who came, who did not, and pay the attendees.
 * Absentees are tagged - that is the part that makes people show up.
 */
export async function closeSession() {
  const st = await state()
  const s = st.session
  if (!s) return null

  const rows = await DB.attendance.find({ session: s.id })
  const present = rows.map((r) => r.number)
  const correct = rows.filter((r) => r.correct === true).map((r) => r.number)

  let absent = []
  try {
    if (sock) {
      const meta = await sock.groupMetadata(s.group)
      const botNumber = String(sock.user?.id || '').split(':')[0].split('@')[0]
      absent = (meta.participants || [])
        .map((p) => String(p.id).split('@')[0])
        .filter((n) => n !== botNumber && !present.includes(n))
    }
  } catch {
    /* metadata can fail on huge groups - just skip the absent list */
  }

  const reward = Number(getVar('SCHOOL_REWARD')) || 0
  if (reward) for (const n of present) await addWallet(`${n}@s.whatsapp.net`, Math.ceil(reward / 2))

  const tagAbsent = st.tagAbsent && absent.length && absent.length <= 60
  const body =
    `╭━━━〔 📋 *REGISTER* 〕━━━╮\n` +
    `┃ 📖 Lesson: *.${s.command}*\n` +
    `┃ ✅ Present: *${present.length}*\n` +
    `┃ 🎯 Correct answers: *${correct.length}*\n` +
    `┃ ❌ Absent: *${absent.length}*\n` +
    `╰━━━━━━━━━━━━━━━━╯\n\n` +
    (present.length ? `✅ *In class*\n${present.map((n) => `@${n}`).join(' ')}\n\n` : '') +
    (tagAbsent
      ? `❌ *Missed today's class*\n${absent.map((n) => `@${n}`).join(' ')}\n\n_Catch up with the lesson above. Next class is on schedule._\n\n`
      : '') +
    `🏆 Leaderboard: *.classtop*   ·   📈 Your record: *.mygrades*`

  if (sock) {
    await sock
      .sendMessage(s.group, { text: body, mentions: [...present, ...(tagAbsent ? absent : [])].map((n) => `${n}@s.whatsapp.net`) })
      .catch((e) => log.error('School register failed:', e.message))
  }

  await saveState({ session: null })
  return { present, absent, correct }
}

/* ------------------------------ grades ----------------------------- */

export async function grades(number) {
  const rows = await DB.attendance.find({ number })
  const correct = rows.filter((r) => r.correct === true).length
  return {
    attended: rows.length,
    correct,
    accuracy: rows.length ? Math.round((correct / rows.length) * 100) : 0,
    points: rows.length + correct * 2
  }
}

export async function classTop(limit = 10) {
  const rows = await DB.attendance.all()
  const tally = new Map()
  for (const r of rows) {
    const t = tally.get(r.number) || { number: r.number, attended: 0, correct: 0 }
    t.attended++
    if (r.correct === true) t.correct++
    tally.set(r.number, t)
  }
  return [...tally.values()]
    .map((t) => ({ ...t, points: t.attended + t.correct * 2 }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
}

/* ------------------------------ clock ------------------------------ */

/** "HH:MM" in the school's timezone. */
export function nowHHMM(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(11, 16)
  }
}

/** "YYYY-MM-DD" in the school's timezone. */
export function dateKey(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/**
 * Which scheduled slot is due right now, if any.
 * A slot is due within a 2 minute grace period, so a tick that lands at
 * 08:01 still runs the 08:00 class instead of skipping the day.
 */
export function dueSlot(st, now = nowHHMM(st.tz), already = '') {
  const toMin = (s) => {
    const [h, m] = String(s).split(':').map(Number)
    return h * 60 + m
  }
  const current = toMin(now)
  for (const slot of String(st.times).split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!/^\d{1,2}:\d{2}$/.test(slot)) continue
    const diff = current - toMin(slot)
    if (diff >= 0 && diff <= 2 && !already.split(',').includes(slot)) return slot
  }
  return ''
}

/* ------------------------------- loop ------------------------------- */

export function attachSchool(socket) {
  sock = socket
  if (timer) return
  timer = setInterval(() => tick().catch((e) => log.error('School tick failed:', e.message)), TICK_MS)
  if (timer.unref) timer.unref()
}

export async function tick() {
  const st = await state()
  if (!st.enabled || !st.group) return

  // close a register whose window has expired (also recovers after a restart)
  if (st.session && Date.now() > st.session.endsAt) {
    await closeSession()
    return
  }
  if (st.session) return // class in progress

  const today = dateKey(st.tz)
  const [day, ran = ''] = String(st.lastSlots || '').split(':').length > 1
    ? [String(st.lastSlots).split(':')[0], String(st.lastSlots).slice(String(st.lastSlots).indexOf(':') + 1)]
    : [today, '']
  const alreadyToday = day === today ? ran : ''

  const slot = dueSlot(st, nowHHMM(st.tz), alreadyToday)
  if (!slot) return

  await saveState({ lastSlots: `${today}:${[alreadyToday, slot].filter(Boolean).join(',')}` })
  await startSession({ slot })
}

export default {
  state, saveState, syllabus, lessonAt, buildQuiz, composeLesson,
  startSession, markPresent, submitAnswer, closeSession, grades, classTop,
  attachSchool, tick, dueSlot, nowHHMM, dateKey
}
