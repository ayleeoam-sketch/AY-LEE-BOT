import { getJson, getBuffer, race, http } from '../../src/lib/api.js'

export default [
  {
    name: 'websearch',
    alias: ['google', 'search', 'ddg'],
    category: 'SEARCH',
    desc: 'Search the web',
    usage: '.websearch nodejs streams',
    cooldown: 8,
    async run({ m, text }) {
      if (!text) return m.reply('🔎 Usage: *.websearch how to cook jollof rice*')
      await m.react('🔎')
      try {
        const d = await getJson(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(text)}&format=json&no_html=1&skip_disambig=1`
        )
        let out = `🔎 *WEB SEARCH*\n_${text}_\n\n`

        if (d.AbstractText) {
          out += `📄 *${d.Heading || text}*\n${d.AbstractText}\n`
          if (d.AbstractURL) out += `🔗 ${d.AbstractURL}\n`
        }

        const topics = (d.RelatedTopics || [])
          .filter((t) => t.Text && t.FirstURL)
          .slice(0, 6)

        if (topics.length) {
          out += `\n*Related:*\n`
          out += topics.map((t, i) => `${i + 1}. ${t.Text.slice(0, 110)}\n   🔗 ${t.FirstURL}`).join('\n')
        }

        if (!d.AbstractText && !topics.length) {
          await m.react('❌')
          return m.reply(
            `❌ No instant answer for "${text}".\n\n` +
              `_DuckDuckGo's free API only returns encyclopedia-style results, not full web listings._`
          )
        }

        await m.reply(out.slice(0, 3500))
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'img',
    alias: ['image', 'imagesearch'],
    category: 'SEARCH',
    desc: 'Find images by keyword',
    usage: '.img sunset',
    cooldown: 10,
    async run({ m, text, args }) {
      if (!text) return m.reply('🖼️ Usage: *.img sunset*\n\nAdd a count: *.img sunset 3*')
      const last = parseInt(args[args.length - 1])
      const count = Number.isFinite(last) && last >= 1 && last <= 5 ? last : 2
      const query = Number.isFinite(last) && last <= 5 ? args.slice(0, -1).join(' ') : text
      if (!query) return m.reply('🖼️ Usage: *.img sunset 3*')

      await m.react('🖼️')
      try {
        let sent = 0
        for (let i = 0; i < count; i++) {
          // loremflickr serves keyword-matched photos with no API key
          const url = `https://loremflickr.com/800/600/${encodeURIComponent(query.replace(/\s+/g, ','))}?lock=${Date.now() + i}`
          try {
            const buffer = await getBuffer(url, { timeout: 30_000 })
            if (buffer.length > 3000) {
              await m.reply({ image: buffer, caption: i === 0 ? `🖼️ *${query}*` : undefined })
              sent++
            }
          } catch {}
        }
        if (!sent) throw new Error('no images came back for that keyword')
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'wallpaper',
    alias: ['wp', 'randomwp'],
    category: 'SEARCH',
    desc: 'Random high quality wallpaper',
    usage: '.wallpaper [keyword]',
    cooldown: 8,
    async run({ m, text }) {
      await m.react('🖼️')
      try {
        const url = text
          ? `https://loremflickr.com/1080/1920/${encodeURIComponent(text.replace(/\s+/g, ','))}?lock=${Date.now()}`
          : `https://picsum.photos/1080/1920?random=${Date.now()}`
        const buffer = await getBuffer(url, { timeout: 40_000 })
        await m.reply({ image: buffer, caption: `🖼️ *Wallpaper*${text ? ` — ${text}` : ''}` })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'gitclone',
    alias: ['clonerepo'],
    category: 'DOWNLOADER',
    desc: 'Download a GitHub repo as a zip',
    usage: '.gitclone https://github.com/user/repo',
    cooldown: 20,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      const match = String(url || '').match(/github\.com\/([\w.-]+)\/([\w.-]+)/i)
      if (!match) return m.reply('📦 Usage: *.gitclone https://github.com/user/repo*')
      const [, user, repoRaw] = match
      const repo = repoRaw.replace(/\.git$/, '')

      await m.react('📦')
      try {
        const info = await getJson(`https://api.github.com/repos/${user}/${repo}`)
        const branch = info.default_branch || 'main'
        const zipUrl = `https://api.github.com/repos/${user}/${repo}/zipball/${branch}`

        const buffer = await getBuffer(zipUrl, { timeout: 120_000 })
        const mb = buffer.length / 1048576
        if (mb > 90) {
          await m.react('❌')
          return m.reply(`❌ That repo is ${mb.toFixed(1)}MB — too large to send over WhatsApp.`)
        }

        await m.reply({
          document: buffer,
          mimetype: 'application/zip',
          fileName: `${repo}-${branch}.zip`,
          caption:
            `📦 *${info.full_name}*\n` +
            `⭐ ${info.stargazers_count?.toLocaleString() || 0} stars\n` +
            `🍴 ${info.forks_count?.toLocaleString() || 0} forks\n` +
            `💾 ${mb.toFixed(2)} MB\n` +
            `🌿 Branch: ${branch}`
        })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'mediafire',
    alias: ['mfire'],
    category: 'DOWNLOADER',
    desc: 'Download a MediaFire file',
    usage: '.mediafire <link>',
    cooldown: 20,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      if (!/mediafire\.com/i.test(String(url || ''))) {
        return m.reply('📁 Send a MediaFire link:\n*.mediafire https://www.mediafire.com/file/...*')
      }
      await m.react('📁')
      try {
        const { data: page } = await http.get(url, { timeout: 30_000, responseType: 'text' })
        const html = String(page)
        const direct =
          html.match(/href="((?:https?:)\/\/download[^"]+)"/)?.[1] ||
          html.match(/aria-label="Download file"\s+href="([^"]+)"/)?.[1]
        if (!direct) throw new Error('could not find the download link — the file may be private or removed')

        const name = html.match(/<div class="filename">([^<]+)<\/div>/)?.[1]?.trim() || 'file'
        const sizeText = html.match(/\(([\d.]+\s*[KMG]B)\)/)?.[1] || 'unknown'

        const buffer = await getBuffer(direct, { timeout: 180_000 })
        const mb = buffer.length / 1048576
        if (mb > 90) {
          await m.react('❌')
          return m.reply(`❌ That file is ${mb.toFixed(1)}MB — over WhatsApp's limit.\n\n🔗 Direct link:\n${direct}`)
        }
        await m.reply({
          document: buffer,
          fileName: name,
          mimetype: 'application/octet-stream',
          caption: `📁 *${name}*\n💾 ${sizeText}`
        })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ MediaFire download failed: ${e.message}`)
      }
    }
  }
]
