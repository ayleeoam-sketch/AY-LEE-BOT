/**
 * Test isolation guard.
 *
 * Imported FIRST by every suite, before src/config.js.
 *
 * ES modules hoist all imports above ordinary statements, so a plain
 * `delete process.env.MONGO_URI` written at the top of a test file runs
 * *after* config.js has already read the variable. Putting the guard in its
 * own module and importing it first makes the ordering explicit and real.
 *
 * Why it matters: these suites create and delete fixture users, groups and
 * warnings. Pointed at a production cluster they pollute live data and their
 * cleanup wipes real rows. Tests therefore run on the JSON-file backend by
 * default.
 *
 * Run against the real database deliberately with:  --live-db
 */
import dotenv from 'dotenv'
dotenv.config()

export const LIVE_DB = process.argv.includes('--live-db')

if (!LIVE_DB) {
  // config.js calls dotenv itself, which would restore MONGO_URI after any
  // deletion here - so raise a flag config.js checks instead.
  process.env.VENOM_TEST_ISOLATE = '1'
  process.env.MONGO_DB = 'venom_test'
} else {
  console.log('⚠️  --live-db: running against the REAL database')
}
