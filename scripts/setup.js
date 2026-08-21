/**
 * Downloads / updates the standalone yt-dlp binary into ./bin.
 *
 * Run:
 *   npm run setup
 *
 * Uses the official standalone binaries:
 *   Windows -> yt-dlp.exe
 *   Linux   -> yt-dlp_linux
 *   macOS   -> yt-dlp_macos
 *
 * No Python is required.
 */

import fs from 'fs'
import path from 'path'
import https from 'https'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const BIN_DIR = path.join(ROOT, 'bin')

const platform = process.platform
const isWindows = platform === 'win32'

const TARGET = path.join(
  BIN_DIR,
  isWindows ? 'yt-dlp.exe' : 'yt-dlp'
)

/*
 * IMPORTANT:
 *
 * Linux must use yt-dlp_linux.
 * The official yt-dlp releases provide this as the
 * standalone Linux x64 executable.
 */
const URLS = {
  win32:
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',

  darwin:
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',

  linux:
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) {
      return reject(
        new Error('Too many redirects')
      )
    }

    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'AY-LEE-BOT'
          }
        },
        (res) => {
          /*
           * GitHub normally redirects the release URL.
           */
          if (
            [301, 302, 303, 307, 308].includes(
              res.statusCode
            )
          ) {
            const location =
              res.headers.location

            res.resume()

            if (!location) {
              return reject(
                new Error(
                  'Redirect location missing'
                )
              )
            }

            return resolve(
              download(
                location,
                dest,
                redirects + 1
              )
            )
          }

          if (res.statusCode !== 200) {
            res.resume()

            return reject(
              new Error(
                `HTTP ${res.statusCode}`
              )
            )
          }

          const file =
            fs.createWriteStream(dest)

          const total = Number(
            res.headers[
              'content-length'
            ] || 0
          )

          let downloaded = 0

          res.on('data', (chunk) => {
            downloaded += chunk.length

            if (total) {
              const percent =
                Math.round(
                  (downloaded / total) * 100
                )

              process.stdout.write(
                `\rDownloading yt-dlp... ${percent}%`
              )
            }
          })

          res.pipe(file)

          file.on('finish', () => {
            file.close(() => {
              process.stdout.write('\n')
              resolve()
            })
          })

          file.on('error', (err) => {
            try {
              fs.unlinkSync(dest)
            } catch {}

            reject(err)
          })

          res.on('error', (err) => {
            try {
              fs.unlinkSync(dest)
            } catch {}

            reject(err)
          })
        }
      )
      .on('error', reject)
  })
}

function checkBinary() {
  return new Promise((resolve, reject) => {
    execFile(
      TARGET,
      ['--version'],
      {
        timeout: 30000
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(
              stderr?.trim() ||
                error.message ||
                'yt-dlp could not be executed'
            )
          )
        }

        resolve(stdout.trim())
      }
    )
  })
}

async function main() {
  console.log('')
  console.log(
    '======================================'
  )
  console.log(
    '      AY-LEE BOT — yt-dlp setup'
  )
  console.log(
    '======================================'
  )
  console.log('')

  fs.mkdirSync(BIN_DIR, {
    recursive: true
  })

  const url =
    URLS[platform] || URLS.linux

  console.log(`Platform: ${platform}`)
  console.log(`Target: ${TARGET}`)
  console.log(`Download: ${url}`)
  console.log('')

  /*
   * Remove existing binary so we always get
   * the correct/latest version.
   */
  if (fs.existsSync(TARGET)) {
    console.log(
      'Removing old yt-dlp...'
    )

    try {
      fs.unlinkSync(TARGET)
    } catch (e) {
      console.log(
        `⚠️ Could not remove old yt-dlp: ${e.message}`
      )
    }
  }

  try {
    console.log(
      'Downloading standalone yt-dlp...'
    )

    await download(url, TARGET)

    /*
     * Linux/macOS need executable permission.
     */
    if (!isWindows) {
      fs.chmodSync(
        TARGET,
        0o755
      )
    }

    console.log('')
    console.log(
      'Checking yt-dlp...'
    )

    const version =
      await checkBinary()

    console.log('')
    console.log(
      `✅ yt-dlp ${version} is working.`
    )

    console.log(
      `📁 Location: ${TARGET}`
    )

    console.log('')
    console.log(
      'Downloader commands:'
    )

    console.log('  .play')
    console.log('  .video')
    console.log('  .music')
    console.log('  .spotify')
    console.log('  .tiktok')
    console.log('  .autodl')

    console.log('')
    console.log(
      '✅ No Python installation is required.'
    )

    console.log('')
  } catch (error) {
    console.log('')
    console.log(
      '❌ yt-dlp setup failed.'
    )

    console.log('')
    console.log(
      error.message
    )

    console.log('')
    console.log(
      'Make sure your hosting service allows'
    )
    console.log(
      'downloading executable files.'
    )

    console.log('')

    process.exit(1)
  }
}

main()