import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

const TYPES = {
  MOBILE: 'Mobile',
  FIXED_LINE: 'Fixed line',
  FIXED_LINE_OR_MOBILE: 'Fixed line or mobile',
  TOLL_FREE: 'Toll-free',
  PREMIUM_RATE: 'Premium-rate',
  SHARED_COST: 'Shared-cost',
  VOIP: 'VoIP',
  PERSONAL_NUMBER: 'Personal number',
  PAGER: 'Pager',
  UAN: 'Universal access number',
  VOICEMAIL: 'Voicemail'
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
const LOCATION_REQUEST_TTL = 10 * 60 * 1000
const LOCATION_REQUEST_COOLDOWN = 5 * 60 * 1000

/*
 * Exact locations are never looked up from phone numbers. A short-lived entry
 * exists only after someone asks, and is removed as soon as the target shares
 * a WhatsApp location in the bot's DM, declines, expires, or the bot restarts.
 */
const pendingLocations = new Map() // target phone digits -> request
const locationRequestCooldowns = new Map() // requester jid -> next allowed request

function flagFor(country) {
  if (!/^[A-Z]{2}$/.test(country || '')) return '🌐'
  return String.fromCodePoint(...[...country].map((letter) => 127397 + letter.charCodeAt(0)))
}

function cleanExpiredRequests() {
  const now = Date.now()
  for (const [number, request] of pendingLocations) {
    if (request.expires <= now) pendingLocations.delete(number)
  }
  for (const [requester, nextAllowed] of locationRequestCooldowns) {
    if (nextAllowed <= now) locationRequestCooldowns.delete(requester)
  }
}

/** Extract a full international number from text, a mention, or a reply. */
export function numberFrom(m, text) {
  const source = m.mentions?.[0] || m.quoted?.senderNumber || text || ''
  let digits = String(source).split('@')[0].replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  return digits
}

/** Public numbering-plan metadata. This never attempts GPS/live tracking. */
export function inspectNumber(digits) {
  if (!/^\d{7,15}$/.test(digits) || digits.startsWith('0')) return null
  const phone = parsePhoneNumberFromString(`+${digits}`)
  if (!phone) return null

  const countryCode = phone.country || ''
  let country = 'International network'
  if (countryCode) {
    try {
      country = regionNames.of(countryCode) || countryCode
    } catch {
      country = countryCode
    }
  }

  return {
    phone,
    countryCode,
    country,
    flag: flagFor(countryCode),
    type: TYPES[phone.getType()] || phone.getType() || 'Unknown'
  }
}

function locationDetails(message) {
  const latitude = Number(message?.degreesLatitude)
  const longitude = Number(message?.degreesLongitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null

  const accuracy = Number(message?.accuracyInMeters)
  const speed = Number(message?.speedInMps)
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    speed: Number.isFinite(speed) && speed >= 0 ? speed : null,
    name: message?.name || '',
    address: message?.address || '',
    caption: message?.caption || message?.comment || '',
    maps: `https://maps.google.com/?q=${latitude},${longitude}`
  }
}

async function requestLocation(sock, m, text) {
  cleanExpiredRequests()

  const targetText = String(text || '').replace(/^request\s+/i, '').trim()
  const mentioned = m.mentions?.[0] || m.quoted?.sender || ''
  if (mentioned.endsWith('@lid')) {
    return m.reply(
      '❌ WhatsApp hid that user behind a private LID. Give their full number without tagging them.\n\n' +
        'Example: *.requestloc 2348021016309*'
    )
  }

  const digits = numberFrom(
    { mentions: m.mentions || [], quoted: m.quoted },
    targetText
  )
  const info = inspectNumber(digits)
  if (!info?.phone.isValid()) {
    return m.reply(
      '📍 *Usage:* .requestloc 2348021016309\n' +
        'Or mention/reply to the person. Their full country code is required.'
    )
  }
  if (digits === m.senderNumber) return m.reply('📍 You do not need permission to share your own location.')
  if (digits === m.botNumber) return m.reply('🤖 You cannot request a location from the bot itself.')

  const requesterKey = m.sender || m.senderNumber
  const nextAllowed = locationRequestCooldowns.get(requesterKey) || 0
  if (nextAllowed > Date.now()) {
    const minutes = Math.ceil((nextAllowed - Date.now()) / 60_000)
    return m.reply(`⏳ To prevent request spam, wait ${minutes} minute${minutes === 1 ? '' : 's'} before asking someone else.`)
  }

  const active = pendingLocations.get(digits)
  if (active?.expires > Date.now()) {
    return m.reply('⏳ That person already has an active location request. Try again later.')
  }

  let targetJid = `${digits}@s.whatsapp.net`
  if (typeof sock.onWhatsApp === 'function') {
    try {
      const result = await sock.onWhatsApp(digits)
      if (Array.isArray(result)) {
        const account = result.find((entry) => entry.exists)
        if (!account) return m.reply('❌ That number is not registered on WhatsApp.')
        if (account.jid) targetJid = account.jid
      }
    } catch {
      /* Sending the request itself is the final availability check. */
    }
  }

  const expires = Date.now() + LOCATION_REQUEST_TTL
  try {
    await sock.sendMessage(targetJid, {
      text:
        `📍 *LOCATION REQUEST*\n\n` +
        `@${m.senderNumber} is asking you to share your location.\n\n` +
        `Only if you consent, open this DM and use:\n` +
        `📎 *Attachment → Location → Send current location*\n\n` +
        `You can ignore this request or reply *.track cancel* to decline. ` +
        `It expires in 10 minutes. The bot cannot locate you unless you choose to share.`,
      mentions: [m.sender]
    })
  } catch {
    return m.reply('❌ I could not send that person a location request. Ask them to message the bot first.')
  }

  locationRequestCooldowns.set(requesterKey, Date.now() + LOCATION_REQUEST_COOLDOWN)
  pendingLocations.set(digits, {
    targetJid,
    requesterJid: m.sender,
    requesterNumber: m.senderNumber,
    expires
  })

  await m.reply({
    text:
      `📍 Location request sent to @${digits}.\n\n` +
      `They must voluntarily share their location in the bot's DM within 10 minutes. ` +
      `Nothing is tracked without their consent.`,
    mentions: [targetJid]
  })
}

async function cancelLocationRequest(sock, m) {
  cleanExpiredRequests()
  const request = pendingLocations.get(m.senderNumber)
  if (!request) return m.reply('📍 You have no active location request to decline.')

  pendingLocations.delete(m.senderNumber)
  await sock.sendMessage(request.requesterJid, {
    text: `📍 @${m.senderNumber} declined the location request. No location was shared.`,
    mentions: [m.sender]
  }).catch(() => {})
  await m.reply('✅ Location request declined. No location was shared.')
}

const trackCommand = {
  name: 'track',
  alias: ['numberinfo', 'numinfo', 'phoneinfo', 'wanumber', 'requestloc', 'locationrequest'],
  category: 'UTILITIES',
  desc: 'Show phone metadata or request a location with the user’s consent',
  usage: '.track 2348021016309 | .requestloc @user',
  cooldown: 15,

  async run({ sock, m, text, command }) {
    const lower = String(text || '').trim().toLowerCase()
    if (lower === 'cancel') return cancelLocationRequest(sock, m)
    const isRequest = ['requestloc', 'locationrequest'].includes(command) || lower === 'request' || lower.startsWith('request ')
    if (isRequest) return requestLocation(sock, m, text)

    const digits = numberFrom(m, text)
    if (!digits) {
      return m.reply(
        '📱 *Usage:* .track 2348021016309\n\n' +
          'Enter the full number with its country code, or mention/reply to a user.\n' +
          'For a consent-based location request: *.requestloc @user*'
      )
    }

    const info = inspectNumber(digits)
    if (!info) {
      return m.reply(
        '❌ That is not a valid full international number.\n\n' +
          'Include the country code and remove the first local zero.\n' +
          'Example: *0802 101 6309* becomes *2348021016309*.'
      )
    }

    let whatsapp = 'Check unavailable'
    if (typeof sock.onWhatsApp === 'function' && info.phone.isValid()) {
      try {
        const result = await sock.onWhatsApp(info.phone.number.slice(1))
        if (Array.isArray(result)) {
          whatsapp = result.some((entry) => entry.exists) ? 'Registered ✅' : 'Not registered ❌'
        }
      } catch {
        /* WhatsApp can rate-limit registration checks; number metadata still works. */
      }
    }

    await m.reply(
      `╭━━━〔 *NUMBER INFORMATION* 〕━━━╮\n` +
        `┃ 📱 Full number: ${info.phone.number}\n` +
        `┃ 🌍 International: ${info.phone.formatInternational()}\n` +
        `┃ 🏠 National: ${info.phone.formatNational()}\n` +
        `┃ ${info.flag} Country/region: ${info.country}${info.countryCode ? ` (${info.countryCode})` : ''}\n` +
        `┃ ☎️ Calling code: +${info.phone.countryCallingCode}\n` +
        `┃ 🔢 National number: ${info.phone.nationalNumber}\n` +
        `┃ 📡 Type: ${info.type}\n` +
        `┃ ✅ Valid: ${info.phone.isValid() ? 'Yes' : 'No'}\n` +
        `┃ 🧩 Possible: ${info.phone.isPossible() ? 'Yes' : 'No'}\n` +
        `┃ 💬 WhatsApp: ${whatsapp}\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `⚠️ A number only reveals its country/numbering region; it cannot reveal an exact address or live GPS location.\n` +
        `📍 For an exact location with consent: *.requestloc ${info.phone.number.slice(1)}*`
    )
  },

  /** Forward a location only when this sender has an active consent request. */
  async before({ sock, m }) {
    if (m.isGroup || !['locationMessage', 'liveLocationMessage'].includes(m.type)) return false
    cleanExpiredRequests()

    const request = pendingLocations.get(m.senderNumber)
    if (!request) return false

    const location = locationDetails(m.msg)
    if (!location) return false
    pendingLocations.delete(m.senderNumber)

    const kind = m.type === 'liveLocationMessage' || m.msg?.isLive ? 'Live-location snapshot' : 'Current location'
    try {
      await sock.sendMessage(request.requesterJid, {
        text:
          `📍 *LOCATION SHARED WITH CONSENT*\n\n` +
          `@${m.senderNumber} chose to share their location with you.\n` +
          `🧭 Type: ${kind}\n` +
          `🌐 Latitude: ${location.latitude}\n` +
          `🌐 Longitude: ${location.longitude}\n` +
          (location.accuracy !== null ? `🎯 Accuracy: about ${Math.round(location.accuracy)} m\n` : '') +
          (location.speed !== null ? `🚗 Speed: ${location.speed.toFixed(1)} m/s\n` : '') +
          (location.name ? `📌 Place: ${location.name}\n` : '') +
          (location.address ? `🏠 Address: ${location.address}\n` : '') +
          (location.caption ? `💬 Note: ${location.caption}\n` : '') +
          `🗺️ ${location.maps}\n\n` +
          `_This one-time result was forwarded because the user voluntarily shared it._`,
        mentions: [m.sender]
      })
      await sock.sendMessage(request.requesterJid, {
        location: {
          degreesLatitude: location.latitude,
          degreesLongitude: location.longitude,
          name: location.name || 'Shared location',
          address: location.address || location.maps
        }
      })
      await m.reply({
        text:
          `✅ Your location was sent privately to @${request.requesterNumber}. ` +
          `The request is now closed and your coordinates were not saved to the bot database.`,
        mentions: [request.requesterJid]
      })
    } catch {
      await m.reply('❌ I could not deliver the location. The request is closed and your coordinates were not saved to the bot database.')
    }
    return false
  }
}

export default trackCommand
