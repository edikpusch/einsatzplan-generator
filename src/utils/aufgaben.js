// Tagesaufgaben – die EINZIGE Bedarfsquelle der Planung.
// Konzept: docs/KONZEPT-Tagesaufgaben.md
//
// Kerngedanke: Der Bedarf eines Tages ist eine Liste von Aufgaben mit
// STUNDENMENGEN. Wie viele Personen gleichzeitig nötig sind, wird daraus
// abgeleitet – nicht separat gepflegt:
//
//   Markt 07:00–22:00 = 15 h offen, Kasse = 20 h
//   → 15 h Grundbesetzung (1 Kasse durchgehend) + 5 h zweite Kasse
//
import { TAGE, toMin, dauerHHMM } from './zeit'

export const MODI = ['durchgehend', 'fenster', 'frei']

export const MODUS_LABELS = {
  durchgehend: 'durchgehend (deckt die Öffnungszeit)',
  fenster: 'im Zeitfenster',
  frei: 'frei über den Tag',
}

export const MODUS_KURZ = {
  durchgehend: 'durchgehend',
  fenster: 'Fenster',
  frei: 'frei',
}

// Stunden dieser Aufgabe an einem bestimmten Tag (mit Tages-Abweichung)
export function stundenFuerTag(aufgabe, tag) {
  const abweichung = aufgabe.stundenJeTag?.[tag]
  if (abweichung != null && abweichung !== '') return Number(abweichung) || 0
  return Number(aufgabe.stunden) || 0
}

export function giltAm(aufgabe, tag) {
  return aufgabe.aktiv !== false && (aufgabe.tage || []).includes(tag)
}

// Arbeitszeit-Fenster eines Tages: Öffnungszeit, aber nie vor dem
// frühesten Arbeitsbeginn der Filiale (Default 06:00 – harte Schranke).
export function arbeitsFenster(filiale, tag) {
  const oz = filiale?.oeffnungszeiten?.[tag]
  if (!oz?.offen) return null
  const frueheste = toMin(filiale.fruehesterBeginn || '06:00') ?? 360
  const auf = Math.max(toMin(oz.auf) ?? 0, frueheste)
  const zu = toMin(oz.zu) ?? 0
  if (zu <= auf) return null
  return { auf, zu }
}

// Stoßzeit-Fenster eines Tages (nur Zeiträume – die Anzahl ergibt sich
// aus den Aufgaben-Stunden, siehe restStunden unten).
export function stosszeitenAm(filiale, tag, auf, zu) {
  return (filiale.stosszeiten || [])
    .filter(s => s.tage?.includes(tag))
    .map(s => ({
      von: Math.max(toMin(s.von) ?? 0, auf),
      bis: Math.min(toMin(s.bis) ?? 0, zu),
    }))
    .filter(f => f.bis > f.von)
    .sort((a, b) => a.von - b.von)
}

// Rest-Minuten einer durchgehenden Aufgabe auf die Stoßzeiten verteilen.
// Reichen die Stoßzeiten nicht, wird der Rest um die Tagesmitte gelegt.
function restAufStosszeiten(filiale, tag, auf, zu, restMin) {
  const erg = []
  let rest = restMin
  for (const f of stosszeitenAm(filiale, tag, auf, zu)) {
    if (rest <= 0) break
    const dauer = Math.min(f.bis - f.von, rest)
    erg.push({ von: f.von, bis: f.von + dauer })
    rest -= dauer
  }
  if (rest > 0) {
    const mitte = Math.round((auf + zu) / 2)
    const von = Math.max(auf, Math.min(mitte - Math.round(rest / 2), zu - rest))
    erg.push({ von, bis: Math.min(zu, von + rest) })
  }
  return erg
}

// Bedarfs-Blöcke eines Tages: welche Aufgabe braucht wann wie viele
// Personen GLEICHZEITIG. 'frei' erzeugt keine Blöcke (nur Stunden).
export function tagesBloecke({ aufgaben, filiale, tag }) {
  const fenster = arbeitsFenster(filiale, tag)
  if (!fenster) return []
  const { auf, zu } = fenster
  const oeffnungsDauer = zu - auf
  const bloecke = []

  for (const a of aufgaben || []) {
    if (!giltAm(a, tag)) continue
    const min = Math.round(stundenFuerTag(a, tag) * 60)
    if (min <= 0) continue

    if (a.modus === 'durchgehend') {
      // DIE Kernformel des Moduls
      const grundbesetzung = Math.floor(min / oeffnungsDauer)
      const restMin = min - grundbesetzung * oeffnungsDauer
      if (grundbesetzung > 0) {
        bloecke.push({ von: auf, bis: zu, koepfe: grundbesetzung, aufgabeId: a.id })
      }
      if (restMin > 0) {
        for (const f of restAufStosszeiten(filiale, tag, auf, zu, restMin)) {
          bloecke.push({ von: f.von, bis: f.bis, koepfe: 1, aufgabeId: a.id })
        }
      }
    } else if (a.modus === 'fenster') {
      const fv = Math.max(toMin(a.fenster?.von) ?? auf, auf)
      const fb = Math.min(toMin(a.fenster?.bis) ?? zu, zu)
      const dauer = fb - fv
      if (dauer > 0) {
        bloecke.push({ von: fv, bis: fb, koepfe: Math.ceil(min / dauer), aufgabeId: a.id })
      }
    }
    // 'frei' → keine Gleichzeitigkeit, zählt nur in die Soll-Stunden
  }
  return bloecke
}

// Soll-Kurve: benötigte Köpfe je Zeitabschnitt (Summe über die Aufgaben,
// weil verschiedene Aufgaben verschiedene Personen belegen).
// Mindestens 1 Person, solange der Markt offen ist.
export function tagesKurve({ aufgaben, filiale, tag }) {
  const fenster = arbeitsFenster(filiale, tag)
  if (!fenster) return []
  const { auf, zu } = fenster
  const bloecke = tagesBloecke({ aufgaben, filiale, tag })

  const punkte = new Set([auf, zu])
  for (const b of bloecke) {
    if (b.von > auf && b.von < zu) punkte.add(b.von)
    if (b.bis > auf && b.bis < zu) punkte.add(b.bis)
  }
  const sortiert = [...punkte].sort((a, b) => a - b)

  const abschnitte = []
  for (let i = 0; i < sortiert.length - 1; i++) {
    const von = sortiert[i], bis = sortiert[i + 1]
    if (bis <= von) continue
    const koepfe = bloecke
      .filter(b => b.von <= von && b.bis >= bis)
      .reduce((s, b) => s + b.koepfe, 0)
    const letzte = abschnitte[abschnitte.length - 1]
    const wert = Math.max(1, koepfe)
    if (letzte && letzte.koepfe === wert && letzte.bis === von) letzte.bis = bis
    else abschnitte.push({ von, bis, koepfe: wert })
  }
  return abschnitte
}

// Benötigte Köpfe zum Zeitpunkt t (für den Generator)
export function kopfBedarfZu(kurve, t) {
  for (const a of kurve) {
    if (t >= a.von && t < a.bis) return a.koepfe
  }
  return 0
}

// Soll-Stunden (Minuten) eines Tages = Summe aller Aufgaben-Stunden.
// 'extern' zählt nicht gegen das Budget der Filiale.
export function sollMinutenTag({ aufgaben, filiale, tag, mitExtern = false }) {
  if (!arbeitsFenster(filiale, tag)) return 0
  let min = 0
  for (const a of aufgaben || []) {
    if (!giltAm(a, tag)) continue
    if (!mitExtern && a.budgetQuelle === 'extern') continue
    min += Math.round(stundenFuerTag(a, tag) * 60)
  }
  return min
}

export function sollMinutenWoche({ aufgaben, filiale, mitExtern = false }) {
  return TAGE.reduce(
    (s, tag) => s + sollMinutenTag({ aufgaben, filiale, tag, mitExtern }), 0)
}

// Drei-Wege-Abgleich: Soll-Stunden ↔ Budget ↔ Summe Vertragsstunden
export function abgleich({ aufgaben, filiale, mitarbeiter }) {
  const sollMin = sollMinutenWoche({ aufgaben, filiale })
  const budgetMin = Math.round((Number(filiale.wochenstundenBudget) || 0) * 60)
  const vertragMin = (mitarbeiter || [])
    .filter(m => m.typ === 'fest')
    .reduce((s, m) => s + Math.round((Number(m.vertragsstunden) || 0) * 60), 0)

  const hinweise = []
  if (budgetMin > 0 && sollMin > budgetMin) {
    hinweise.push({
      schwere: 'rot',
      text: `Aufgaben brauchen ${dauerHHMM(sollMin)}, das Budget gibt nur ${dauerHHMM(budgetMin)} her (${dauerHHMM(sollMin - budgetMin)} zu viel)`,
    })
  }
  if (budgetMin > 0 && vertragMin > budgetMin) {
    hinweise.push({
      schwere: 'rot',
      text: `Vertragsstunden (${dauerHHMM(vertragMin)}) übersteigen das Budget (${dauerHHMM(budgetMin)})`,
    })
  }
  if (vertragMin > sollMin && sollMin > 0) {
    hinweise.push({
      schwere: 'gelb',
      text: `Vertragsstunden (${dauerHHMM(vertragMin)}) liegen ${dauerHHMM(vertragMin - sollMin)} über dem Aufgaben-Bedarf – die Mehrstunden werden zusätzlich verplant`,
    })
  }
  if (sollMin > vertragMin && vertragMin > 0) {
    hinweise.push({
      schwere: 'gelb',
      text: `Aufgaben-Bedarf (${dauerHHMM(sollMin)}) liegt ${dauerHHMM(sollMin - vertragMin)} über den Vertragsstunden – Aushilfen oder Überstunden nötig`,
    })
  }
  return { sollMin, budgetMin, vertragMin, hinweise }
}

// ---------------------------------------------------------------------------
// Migration: Startwerte aus dem Vorgangskatalog + den alten Filial-Feldern
// ---------------------------------------------------------------------------

// Katalog-Kategorie → Aufgabe. Bewusst grob: der Nutzer verfeinert im Editor.
const KATEGORIE_ZU_AUFGABE = {
  bakeoff: { name: 'Bake-Off', bereich: 'bakeoff', modus: 'fenster', prioritaet: 1 },
  oug: { name: 'Obst & Gemüse', bereich: 'packen', modus: 'fenster', prioritaet: 2 },
  fleischmopro: { name: 'Fleisch & Mopro', bereich: 'packen', modus: 'frei', prioritaet: 2 },
  logistik: { name: 'Logistik & Leergut', bereich: 'packen', modus: 'frei', prioritaet: 4 },
  trockenaktion: { name: 'Aktion & Werbung', bereich: 'packen', modus: 'frei', prioritaet: 3 },
  oeffnungschluss: { name: 'Öffnung & Schluss', bereich: null, modus: 'frei', prioritaet: 1 },
  kontrolle: { name: 'Kontrollen & MHD', bereich: null, modus: 'frei', prioritaet: 3 },
  bestellung: { name: 'Bestellungen', bereich: null, modus: 'frei', prioritaet: 2 },
  inventur: { name: 'Inventur', bereich: null, modus: 'frei', prioritaet: 3 },
  saison: { name: 'Saison-Aufbau', bereich: 'packen', modus: 'frei', prioritaet: 5 },
}

function mittel(min, max) {
  return ((Number(min) || 0) + (Number(max) || 0)) / 2
}

// Fällt ein Katalog-Vorgang auf diesen Wochentag? (nur regelmäßige –
// Inventuren/Saison werden weiter pro Woche bestätigt)
function vorgangAm(vorgang, tag) {
  if (vorgang.rhythmus === 'taeglich') return true
  if (vorgang.rhythmus === 'woechentlich') {
    return (vorgang.wochentage || []).length === 0 || vorgang.wochentage.includes(tag)
  }
  return false
}

// Erzeugt den Aufgaben-Startsatz einer Filiale.
export function aufgabenAusKatalog(filiale, katalog, uid) {
  const aufgaben = []

  // 1. Kasse – aus kassenStandard + Peak-Zuschlägen in Stunden umgerechnet
  const kassenStunden = {}
  let kasseIrgendwo = false
  for (const tag of TAGE) {
    const f = arbeitsFenster(filiale, tag)
    if (!f) continue
    const standard = Number(filiale.kassenStandard ?? 1) || 0
    let min = standard * (f.zu - f.auf)
    for (const p of filiale.kassenPeaks || []) {
      if (!p.tage?.includes(tag)) continue
      const extra = (Number(p.anzahl) || 0) - standard
      if (extra <= 0) continue
      const pv = Math.max(toMin(p.von) ?? 0, f.auf)
      const pb = Math.min(toMin(p.bis) ?? 0, f.zu)
      if (pb > pv) min += extra * (pb - pv)
    }
    if (min > 0) { kassenStunden[tag] = Math.round((min / 60) * 4) / 4; kasseIrgendwo = true }
  }
  if (kasseIrgendwo) {
    aufgaben.push(bauAufgabe(uid, {
      name: 'Kasse', bereich: 'kasse', modus: 'durchgehend', prioritaet: 1,
    }, kassenStunden))
  }

  // 2. Übrige Aufgaben aus dem Vorgangskatalog je Kategorie
  for (const [kategorie, vorlage] of Object.entries(KATEGORIE_ZU_AUFGABE)) {
    const stundenJeTag = {}
    let irgendwo = false
    for (const tag of TAGE) {
      if (!arbeitsFenster(filiale, tag)) continue
      let min = 0
      for (const v of katalog || []) {
        if (!v.aktiv || v.kategorie !== kategorie) continue
        if (!vorgangAm(v, tag)) continue
        min += mittel(v.personen?.min, v.personen?.max) * mittel(v.dauerMin?.min, v.dauerMin?.max)
      }
      if (min > 0) { stundenJeTag[tag] = Math.round((min / 60) * 4) / 4; irgendwo = true }
    }
    if (!irgendwo) continue

    const aufgabe = bauAufgabe(uid, vorlage, stundenJeTag)
    if (vorlage.modus === 'fenster') {
      aufgabe.fenster = kategorie === 'bakeoff'
        ? { von: filiale.fruehesterBeginn || '06:00', bis: filiale.baeckerFenster?.bis || '10:00' }
        : { von: filiale.fruehesterBeginn || '06:00', bis: '11:00' }
    }
    aufgaben.push(aufgabe)
  }

  return aufgaben
}

// Häufigsten Stundenwert als Standard nehmen, Abweichungen als stundenJeTag
function bauAufgabe(uid, vorlage, stundenJeTag) {
  const tage = Object.keys(stundenJeTag)
  const haeufigkeit = {}
  for (const tag of tage) {
    const w = stundenJeTag[tag]
    haeufigkeit[w] = (haeufigkeit[w] || 0) + 1
  }
  const standard = Number(Object.entries(haeufigkeit)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 0)

  const abweichungen = {}
  for (const tag of tage) {
    if (stundenJeTag[tag] !== standard) abweichungen[tag] = stundenJeTag[tag]
  }

  return {
    id: uid(),
    name: vorlage.name,
    bereich: vorlage.bereich || null,
    modus: vorlage.modus,
    fenster: null,
    tage: TAGE.filter(t => tage.includes(t)),
    stunden: standard,
    stundenJeTag: abweichungen,
    prioritaet: vorlage.prioritaet ?? 3,
    budgetQuelle: 'filiale',
    aktiv: true,
  }
}

// Alte kassenPeaks → Stoßzeiten (nur die Zeitfenster, ohne Anzahl)
export function stosszeitenAusPeaks(filiale) {
  return (filiale.kassenPeaks || []).map(p => ({
    tage: [...(p.tage || [])], von: p.von, bis: p.bis,
  }))
}

export function neueAufgabe(uid) {
  return {
    id: uid(),
    name: 'Neue Aufgabe',
    bereich: null,
    modus: 'frei',
    fenster: null,
    tage: [...TAGE],
    stunden: 1,
    stundenJeTag: {},
    prioritaet: 3,
    budgetQuelle: 'filiale',
    aktiv: true,
  }
}
