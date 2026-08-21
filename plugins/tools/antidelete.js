function getSenderJid(stored, key) {
  const message =
    unwrapMessage(
      stored?.message
    )

  const candidates = [
    // Prefer real phone-number JID
    stored?.key?.participantAlt,
    key?.participantAlt,

    // Some message versions expose this
    stored?.key?.participantPn,
    key?.participantPn,

    // Other possible phone-number alternatives
    stored?.key?.remoteJidAlt,
    key?.remoteJidAlt,

    // Original participant/LID as fallback
    stored?.key?.participant,
    key?.participant,

    message?.extendedTextMessage?.contextInfo?.participant,
    message?.imageMessage?.contextInfo?.participant,
    message?.videoMessage?.contextInfo?.participant,
    message?.documentMessage?.contextInfo?.participant,
    message?.audioMessage?.contextInfo?.participant,

    // Private chat fallback
    !isGroupJid(stored?.key?.remoteJid)
      ? stored?.key?.remoteJid
      : null,

    !isGroupJid(key?.remoteJid)
      ? key?.remoteJid
      : null
  ]

  // First choice: actual phone JID
  for (const jid of candidates) {
    if (
      jid &&
      String(jid).endsWith('@s.whatsapp.net')
    ) {
      return String(jid)
    }
  }

  // Second choice: whatever WhatsApp actually supplied
  for (const jid of candidates) {
    if (jid) {
      return String(jid)
    }
  }

  return 'Unknown'
}
