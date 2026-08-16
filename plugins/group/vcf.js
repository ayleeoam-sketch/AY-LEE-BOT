/**
 * Group contacts export (.vcf) - everyone in the group as a contacts file.
 * Group admins chase this constantly for promotion saves / backups.
 */

/** Build one vCard file (v3.0) from group participants. */
export function buildVcf(participants, groupName) {
  const seen = new Set()
  const cards = []
  for (const p of participants) {
    const numb = String(p.id || '').split('@')[0].split(':')[0]
    if (!/^\d{6,}$/.test(numb) || seen.has(numb)) continue
    seen.add(numb)
    cards.push(
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${groupName} Member ${numb}`,
      `TEL;TYPE=CELL:grpWA:+${numb}`,
      `ORG:${groupName}`,
      'END:VCARD'
    )
  }
  return cards.join('\r\n')
}

export default {
  name: 'vcf',
  alias: ['contacts', 'savecontacts', 'exportcontacts'],
  category: 'GROUP',
  desc: 'Export every group member as a phone contacts file (.vcf)',
  usage: '.vcf',
  cooldown: 15,
  group: true,
  admin: true,
  async run({ m }) {
    const groupName = (m.groupName || 'Group').replace(/[^\w\s-]/g, '').slice(0, 40) || 'Group'
    const vcf = buildVcf(m.participants || [], groupName)
    const count = vcf.split('BEGIN:VCARD').length - 1
    if (!count) return m.reply('❌ Could not read the group member list.')

    await m.reply({
      document: Buffer.from(vcf, 'utf-8'),
      mimetype: 'text/vcard',
      fileName: `${groupName}-contacts.vcf`,
      caption:
        `📇 *${count} contacts* from *${m.groupName}*\n\n` +
        `Save this file, then import it in your phone contacts app.`
    })
  }
}
