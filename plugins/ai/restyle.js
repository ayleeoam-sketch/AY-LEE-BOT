/**
 * Photo restyler - send a photo, get it back in different styles & poses.
 *
 *   reply to a photo with:  .restyle anime
 *   or caption a photo:      (send image with caption) .restyle peace
 *   free-form:               .restyle make me a medieval knight
 *   see everything:          .restyle
 *
 * Styles & poses live in src/lib/restyle.js. Editing is done by Gemini when
 * a GEMINI_API_KEY is set, otherwise by pollinations (keyless). Nudity /
 * undressing edits are refused before any request is made.
 */
import { STYLES, POSES, resolveInstruction, isBanned, transformImage } from '../../src/lib/restyle.js'

const names = (map) => Object.keys(map).map((n) => `\`${n}\``).join(' · ')

const menuText = () =>
  `🎨 *RESTYLE*\n\nSend a photo and reply to it (or caption it) with:\n*.restyle <style|pose|instruction>*\n\n` +
  `✨ *STYLES*\n${names(STYLES)}\n\n` +
  `🕺 *POSES*\n${names(POSES)}\n\n` +
  `✍️ Or anything you imagine: *.restyle make me look like a rockstar*\n\n` +
  `_A free GEMINI_API_KEY gives the best edits (_.setkey gemini <key>_); without one the keyless engine is used._`

export default [
  {
    name: 'restyle',
    alias: ['vary', 'editimg', 'transform', 'repose', 'restyler'],
    category: 'AI',
    desc: 'Re-style or re-pose a photo (anime, peace sign, painting, anything)',
    usage: '.restyle anime | .restyle peace | .restyle make me a knight (reply to a photo)',
    cooldown: 30,
    async run({ m, text }) {
      // source: the image this command is captioned on, or the quoted image
      let download = null
      if (m.type === 'imageMessage') download = () => m.download()
      else if (m.quoted?.type === 'imageMessage') download = () => m.quoted.download()

      if (!download) return m.reply(menuText())
      if (!text) return m.reply(menuText())
      if (isBanned(text)) {
        return m.reply('🚫 I do not make nude, undressing or sexual edits - and this kind of content gets bots banned. Try a style or a pose instead: *.restyle anime*, *.restyle peace*.')
      }

      const resolved = resolveInstruction(text)
      const label = resolved.kind === 'style' ? 'Style' : resolved.kind === 'pose' ? 'Pose' : 'Edit'

      await m.react('⏳').catch(() => {})
      try {
        const input = await download()
        if (!input || input.length < 100) throw new Error('could not read the image')
        const { buffer, engine } = await transformImage(input, resolved.instruction)
        await m.reply({
          image: buffer,
          caption: `🎨 *RESTYLED* - ${label}: ${resolved.name}\n⚙️ Engine: ${engine}\n\nReply with *.restyle <another>* to try more.`
        })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
