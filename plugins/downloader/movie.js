import fs from 'fs'
import { getJson, getBuffer } from '../../src/lib/api.js'
import {
  findVideo,
  parseMovieQuery,
  archiveProvider,
  ytdlpProvider
} from '../../src/lib/moviefind.js'
import {
  youtubeSearch,
  ytdlpDownload,
  hasYtdlp,
  isUrl,
  fmtDuration
} from '../../src/lib/downloader.js'

/**
 * .movie - say what you want, get the video.
 *
 * The user types it the way they'd say it out loud and the bot works the
 * rest out - title, season, episode, year, quality:
 *
 *   .movie naruto epi 1
 *   .movie external fragrance epi 1
 *   .movie interstellar
 *   .movie the office s02e05
 *   .movie night of the living dead 1968 720p
 *   .movie <any video link>          (1800+ sites via yt-dlp)
 *
 * Sources are tried in order, keyless first: Archive.org's public-domain
 * catalogue, then yt-dlp for links and legitimately free full uploads.
 *
 * Deliberately NOT included: piracy streaming sites. This searches legal
 * free catalogues, and says so plainly when a title is not on one, rather
 * than shipping something that breaks (and gets the host banned) in a week.
 */

/** WhatsApp refuses documents over ~64MB; keep a little headroom. */
const MAX_MB = 64

const HELP = (prefix) => `🎬 *MOVIE / EPISODE FINDER*

Just say what you want:

 • *${prefix}movie naruto epi 1*
 • *${prefix}movie interstellar*
 • *${prefix}movie the office s02e05*
 • *${prefix}movie night of the living dead 1968*
 • *${prefix}movie <any video link>*

*It understands:*
 ▸ episodes — \`epi 1\` \`ep 1\` \`episode 1\` \`s02e05\` \`2x05\` \`part 3\`
 ▸ a year — \`(1968)\` or just \`1968\`
 ▸ quality — \`720p\` \`1080p\`

_Searches free, legal catalogues (Archive.org + friends). Blockbusters still
in cinemas will not be there — that is a licensing wall, not a bug._`

/** A direct file URL we can stream straight to WhatsApp. */
async function sendDirect(m, found, query) {
  const { file, candidate } = found
  if (file.tooBig) {
    throw new Error(
      `Found *${candidate.title}* but the file is ${file.mb}MB - over WhatsApp's ${MAX_MB}MB limit.\n\n` +
        `Watch or grab it here:\n${candidate.page}`
    )
  }

  const buffer = await getBuffer(file.url, { timeout: 180_000, maxContentLength: MAX_MB * 1024 * 1024 })
  if (!buffer?.length) throw new Error('The source returned an empty file.')

  const caption =
    `╭━━━〔 *MOVIE* 〔${file.provider}〕━━━╮\n` +
    `┃ 🎬 ${candidate.title}\n` +
    (candidate.year ? `┃ 📅 ${candidate.year}\n` : '') +
    (query.episode !== null ? `┃ 📺 Episode ${query.episode}${query.season !== null ? ` · Season ${query.season}` : ''}\n` : '') +
    `┃ 💾 ${(buffer.length / 1048576).toFixed(1)}MB\n` +
    `╰━━━━━━━━━━━━━━━━━━━╯`

  await m.reply({
    video: buffer,
    caption,
    fileName: `${String(candidate.title).replace(/[^\w\s-]/g, '').slice(0, 60) || 'movie'}.mp4`,
    mimetype: 'video/mp4'
  })
}

/** A page URL yt-dlp has to download for us (YouTube and 1800+ others). */
async function sendViaYtdlp(m, url, label) {
  if (!hasYtdlp()) {
    throw new Error('yt-dlp is not installed.\n\nRun *npm run setup* in the bot folder, then try again.')
  }
  const { buffer } = await ytdlpDownload(url, {
    format: 'best[height<=480][ext=mp4]/best[ext=mp4]/best',
    maxMb: MAX_MB
  })
  await m.reply({
    video: buffer,
    caption: `🎬 *${label}*\n💾 ${(buffer.length / 1048576).toFixed(1)}MB`,
    fileName: `${String(label).replace(/[^\w\s-]/g, '').slice(0, 60) || 'video'}.mp4`,
    mimetype: 'video/mp4'
  })
}

export default {
  name: 'movie',
  alias: ['film', 'episode', 'ep', 'watch', 'cinema'],
  category: 'DOWNLOADER',
  desc: 'Find and download a movie or episode by name — "naruto epi 1", "interstellar", or any video link',
  usage: '.movie naruto epi 1',
  cooldown: 45,
  async run({ m, text, prefix }) {
    const input = (text || m.quoted?.text || '').trim()
    if (!input) return m.reply(HELP(prefix))

    /* a pasted link goes straight to yt-dlp - it supports 1800+ sites */
    if (isUrl(input)) {
      await m.react('⏳')
      try {
        await sendViaYtdlp(m, input, 'Video')
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
      return
    }

    const query = parseMovieQuery(input)
    if (!query.title) return m.reply(HELP(prefix))

    await m.react('🔍')
    const label =
      `🔎 Searching for *${query.title}*` +
      (query.episode !== null ? ` — episode ${query.episode}` : '') +
      (query.year ? ` (${query.year})` : '') +
      '...\n\n_Checking free catalogues, this can take a moment._'
    await m.reply(label)

    try {
      const found = await findVideo(input, {
        maxMb: MAX_MB,
        providers: [archiveProvider, ytdlpProvider],
        fetchJson: getJson,
        youtubeSearch: hasYtdlp() ? youtubeSearch : null
      })

      if (found.file.direct === false) {
        // a page URL (YouTube etc) - hand it to yt-dlp
        await sendViaYtdlp(m, found.file.url, found.candidate.title)
      } else {
        await sendDirect(m, found, found.query)
      }

      if (found.alternatives?.length) {
        await m.reply(
          `🎞️ *Other matches*\n\n${found.alternatives
            .map((a, i) => `*${i + 1}.* ${a.title}`)
            .join('\n')}\n\n_Not the right one? Add the year: *${prefix}movie ${query.title} 1968*_`
        )
      }
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(
        `❌ ${e.message}\n\n` +
          `_Tip: try the exact title, or add a year — *${prefix}movie ${query.title} 2014*_`
      )
    }
  }
}
