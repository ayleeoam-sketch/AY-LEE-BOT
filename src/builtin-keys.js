/*
 * ════════════════════════════════════════════════════════════════════
 *  BUILT-IN KEYS  —  the only file you ever have to edit
 * ════════════════════════════════════════════════════════════════════
 *
 * Paste your keys between the quotes below and they ship WITH the code.
 * Anyone who clones, forks or redeploys this bot gets a fully working
 * install with no .env, no signups and no "where do I get an API key?".
 *
 * Precedence, highest first:
 *   1. .env  /  panel environment variables   (a deployer's own key wins)
 *   2. .setkey from WhatsApp                  (stored in MongoDB)
 *   3. these built-in values                  (the safety net)
 *
 * ⚠️  Anything here is PUBLIC once the repo is public. Only put keys in
 *     that you are happy for strangers to burn through. Free-tier keys
 *     (Groq, Gemini, Pexels, Pixabay) are the right kind to share; keys
 *     tied to a credit card (OpenAI, DeepSeek) are NOT — leave those blank
 *     and let deployers add their own.
 *
 * Rate limits are per key, so a shared key is shared quota. If .ai starts
 * getting slow for everyone, add a second provider below — the bot fails
 * over down the chain automatically.
 */

export const BUILTIN_KEYS = {
  /* ── AI ── you only need ONE of these for every AI command to work ── */

  // Groq — best first pick. Free, very generous, fastest.
  //   https://console.groq.com/keys        (starts with gsk_)
  GROQ_API_KEY: '',

  // Gemini — free, very capable, also reads images.
  //   https://aistudio.google.com/apikey   (starts with AIza)
  GEMINI_API_KEY: '',

  // Cerebras — free tier, fastest inference anywhere.
  //   https://cloud.cerebras.ai
  CEREBRAS_API_KEY: '',

  // OpenRouter — one key, many models, several marked :free.
  //   https://openrouter.ai/keys           (starts with sk-or-)
  OPENROUTER_API_KEY: '',

  // Mistral — free experiment tier.
  //   https://console.mistral.ai/api-keys
  MISTRAL_API_KEY: '',

  // Cohere — free trial keys.
  //   https://dashboard.cohere.com/api-keys
  COHERE_API_KEY: '',

  // Paid providers — leave blank in a public repo.
  DEEPSEEK_API_KEY: '',
  OPENAI_API_KEY: '',

  /* ── STOCK FOOTAGE ── optional upgrade for ".capcut create" ────────
   * Without these, create mode still works: keyless stock stills with
   * Ken Burns motion. With one, it uses real moving stock clips.        */

  // https://www.pexels.com/api/new/   — free, instant approval
  PEXELS_KEY: '',
  // https://pixabay.com/api/docs/     — free, instant on signup
  PIXABAY_KEY: '',

  /* ── CLASSROOM ── the ONE group VENOM SCHOOL is allowed to teach in ──
   * Paste your group's invite link (or its raw jid, 1234567890@g.us).
   * The bot resolves the link once and then refuses to run a class
   * anywhere else - other groups get no lessons, no register, and no
   * AI questions burning your key.
   *
   * Three ways to set it:
   *   'https://chat.whatsapp.com/xxxx'  the class group's invite link
   *   '120363xxxxxxxx@g.us'             its raw jid
   *   'support'                         reuse SUPPORT_GROUP_LINK (the
   *                                     force-join group) as the classroom
   *
   * Leave blank and no class runs until the owner sends .school on in the
   * group they want. Blank never guesses - the force-join group is usually
   * NOT the classroom.                                                    */
  SCHOOL_GROUP: '',

  /* ── DATABASE ── keeps balances/settings alive across restarts ─────
   * Everyone who leaves this in place shares one MongoDB account, so each
   * deploy is automatically given its own database inside it, named
   * venom_<owner number>. Nobody can see or overwrite another bot's
   * settings, balances or session. Set MONGO_DB to override that.        */
  MONGO_URI: 'mongodb+srv://GhostdevM:NaZ4mKNuGYUQg447@cluster0.kfzqn4v.mongodb.net/?appName=Cluster0'
}

/*
 * NO KEY IS REQUIRED FOR:
 *   .play .video .song .music .spotify  -> yt-dlp, keyless (npm run setup)
 *   .weather                            -> open-meteo, keyless
 *   .ai and friends                     -> keyless fallback, but it is
 *                                          paywalled/rate-limited in 2026,
 *                                          so a Groq key is worth 2 minutes
 *   every sticker / converter / game / economy / group command
 */

/** Read a built-in key by env name. Returns '' when unset. */
export function builtinKey(name) {
  return String(BUILTIN_KEYS[name] ?? '').trim()
}

/**
 * Copy built-ins into process.env for every name the environment has left
 * blank, so plugins that read process.env directly pick them up too.
 * A real .env value always wins. Called once, from src/config.js.
 */
export function applyBuiltinKeys() {
  // Tests run isolated: never hand them live credentials.
  if (process.env.VENOM_TEST_ISOLATE === '1') return []

  const applied = []
  for (const [name, value] of Object.entries(BUILTIN_KEYS)) {
    const v = String(value ?? '').trim()
    if (!v) continue
    if (String(process.env[name] ?? '').trim()) continue
    process.env[name] = v
    applied.push(name)
  }
  return applied
}

export default BUILTIN_KEYS
