// Zeit-Helfer: alles rechnet intern in Minuten (Integer), Anzeige als "HH:MM".
// Keine Excel-Formeln, keine Floats in Zwischenschritten.

export const TAGE = ['mo', 'di', 'mi', 'do', 'fr', 'sa']
export const ALLE_TAGE = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so']

export const TAG_NAMEN = {
  mo: 'Montag', di: 'Dienstag', mi: 'Mittwoch', do: 'Donnerstag',
  fr: 'Freitag', sa: 'Samstag', so: 'Sonntag',
}
export const TAG_KURZ = { mo: 'Mo', di: 'Di', mi: 'Mi', do: 'Do', fr: 'Fr', sa: 'Sa', so: 'So' }

export const STATUS_CODES = ['U', 'F', 'K', 'FT', 'BV', 'Kur', 'SCH']
export const STATUS_LABELS = {
  U: 'Urlaub', F: 'Frei', K: 'Krank', FT: 'Feiertag',
  BV: 'Beschäftigungsverbot', Kur: 'Kur', SCH: 'Schule',
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
  'August', 'September', 'Oktober', 'November', 'Dezember']

// "06:30" -> 390. Ungültig/leer -> null.
export function toMin(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

// 390 -> "06:30" (Uhrzeit, zweistellig gepolstert)
export function toHHMM(min) {
  if (min == null || isNaN(min)) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}

// Dauer 2250 -> "37:30" (Stunden ohne führende Null, Minuten zweistellig)
export function dauerHHMM(min) {
  if (min == null || isNaN(min)) return '0:00'
  const neg = min < 0
  const abs = Math.abs(Math.round(min))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return (neg ? '-' : '') + h + ':' + String(m).padStart(2, '0')
}

// 37.5 -> "37:30" (Vertragsstunden dezimal -> Anzeige)
export function dezimalZuHHMM(dez) {
  if (dez == null || dez === '' || isNaN(dez)) return '0:00'
  return dauerHHMM(Math.round(Number(dez) * 60))
}

// Deutsches Zahlenformat: 412.5 -> "412,50"
export function euroFormat(betrag) {
  if (betrag == null || isNaN(betrag)) return '0,00'
  return betrag.toFixed(2).replace('.', ',')
}

// Pausen-Automatik aus Brutto-Schichtlänge (Minuten):
// <= 6h -> 0, > 6h -> 30, > 9h -> 45
export function autoPause(bruttoMin) {
  if (bruttoMin == null) return 0
  if (bruttoMin > 9 * 60) return 45
  if (bruttoMin > 6 * 60) return 30
  return 0
}

// Netto-Arbeitsminuten einer Zelle {von, bis, pauseMin}
export function berechneStdMin(von, bis, pauseMin) {
  const v = toMin(von)
  const b = toMin(bis)
  if (v == null || b == null || b <= v) return 0
  return Math.max(0, b - v - (pauseMin || 0))
}

// Überlappung zweier Minuten-Intervalle
export function overlapMin(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
}

// Montag der ISO-Kalenderwoche (lokale Zeit, 00:00)
export function isoWochenMontag(jahr, kw) {
  // 4. Januar liegt immer in KW 1
  const vierterJan = new Date(jahr, 0, 4)
  const wochentag = vierterJan.getDay() || 7 // So=7
  const montagKW1 = new Date(jahr, 0, 4 - wochentag + 1)
  const montag = new Date(montagKW1)
  montag.setDate(montagKW1.getDate() + (kw - 1) * 7)
  return montag
}

// ISO-KW eines Datums -> { kw, jahr }
export function isoKW(datum) {
  const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate()))
  const tag = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - tag)
  const jahrStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const kw = Math.ceil(((d - jahrStart) / 86400000 + 1) / 7)
  return { kw, jahr: d.getUTCFullYear() }
}

// Datum des Wochentags (Index 0=Mo .. 5=Sa) in KW/Jahr
export function tagDatum(jahr, kw, tagIndex) {
  const d = isoWochenMontag(jahr, kw)
  d.setDate(d.getDate() + tagIndex)
  return d
}

// "27.07.2026"
export function datumKurz(d) {
  return String(d.getDate()).padStart(2, '0') + '.' +
    String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
}

// "Montag 27. Juli"
export function tagUeberschrift(d) {
  const tag = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][d.getDay()]
  return tag + ' ' + d.getDate() + '. ' + MONATE[d.getMonth()]
}

export function monatName(monatIndex) {
  return MONATE[monatIndex]
}

// Schlüssel "2026-07" für Monats-Aggregation
export function monatKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}
