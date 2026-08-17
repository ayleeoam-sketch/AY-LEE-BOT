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

function flagFor(country) {
  if (!/^[A-Z]{2}$/.test(country || '')) return '🌐'
  return String.fromCodePoint(...[...country].map((letter) => 127397 + letter.charCodeAt(0)))
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

export default {
  name: 'track',
  alias: ['numberinfo', 'numinfo', 'phoneinfo', 'wanumber'],
  category: 'UTILITIES',
  desc: 'Show country and public numbering info for a full WhatsApp number',
  usage: '.track 2348021016309',
  cooldown: 15,

  async run({ sock, m, text }) {
    const digits = numberFrom(m, text)
    if (!digits) {
      return m.reply(
        '📱 *Usage:* .track 2348021016309\n\n' +
          'Enter the full number with its country code, or mention/reply to a user.'
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
        `⚠️ *Privacy note:* A phone number can reveal its country/numbering region only. ` +
        `It cannot reveal an exact address, live GPS location, or the owner's identity.`
    )
  }
}
