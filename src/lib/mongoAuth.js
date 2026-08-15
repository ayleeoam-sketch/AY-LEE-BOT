import { initAuthCreds, BufferJSON, proto } from 'baileys'
import { DB, isMongo } from './database.js'
import log from './logger.js'

/**
 * Baileys auth state backed by MongoDB (or the JSON fallback).
 *
 * Why: on Pterodactyl / Heroku style hosts the filesystem is wiped on every
 * redeploy, which would log the bot out. Keeping creds + signal keys in the DB
 * means the bot reconnects silently after a restart or a fresh deploy.
 *
 * Mirrors the contract of Baileys' own useMultiFileAuthState.
 */
export async function useMongoAuthState(sessionId = 'default') {
  const col = DB.session

  const write = async (id, value) => {
    const data = JSON.stringify(value, BufferJSON.replacer)
    await col.set({ sessionId, id }, { data })
  }

  const read = async (id) => {
    const row = await col.findOne({ sessionId, id })
    if (!row?.data) return null
    try {
      return JSON.parse(row.data, BufferJSON.reviver)
    } catch (e) {
      log.warn(`Corrupt session record "${id}" - ignoring`)
      return null
    }
  }

  const remove = async (id) => {
    await col.delete({ sessionId, id })
  }

  const creds = (await read('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`)
              // app state sync keys must be re-hydrated into their proto form
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              if (value) result[id] = value
            })
          )
          return result
        },

        set: async (data) => {
          const tasks = []
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id]
              const key = `${type}-${id}`
              tasks.push(value ? write(key, value) : remove(key))
            }
          }
          await Promise.all(tasks)
        },

        clear: async () => {
          await col.delete({ sessionId })
        }
      }
    },

    saveCreds: () => write('creds', creds),

    /** wipe the whole session - used by .logout */
    deleteSession: async () => {
      await col.delete({ sessionId })
      log.warn(`Session "${sessionId}" deleted from ${isMongo() ? 'MongoDB' : 'local storage'}`)
    }
  }
}

export default useMongoAuthState
