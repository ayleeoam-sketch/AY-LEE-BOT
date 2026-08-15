/**
 * Downloads / updates the yt-dlp binary into ./bin.
 *
 *   npm run setup       install or update
 *
 * yt-dlp ships as a single self-contained binary, so this works on
 * Pterodactyl, Termux, Heroku and plain VPS boxes with no system packages.
 * Run it periodically: YouTube changes its internals often and an outdated
 * yt-dlp is the single most common cause of "download failed".
 */
import fs from 'fs'
import path from 'path'
import https from 'https'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = path.join(ROOT, 'bin')
const isWindows = process.platform === 'win32'
const TARGET = path.join(BIN_DIR, isWindows ? 'yt-dlp.exe' : 'yt-dlp')

const URLS = {
  win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'))
    https
      .get(url, { headers: { 'User-Agent': 'venom-md-bot' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume()
          return resolve(download(res.headers.location, dest, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let got = 0
        const file = fs.createWriteStream(dest)
        res.on('data', (c) => {
          got += c.length
          if (total) {
            const pct = Math.round((got / total) * 100)
            process.stdout.write(`\r  downloading yt-dlp... ${pct}%`)
          }
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => { process.stdout.write('\n'); resolve() }))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

async function main() {
  console.log('\n🔧 VENOM MD BOT — downloader setup\n')
  fs.mkdirSync(BIN_DIR, { recursive: true })

  const url = URLS[process.platform] || URLS.linux
  console.log(`  platform: ${process.platform}`)

  try {
    await download(url, TARGET)
    if (!isWindows) fs.chmodSync(TARGET, 0o755)

    execFile(TARGET, ['--version'], (err, stdout) => {
      if (err) {
        console.log('\n❌ yt-dlp downloaded but will not run:', err.message)
        console.log('   On some hosts you may need Python 3.9+ installed.')
        process.exit(1)
      }
      console.log(`\n✅ yt-dlp ${stdout.trim()} ready at ./bin/`)
      console.log('\n   Working out of the box:')
      console.log('     • YouTube  .play  .video  .ytsearch')
      console.log('     • TikTok   .tiktok  .ttmp3')
      console.log('     • Twitter/X, Facebook, +1800 sites  .autodl')
      console.log('\n   Instagram needs a login session:')
      console.log('     export cookies with the "Get cookies.txt LOCALLY"')
      console.log('     browser extension and save as cookies.txt here.\n')
    })
  } catch (e) {
    console.log(`\n❌ Setup failed: ${e.message}`)
    console.log('   Manual fix: download yt-dlp from')
    console.log('   https://github.com/yt-dlp/yt-dlp/releases/latest')
    console.log(`   and place it at ${TARGET}\n`)
    process.exit(1)
  }
}

main()
