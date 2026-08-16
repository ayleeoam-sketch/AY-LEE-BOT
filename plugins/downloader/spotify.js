import { musicAuto, hasYtdlp, isUrl, fmtDuration } from '../../src/lib/downloader.js'
import { getJson, getBuffer, http } from '../../src/lib/api.js'

/**
 * Spotify -> WhatsApp, keyless.
 *
 * There is no official free Spotify download API, so we do what every
 * working bot does: read the track metadata (oEmbed + the page's schema.org
 * JSON, both keyless), then pull the same song off YouTube with the existing
 * audio pipeline. If spotify.com is unreachable we silently degrade to a
 * plain search - the download still happens.
 */

const TRACK_URL = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{10,})/i

/** Best-effort metadata for a Spotify track URL. Never throws. */
async function spotifyMeta(url, id) {
  const meta = { title: null, artist: null, thumbnail: null }

  // 1) oEmbed: instant, keyless, gives title + album art
  try {
    const d = await getJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`)
    meta.title = d.title || null
    meta.thumbnail = d.thumbnail_url || null
  } catch {}

  // 2) the track page ships schema.org JSON-LD with the artist name
  try {
    const { data: html } = await http.get(`https://open.spotify.com/track/${id}`, {
      responseType: 'text',
      timeout: 20_000
    })
    const raw = String(html).match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)?.[1]
    if (raw) {
      const ld = JSON.parse(raw)
      meta.title = meta.title || ld.name || null
      const artists = ld.byArtist
      meta.artist = (Array.isArray(artists) ? artists : [artists]).filter(Boolean).map((a) => a.name).join(', ') || null
    }
  } catch {}

  return meta
}

const notInstalled = (m) =>
  m.reply('⚠️ yt-dlp is not installed.\n\nRun *npm run setup* in the bot folder, then try again.')

export default [
  {
    name: 'spotify',
    alias: ['spotdl', 'sp', 'spotifydl'],
    category: 'DOWNLOADER',
    desc: 'Download a song from a Spotify link (or by name) as audio',
    usage: '.spotify <spotify link>  |  .spotify davido unavailable',
    cooldown: 25,
    async run({ m, text }) {
      if (!hasYtdlp()) return notInstalled(m)
      const input = text || m.quoted?.text
      if (!input) {
        return m.reply(
          '🎧 Send a Spotify track link or a song name:\n' +
            '*.spotify https://open.spotify.com/track/...*\n' +
            '*.spotify davido unavailable*'
        )
      }

      await m.react('⏳')
      try {
        let query = input
        let card = null

        const match = String(input).match(TRACK_URL)
        if (isUrl(input) && /spotify\.com/i.test(input) && !match) {
          return m.reply('❌ That is a Spotify link but not a *track* link. Albums/playlists are not supported yet.')
        }

        if (match) {
          const meta = await spotifyMeta(input, match[1])
          card = meta.thumbnail ? await getBuffer(meta.thumbnail).catch(() => null) : null
          query = meta.artist ? `${meta.artist} - ${meta.title}` : meta.title || input

          const caption =
            `╭━━━〔 *SPOTIFY* 〕━━━╮\n` +
            `┃ 🎵 ${meta.title || 'Unknown title'}\n` +
            `┃ 👤 ${meta.artist || 'Unknown artist'}\n` +
            `╰━━━━━━━━━━━━━━━╯\n\n_Finding and downloading..._`
          if (card) {
            await m.reply({ image: card, caption }).catch(() => m.reply(caption))
          } else {
            await m.reply(caption)
          }

          if (!meta.title) {
            await m.react('❌')
            return m.reply(
              '❌ Could not read that Spotify track - spotify.com is unreachable or rate-limiting.\n\n' +
                `_Workaround: use *.music ${meta.artist || 'artist'} - song title* - it searches SoundCloud, Audiomack and YouTube._`
            )
          }
        }

        /*
         * Match the Spotify track on any music source. YouTube first (best
         * match quality for mainstream tracks), SoundCloud and Audiomack
         * after - they don't bot-check server IPs, so this survives on hosts
         * where plain .play gets refused.
         */
        const r = await musicAuto(query, { order: ['youtube', 'soundcloud', 'audiomack'] })
        await m.reply({
          audio: r.buffer,
          mimetype: 'audio/mpeg',
          fileName: `${r.title.replace(/[^\w\s-]/g, '').slice(0, 60)}.mp3`
        })
        if (r.source !== 'YouTube') await m.reply(`_Matched on ${r.source} (YouTube was unavailable)._`)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'spotifyinfo',
    alias: ['spinfo'],
    category: 'DOWNLOADER',
    desc: 'Show details about a Spotify track link',
    usage: '.spotifyinfo <spotify link>',
    cooldown: 8,
    async run({ m, text }) {
      const input = text || m.quoted?.text
      const match = String(input || '').match(TRACK_URL)
      if (!match) return m.reply('🎧 Usage: *.spotifyinfo https://open.spotify.com/track/...*')

      await m.react('⏳')
      try {
        const meta = await spotifyMeta(input, match[1])
        if (!meta.title) return m.reply('❌ Could not read that track. Spotify may be rate-limiting - try again.')

        const caption =
          `╭━━━〔 *SPOTIFY TRACK* 〕━━━╮\n` +
          `┃ 🎵 ${meta.title}\n` +
          `┃ 👤 ${meta.artist || 'Unknown artist'}\n` +
          `┃ 🔗 ${String(input).split('?')[0].slice(0, 60)}\n` +
          `╰━━━━━━━━━━━━━━━╯\n\n` +
          `💡 Download it with *.spotify ${input}*`

        if (meta.thumbnail) {
          const img = await getBuffer(meta.thumbnail).catch(() => null)
          if (img) {
            await m.reply({ image: img, caption })
            return m.react('✅')
          }
        }
        await m.reply(caption)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
