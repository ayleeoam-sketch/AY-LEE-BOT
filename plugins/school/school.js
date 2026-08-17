import {
  state, saveState, syllabus, lessonAt, startSession, markPresent, submitAnswer,
  closeSession, grades, classTop, nowHHMM, dateKey,
  answerQuestion, useQuestionCredit
} from '../../src/lib/school.js'
import DB from '../../src/lib/database.js'
import { getVar } from '../../src/lib/vars.js'

/**
 * VENOM SCHOOL — classroom controls.
 *
 * The bot teaches one of its own commands three times a day, quizzes the
 * group, keeps a register and tags whoever skipped. See src/lib/school.js.
 */

const numberOf = (jid) => String(jid).split('@')[0].split(':')[0]

export default [
  {
    name: 'school',
    alias: ['class', 'classroom'],
    category: 'CONFIG',
    desc: 'Turn the daily command class on or off in this group',
    usage: '.school on  |  .school off  |  .school status',
    owner: true,
    group: true,
    async run({ m, args, prefix }) {
      const action = (args[0] || 'status').toLowerCase()
      const st = await state()

      if (action === 'on' || action === 'start') {
        await saveState({ group: m.chat, enabled: true })
        const all = syllabus()
        return m.reply(
          `🎓 *VENOM SCHOOL IS IN SESSION*\n\n` +
            `┃ 🏫 Classroom: *${m.groupName || 'this group'}*\n` +
            `┃ 📚 Syllabus: *${all.length}* commands\n` +
            `┃ 🕒 Classes: *${st.times}* (${st.tz})\n` +
            `┃ ⏳ Register open: *${st.windowMin} min* per class\n\n` +
            `Every class I teach one command, ask a question, and take attendance. ` +
            `Whoever misses it gets tagged in the register.\n\n` +
            `*Controls*\n` +
            `▸ ${prefix}classtime 08:00,14:00,20:00\n` +
            `▸ ${prefix}lesson — teach one right now\n` +
            `▸ ${prefix}syllabus — progress\n` +
            `▸ ${prefix}school off — dismiss the class`
        )
      }

      if (action === 'off' || action === 'stop') {
        await saveState({ enabled: false, session: null })
        return m.reply(`🎓 Class dismissed. Turn it back on with *${prefix}school on*.`)
      }

      const all = syllabus()
      const lesson = lessonAt(st.index)
      await m.reply(
        `╭━━━〔 🎓 *SCHOOL* 〕━━━╮\n` +
          `┃ ${st.enabled ? '🟢 In session' : '🔴 Dismissed'}\n` +
          `┃ 🏫 Classroom: ${st.group ? (st.group === m.chat ? 'this group' : st.group.split('@')[0]) : 'not set'}\n` +
          `┃ 🕒 Times: ${st.times} (${st.tz})\n` +
          `┃ 🕰️ Now: ${nowHHMM(st.tz)} · ${dateKey(st.tz)}\n` +
          `┃ 📚 Next: *.${lesson?.plugin.name || '—'}* (${lesson?.number || 0}/${all.length})\n` +
          `┃ 🔔 Class running: ${st.session ? 'yes' : 'no'}\n` +
          `╰━━━━━━━━━━━━━━━━╯\n\n_${prefix}school on / off_`
      )
    }
  },
  {
    name: 'classtime',
    alias: ['schooltime', 'settimetable'],
    category: 'CONFIG',
    desc: 'Set the daily class times',
    usage: '.classtime 08:00,14:00,20:00',
    owner: true,
    async run({ m, args, prefix }) {
      const raw = (args[0] || '').trim()
      const slots = raw.split(',').map((s) => s.trim()).filter(Boolean)
      const valid = slots.length && slots.every((s) => /^\d{1,2}:\d{2}$/.test(s))

      if (!valid) {
        const st = await state()
        return m.reply(
          `🕒 *Usage:* ${prefix}classtime 08:00,14:00,20:00\n\n` +
            `Currently: *${st.times}* (${st.tz})\n` +
            `Local time right now: *${nowHHMM(st.tz)}*\n\n` +
            `Change the zone with *${prefix}classtz Africa/Lagos*`
        )
      }
      await saveState({ times: slots.join(',') })
      await m.reply(`🕒 Classes now run at *${slots.join(', ')}*.`)
    }
  },
  {
    name: 'classtz',
    alias: ['schooltz', 'classtimezone'],
    category: 'CONFIG',
    desc: 'Set the timezone the class times follow',
    usage: '.classtz Africa/Lagos',
    owner: true,
    async run({ m, args, prefix }) {
      const tz = (args[0] || '').trim()
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(new Date())
      } catch {
        return m.reply(`🌍 Unknown timezone. Try *${prefix}classtz Africa/Lagos* or *${prefix}classtz Europe/London*.`)
      }
      await saveState({ tz })
      await m.reply(`🌍 Timezone set to *${tz}*. Local time is now *${nowHHMM(tz)}*.`)
    }
  },
  {
    name: 'lesson',
    alias: ['teach', 'classnow'],
    category: 'CONFIG',
    desc: 'Run a class right now',
    usage: '.lesson',
    owner: true,
    cooldown: 30,
    async run({ m }) {
      try {
        const st = await state()
        if (!st.group) await saveState({ group: m.chat, enabled: true })
        if (st.session) return m.reply('🎓 A class is already running — let the register close first.')
        await startSession({ manual: true })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'endclass',
    alias: ['closeregister', 'dismiss'],
    category: 'CONFIG',
    desc: 'Close the register early',
    usage: '.endclass',
    owner: true,
    async run({ m }) {
      const st = await state()
      if (!st.session) return m.reply('🎓 No class is running.')
      await closeSession()
    }
  },
  {
    name: 'present',
    alias: ['here', 'attend'],
    category: 'USER',
    desc: 'Mark yourself present in class',
    usage: '.present',
    async run({ m }) {
      const res = await markPresent(numberOf(m.sender))
      if (res === 'closed') return m.reply('🎓 No class is running right now. Check *.school* for the timetable.')
      if (res === 'already') return m.reply('✅ You are already marked present.')
      await m.reply(`✅ Marked present, @${numberOf(m.sender)}. Now answer the question for bonus points.`, )
    }
  },
  {
    name: 'answer',
    alias: ['ans'],
    category: 'USER',
    desc: 'Answer the class question',
    usage: '.answer A',
    async run({ m, args, prefix }) {
      const res = await submitAnswer(numberOf(m.sender), args[0])
      if (!res.ok) {
        const why = {
          closed: '🎓 No class is running right now.',
          invalid: `📝 Answer with a letter: *${prefix}answer A*`,
          answered: '📝 You already answered this one.'
        }
        return m.reply(why[res.reason] || '❌ That did not work.')
      }
      await m.reply(
        res.correct
          ? `✅ *Correct!* *.${res.command}* it is. Points added — see *${prefix}mygrades*.`
          : `❌ Not quite. The right answer was *${res.answer}*. You still get credit for showing up.`
      )
    }
  },
  {
    name: 'attendance',
    alias: ['register', 'roll'],
    category: 'USER',
    desc: "Today's register",
    usage: '.attendance',
    async run({ m, prefix }) {
      const st = await state()
      const today = dateKey(st.tz)
      const rows = (await DB.attendance.all()).filter((r) => String(r.session || '').startsWith(today))
      if (!rows.length) return m.reply(`📋 Nobody has attended a class today yet.\n\n_Timetable: ${st.times} (${st.tz})_`)

      const bySession = new Map()
      for (const r of rows) {
        const list = bySession.get(r.command) || []
        list.push(r)
        bySession.set(r.command, list)
      }
      const body = [...bySession.entries()]
        .map(([cmd, list]) => `📖 *.${cmd}* — ${list.length} present, ${list.filter((r) => r.correct).length} correct`)
        .join('\n')

      await m.reply(`╭━━━〔 📋 *TODAY* 〕━━━╮\n${body}\n╰━━━━━━━━━━━━━━╯\n\n_Leaderboard: ${prefix}classtop_`)
    }
  },
  {
    name: 'classtop',
    alias: ['schooltop', 'topstudents', 'gradebook'],
    category: 'USER',
    desc: 'Best students',
    usage: '.classtop',
    cooldown: 10,
    async run({ m, prefix }) {
      const rows = await classTop(10)
      if (!rows.length) return m.reply(`🏆 No attendance recorded yet.\n\n_Classes: ${(await state()).times}_`)
      const medal = ['🥇', '🥈', '🥉']
      const body = rows
        .map((r, i) => `${medal[i] || `${i + 1}.`} @${r.number} — *${r.points}* pts _(${r.attended} classes, ${r.correct} correct)_`)
        .join('\n')
      await m.reply({
        text: `╭━━━〔 🏆 *TOP STUDENTS* 〕━━━╮\n${body}\n╰━━━━━━━━━━━━━━━━━╯\n\n_1 pt per class · 2 pts per correct answer · ${prefix}mygrades_`,
        mentions: rows.map((r) => `${r.number}@s.whatsapp.net`)
      })
    }
  },
  {
    name: 'mygrades',
    alias: ['myclass', 'report', 'reportcard'],
    category: 'USER',
    desc: 'Your class record',
    usage: '.mygrades',
    async run({ m }) {
      const g = await grades(numberOf(m.sender))
      const rank =
        g.accuracy >= 90 ? '🌟 Star student' :
          g.accuracy >= 70 ? '📗 Doing well' :
            g.accuracy >= 40 ? '📙 Getting there' :
              g.attended ? '📕 Needs practice' : '🆕 Not enrolled yet'

      await m.reply(
        `╭━━━〔 📈 *REPORT CARD* 〕━━━╮\n` +
          `┃ 🎓 Classes attended: *${g.attended}*\n` +
          `┃ ✅ Correct answers: *${g.correct}*\n` +
          `┃ 🎯 Accuracy: *${g.accuracy}%*\n` +
          `┃ 🏅 Points: *${g.points}*\n` +
          `┃ ${rank}\n` +
          `╰━━━━━━━━━━━━━━━━━╯`
      )
    }
  },
  {
    name: 'syllabus',
    alias: ['curriculum', 'lessons'],
    category: 'USER',
    desc: 'What the class is working through',
    usage: '.syllabus',
    cooldown: 10,
    async run({ m, prefix }) {
      const st = await state()
      const all = syllabus()
      const done = st.index % all.length
      const bar = '█'.repeat(Math.round((done / all.length) * 18)).padEnd(18, '░')
      const next = [0, 1, 2].map((i) => lessonAt(st.index + i)).filter(Boolean)

      await m.reply(
        `╭━━━〔 📚 *SYLLABUS* 〕━━━╮\n` +
          `┃ 📖 Total lessons: *${all.length}*\n` +
          `┃ ✅ Covered: *${done}*\n` +
          `┃ ${bar} ${Math.round((done / all.length) * 100)}%\n` +
          `┃ 🔁 Term: *${Math.floor(st.index / all.length) + 1}*\n` +
          `╰━━━━━━━━━━━━━━━━╯\n\n` +
          `*Coming up*\n${next.map((l, i) => `${i === 0 ? '▶️' : '▫️'} .${l.plugin.name} — ${l.plugin.desc}`).join('\n')}\n\n` +
          `_Timetable: ${st.times} (${st.tz}) · ${prefix}classtop_`
      )
    }
  },

  {
    name: 'askteacher',
    alias: ['qn', 'question', 'teacher'],
    category: 'USER',
    desc: 'Ask the bot a question about its commands',
    usage: '.askteacher how do I download a song?',
    cooldown: 5,
    async run({ m, text, prefix }) {
      const q = (text || m.quoted?.text || '').trim()
      if (!q) {
        return m.reply(
          `🧑‍🏫 *Ask me anything about this bot*\n\n` +
            `▸ ${prefix}askteacher how do I make a sticker?\n` +
            `▸ ${prefix}askteacher what does .afk do?\n\n` +
            `_During class you can just end a message with a question mark and I will answer._`
        )
      }

      const st = await state()
      const inClass = st.session && Date.now() <= st.session.endsAt && m.chat === st.session.group

      // the budget only applies inside a live class; outside it, ask away
      if (inClass) {
        const credit = await useQuestionCredit(numberOf(m.sender))
        if (!credit.ok && credit.reason === 'limit') {
          return m.reply(
            `🧑‍🏫 That is your *${credit.cap}* questions for this class, @${numberOf(m.sender)} — ` +
              `let the others have a turn. Ask again after the register closes.`
          )
        }
        await markPresent(numberOf(m.sender))
      }

      await m.react('🧑‍🏫')
      const res = await answerQuestion(q, {
        prefix,
        lessonName: inClass ? st.session.command : ''
      })
      await m.reply(
        `🧑‍🏫 *TEACHER*\n\n${res.text}` +
          (res.source === 'registry' ? `\n\n_(answered from my command list — no AI key set)_` : '')
      )
      await m.react('✅')
    }
  },
  {
    name: 'classlock',
    alias: ['classhush', 'lockclass'],
    category: 'CONFIG',
    desc: 'Hush the group while the lesson is read',
    usage: '.classlock on 2  |  .classlock off',
    owner: true,
    async run({ m, args, prefix }) {
      const st = await state()
      const action = (args[0] || '').toLowerCase()

      if (action !== 'on' && action !== 'off') {
        return m.reply(
          `🔇 *Class hush* — currently *${st.lock ? `on, ${st.lockMin} min` : 'off'}*\n\n` +
            `When on, I mute the group the moment the lesson lands so it is not buried under chat, ` +
            `then unmute and announce that the floor is open. The register and the quiz run on the ` +
            `open floor — students must be able to talk to be marked present.\n\n` +
            `▸ *${prefix}classlock on 2* — hush for 2 minutes\n` +
            `▸ *${prefix}classlock off*\n\n` +
            `_I must be a group admin. If I am not, class still runs, just without the hush._`
        )
      }

      const minutes = Math.min(10, Math.max(1, parseInt(args[1]) || st.lockMin || 2))
      await saveState({ lock: action === 'on', lockMin: minutes })
      await m.reply(
        action === 'on'
          ? `🔇 Hush on. I will mute the group for *${minutes} min* at the start of each class, then open the floor.`
          : `🔊 Hush off. The group stays open for the whole class.`
      )
    }
  },
  {
    name: 'classquestions',
    alias: ['qlimit', 'setqlimit'],
    category: 'CONFIG',
    desc: 'How many questions each student may ask per class',
    usage: '.classquestions 3',
    owner: true,
    async run({ m, args, prefix }) {
      const st = await state()
      const n = parseInt(args[0])
      if (!Number.isFinite(n) || n < 0 || n > 20) {
        return m.reply(
          `❓ *Usage:* ${prefix}classquestions <0-20>\n\nCurrently *${st.maxQuestions}* per student per class.\n\n` +
            `_This is what stops one person burning through your AI key in a single lesson. 0 disables questions during class._`
        )
      }
      await saveState({ maxQuestions: n })
      await m.reply(`❓ Students may now ask *${n}* question${n === 1 ? '' : 's'} each per class.`)
    }
  },

  /* ----------------------------------------------------------------
   * Passive attendance: anyone who talks in the classroom while a class
   * is running is in the room, so mark them present. Bare A/B/C is taken
   * as an answer, because in a real class nobody types ".answer".
   * ---------------------------------------------------------------- */
  {
    name: 'school-attendance-hook',
    async before({ m }) {
      try {
        if (!m.isGroup || m.fromMe) return
        const st = await state()
        if (!st.enabled || !st.session || m.chat !== st.session.group) return
        if (Date.now() > st.session.endsAt) return

        const number = numberOf(m.sender)
        const body = String(m.body || '').trim()

        // a bare letter is an answer
        if (/^[abc]$/i.test(body)) {
          const res = await submitAnswer(number, body)
          if (res.ok) {
            await m.reply(
              res.correct
                ? `✅ Correct, @${number}!`
                : `❌ Close, @${number} — it was *${res.answer}*. Attendance still counted.`
            )
          }
          return
        }

        await markPresent(number)

        /*
         * A real class has questions. Anything ending in "?" during the
         * lesson gets a teacher's answer - no command to remember, which is
         * the whole point. Commands are skipped (they answer themselves),
         * and each student has a per-class budget so one person cannot
         * empty the AI key.
         */
        const prefix = String(getVar('PREFIX') || '.')
        if (body.endsWith('?') && body.length > 10 && !body.startsWith(prefix)) {
          const credit = await useQuestionCredit(number)
          if (!credit.ok) {
            if (credit.reason === 'limit') {
              await m.reply(`🧑‍🏫 @${number}, that is your ${credit.cap} questions for this class. Others first — ask again after the register.`)
            }
            return
          }
          await m.react('🧑‍🏫').catch(() => {})
          const res = await answerQuestion(body, { prefix, lessonName: st.session.command })
          await m.reply(`🧑‍🏫 *TEACHER*\n\n${res.text}`)
        }
      } catch {
        /* attendance must never break message handling */
      }
    }
  }
]
