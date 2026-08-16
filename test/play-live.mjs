/**
 * ".play is not working" diagnostic.
 *
 *   node test/play-live.mjs "alan walker faded"
 *
 * Runs the exact three steps .play performs (search -> info -> audio) and,
 * on failure, prints the fix (setup, update, or cookies.txt) instead of a
 * stack trace. This is the fastest way to tell an operator which of the
 * three known failure modes they are hitting.
 */
import { youtubeSearch, youtubeInfo, youtubeAudio, hasYtdlp, hasCookies } from '../src/lib/downloader.js'

console.log('── .play diagnostic ──')
console.log('hasYtdlp:', hasYtdlp())
console.log('cookies.txt present:', hasCookies())

if (!hasYtdlp()) {
  console.log('\nFAIL: yt-dlp is not installed.\nFIX: npm run setup\n')
  process.exit(1)
}

const query = process.argv[2] || 'alan walker faded'

try {
  console.log(`\n1) search: "${query}"`)
  const [first] = await youtubeSearch(query, 1)
  if (!first) throw new Error('no results')
  console.log('   ok:', first.title, '-', first.url)

  console.log('\n2) info')
  const info = await youtubeInfo(first.url)
  console.log(`   ok: ${info.title} | ${info.duration}s | ${info.author}`)

  console.log('\n3) audio download')
  const t = Date.now()
  const { buffer, ext } = await youtubeAudio(first.url, { maxMb: 32 })
  console.log(`   ok: ${ext} ${(buffer.length / 1048576).toFixed(1)}MB in ${((Date.now() - t) / 1000).toFixed(0)}s`)

  console.log('\n✅ ALL PASS - .play should work. If it still fails on WhatsApp, restart the bot (npm start).')
} catch (e) {
  console.log('\n❌ FAILED:', e.message.split('\n')[0])
  console.log('\nMost likely fixes, in order:')
  console.log('  1. npm run update-dl        (outdated yt-dlp is the #1 cause)')
  if (!hasCookies()) {
    console.log('  2. add cookies.txt           (youtube.com signed in, exported with the')
    console.log('     "Get cookies.txt LOCALLY" extension -> save as cookies.txt in the bot folder)')
  } else {
    console.log('  2. cookies.txt exists but may be stale - re-export it')
  }
  console.log('  3. wait a minute and retry   (YouTube rate-limits datacenter IPs)')
  process.exit(1)
}
