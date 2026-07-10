// GfB-Finanzlogik: Verdienst mit Zuschlägen, Monats-Aggregation über alle
// gespeicherten Wochen. Alles in JS vorberechnet – rein intern für Warnungen,
// das Filialbudget bleibt in Stunden.
import { toMin, overlapMin, TAGE, tagDatum, monatKey } from './zeit'

// Teilt eine Schicht (von/bis/pauseMin) auf die Zuschlagsbänder auf.
// Pause wird zuerst von der zuschlagsfreien Zeit abgezogen, danach von den
// Bändern mit dem niedrigsten Zuschlag (konservativ zugunsten des MA).
// Rückgabe: { normalMin, baender: [{ name, prozent, min }] }
export function splitZuschlagsBaender(von, bis, pauseMin, zuschlaege) {
  const v = toMin(von)
  const b = toMin(bis)
  if (v == null || b == null || b <= v) return { normalMin: 0, baender: [] }
  const total = b - v

  const baender = (zuschlaege || []).map(z => {
    const zv = toMin(z.von)
    let zb = toMin(z.bis)
    if (zb === 23 * 60 + 59) zb = 24 * 60 // "23:59" als Tagesende behandeln
    return { name: z.name, prozent: z.prozent, min: overlapMin(v, b, zv ?? 0, zb ?? 0) }
  })

  let normal = total - baender.reduce((s, x) => s + x.min, 0)
  let restPause = pauseMin || 0

  const abzug = Math.min(normal, restPause)
  normal -= abzug
  restPause -= abzug
  for (const band of [...baender].sort((a, x) => a.prozent - x.prozent)) {
    if (restPause <= 0) break
    const a = Math.min(band.min, restPause)
    band.min -= a
    restPause -= a
  }
  return { normalMin: normal, baender }
}

// Verdienst einer Schicht in € (Modus "voll rechnen" – alle Zuschläge zählen)
export function schichtVerdienst(von, bis, pauseMin, stundenlohn, zuschlaege) {
  const { normalMin, baender } = splitZuschlagsBaender(von, bis, pauseMin, zuschlaege)
  let euro = (normalMin / 60) * stundenlohn
  for (const band of baender) {
    euro += (band.min / 60) * stundenlohn * (1 + band.prozent / 100)
  }
  return euro
}

// Monats-Aggregation für einen MA über ALLE gespeicherten Wochen.
// Eine KW kann zwei Monate berühren -> jeder Tag wird seinem Kalendermonat
// zugeordnet. Rückgabe: { '2026-07': { min, euro }, ... }
export function gfbMonatsWerte(ma, alleWochen, profile) {
  const monate = {}
  const lohn = Number(ma.stundenlohn) || profile.mindestlohn || 0
  for (const woche of Object.values(alleWochen)) {
    const plan = woche.plan?.[ma.id]
    if (!plan) continue
    TAGE.forEach((tag, idx) => {
      const zelle = plan[tag]
      if (!zelle || zelle.art !== 'arbeit') return
      const datum = tagDatum(woche.jahr, woche.kw, idx)
      const key = monatKey(datum)
      if (!monate[key]) monate[key] = { min: 0, euro: 0 }
      monate[key].min += zelle.stdMin || 0
      monate[key].euro += schichtVerdienst(
        zelle.von, zelle.bis, zelle.pauseMin, lohn, profile.zuschlaege)
    })
  }
  return monate
}

// Welche Kalendermonate berührt eine KW (Mo–Sa)?
// Rückgabe: [{ key: '2026-07', monatIndex: 6, jahr: 2026 }, ...] (max. 2)
export function wochenMonate(jahr, kw) {
  const erg = []
  for (let i = 0; i < 6; i++) {
    const d = tagDatum(jahr, kw, i)
    const key = monatKey(d)
    if (!erg.some(x => x.key === key)) {
      erg.push({ key, monatIndex: d.getMonth(), jahr: d.getFullYear() })
    }
  }
  return erg
}

// Wochensumme (Minuten) eines MA innerhalb EINER Woche, nur Tage eines
// bestimmten Monats (für den Export "Juli davon verplant").
export function wochenMinutenImMonat(ma, woche, monatKeyGesucht) {
  let min = 0
  TAGE.forEach((tag, idx) => {
    const zelle = woche.plan?.[ma.id]?.[tag]
    if (!zelle || zelle.art !== 'arbeit') return
    const d = tagDatum(woche.jahr, woche.kw, idx)
    if (monatKey(d) === monatKeyGesucht) min += zelle.stdMin || 0
  })
  return min
}
