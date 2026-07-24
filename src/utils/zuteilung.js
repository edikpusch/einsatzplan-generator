// Pausen-Platzierung + Aufgaben-Zuteilung.
// Beides wird IMMER neu berechnet und nie gespeichert – so kann die
// Zuteilung nie mit dem Plan auseinanderlaufen.
import { TAGE, TAG_NAMEN, toMin, toHHMM, dauerHHMM, overlapMin } from './zeit'
import { kannBereich, bereichsPrio } from './rollen'
import {
  arbeitsFenster, stosszeitenAm, tagesBloecke, giltAm, stundenFuerTag,
} from './aufgaben'

const RASTER = 15 // Minuten-Raster für Pausen

// ---------------------------------------------------------------------------
// Pausen platzieren: Schichtmitte, Stoßzeiten meidend, versetzt zueinander.
// Deterministisch – gleiche Eingabe ergibt immer dieselbe Lage.
// ---------------------------------------------------------------------------
export function platziereePausen({ schichten, filiale, tag }) {
  const fenster = arbeitsFenster(filiale, tag)
  const peaks = fenster ? stosszeitenAm(filiale, tag, fenster.auf, fenster.zu) : []
  const gesetzt = []
  const erg = {}

  const sortiert = [...schichten].sort((a, b) =>
    (a.von - b.von) || String(a.maId).localeCompare(String(b.maId)))

  for (const s of sortiert) {
    const dauer = s.pauseMin || 0
    if (dauer <= 0) continue
    // Nicht in der ersten/letzten Stunde der Schicht
    const frueheste = s.von + 60
    const spaeteste = s.bis - 60 - dauer
    if (spaeteste < frueheste) {
      // Sehr kurze Schicht: mittig, ohne Randabstand
      const von = Math.round((s.von + s.bis - dauer) / 2)
      erg[s.maId] = { von, bis: von + dauer }
      gesetzt.push(erg[s.maId])
      continue
    }

    const mitte = (s.von + s.bis) / 2
    let beste = null, besterScore = Infinity
    for (let start = Math.ceil(frueheste / RASTER) * RASTER; start <= spaeteste; start += RASTER) {
      const ende = start + dauer
      let score = 0
      for (const p of peaks) score += overlapMin(start, ende, p.von, p.bis) * 10
      for (const g of gesetzt) score += overlapMin(start, ende, g.von, g.bis) * 4
      score += Math.abs((start + ende) / 2 - mitte) / 15
      if (score < besterScore) { besterScore = score; beste = { von: start, bis: ende } }
    }
    if (beste) { erg[s.maId] = beste; gesetzt.push(beste) }
  }
  return erg
}

// ---------------------------------------------------------------------------
// Aufgaben-Zuteilung eines Tages
// ---------------------------------------------------------------------------
// Rückgabe:
//   jeMitarbeiter: { maId: [{ von, bis, name }] }  – für die Schicht-Zelle
//   jeAufgabe:     { aufgabeId: { sollMin, erledigtMin } }
//   pausen:        { maId: { von, bis } }
//   meldungen:     [{ schwere, tag, text }]
export function verteileAufgaben({ tag, filiale, aufgaben, mitarbeiter, plan }) {
  const leer = { jeMitarbeiter: {}, jeAufgabe: {}, pausen: {}, meldungen: [] }
  const fenster = arbeitsFenster(filiale, tag)
  if (!fenster) return leer
  const { auf, zu } = fenster

  const maById = Object.fromEntries(mitarbeiter.map(m => [m.id, m]))
  const schichten = []
  for (const ma of mitarbeiter) {
    const z = plan?.[ma.id]?.[tag]
    if (z?.art !== 'arbeit') continue
    const von = toMin(z.von), bis = toMin(z.bis)
    if (von == null || bis == null || bis <= von) continue
    schichten.push({ maId: ma.id, von, bis, pauseMin: z.pauseMin || 0 })
  }
  if (schichten.length === 0) return leer

  const pausen = platziereePausen({ schichten, filiale, tag })
  const bloecke = tagesBloecke({ aufgaben, filiale, tag })
  const aufgabeById = Object.fromEntries((aufgaben || []).map(a => [a.id, a]))

  // Soll-Minuten je Aufgabe (für die Rest-Verfolgung der freien Aufgaben)
  const jeAufgabe = {}
  for (const a of aufgaben || []) {
    if (!giltAm(a, tag)) continue
    jeAufgabe[a.id] = {
      sollMin: Math.round(stundenFuerTag(a, tag) * 60),
      erledigtMin: 0,
      name: a.name,
    }
  }

  // Abschnittsgrenzen: Schichten, Pausen, Bedarfsblöcke
  const punkte = new Set([auf, zu])
  const merke = t => { if (t > auf && t < zu) punkte.add(t) }
  for (const s of schichten) { merke(s.von); merke(s.bis) }
  for (const p of Object.values(pausen)) { merke(p.von); merke(p.bis) }
  for (const b of bloecke) { merke(b.von); merke(b.bis) }
  const grenzen = [...punkte].sort((a, b) => a - b)

  const jeMitarbeiter = {}
  const meldungen = []
  const offeneSlots = [] // { von, bis, name, wegenPause }

  for (let i = 0; i < grenzen.length - 1; i++) {
    const von = grenzen[i], bis = grenzen[i + 1]
    const dauer = bis - von
    if (dauer <= 0) continue

    // Wer ist da (und nicht in der Pause)?
    const anwesend = schichten
      .filter(s => s.von <= von && s.bis >= bis)
      .filter(s => {
        const p = pausen[s.maId]
        return !(p && p.von < bis && p.bis > von)
      })
      .map(s => maById[s.maId])
      .filter(Boolean)
    if (anwesend.length === 0) continue

    const belegt = new Set()

    // 1. Vertretung zuerst – belegt niemanden, läuft nebenher
    const vertreter = anwesend
      .filter(m => kannBereich(m, 'vertreter'))
      .sort((a, b) => bereichsPrio(a, 'vertreter') - bereichsPrio(b, 'vertreter'))[0]
    if (vertreter) notiere(jeMitarbeiter, vertreter.id, von, bis, 'Vertretung')

    // 2. Pflicht-Plätze (durchgehend / im Fenster)
    const slots = []
    for (const b of bloecke) {
      if (b.von > von || b.bis < bis) continue
      const a = aufgabeById[b.aufgabeId]
      if (!a) continue
      for (let k = 0; k < b.koepfe; k++) slots.push(a)
    }
    // Knappste Plätze zuerst besetzen: sonst verbraucht ein Allrounder
    // sich an einer Aufgabe, die viele erledigen könnten.
    const kandidatenZahl = a => anwesend.filter(m => darf(m, a)).length
    slots.sort((x, y) =>
      (kandidatenZahl(x) - kandidatenZahl(y)) ||
      ((x.prioritaet || 9) - (y.prioritaet || 9)))

    for (const a of slots) {
      const kandidat = anwesend
        .filter(m => !belegt.has(m.id) && darf(m, a))
        .sort((m1, m2) => vergleiche(m1, m2, a))[0]
      if (kandidat) {
        belegt.add(kandidat.id)
        notiere(jeMitarbeiter, kandidat.id, von, bis, a.name)
        if (jeAufgabe[a.id]) jeAufgabe[a.id].erledigtMin += dauer
      } else {
        const wegenPause = Object.values(pausen).some(p => p.von < bis && p.bis > von)
        offeneSlots.push({ von, bis, name: a.name, wegenPause })
      }
    }

    // 3. Übrige Personen auf die freien Aufgaben (nach Aufgaben-Priorität)
    const uebrig = anwesend.filter(m => !belegt.has(m.id))
    const freieAufgaben = (aufgaben || [])
      .filter(a => giltAm(a, tag) && a.modus === 'frei')
      .filter(a => (jeAufgabe[a.id]?.sollMin || 0) > (jeAufgabe[a.id]?.erledigtMin || 0))
      .sort((x, y) => (x.prioritaet || 9) - (y.prioritaet || 9))

    for (const m of uebrig) {
      const a = freieAufgaben.find(x =>
        darf(m, x) && jeAufgabe[x.id].erledigtMin < jeAufgabe[x.id].sollMin)
      if (!a) continue
      const rest = jeAufgabe[a.id].sollMin - jeAufgabe[a.id].erledigtMin
      jeAufgabe[a.id].erledigtMin += Math.min(dauer, rest)
      notiere(jeMitarbeiter, m.id, von, bis, a.name)
    }
  }

  // Offene Plätze zusammenfassen (sonst eine Meldung je Abschnitt)
  for (const s of fasseZusammen(offeneSlots)) {
    meldungen.push({
      schwere: 'gelb', tag,
      text: `${TAG_NAMEN[tag]} ${toHHMM(s.von)}–${toHHMM(s.bis)}: ${s.name} nicht besetzt${s.wegenPause ? ' (Pause)' : ''}`,
    })
  }

  // Nicht erledigte Aufgaben-Stunden
  for (const [id, w] of Object.entries(jeAufgabe)) {
    const offen = w.sollMin - w.erledigtMin
    if (offen > 15) {
      meldungen.push({
        schwere: 'gelb', tag,
        text: `${TAG_NAMEN[tag]}: ${w.name} – ${dauerHHMM(offen)} nicht erledigt (Priorität ${aufgabeById[id]?.prioritaet ?? '–'})`,
      })
    }
  }

  // Anzeige-Blöcke je MA zusammenfassen
  for (const maId of Object.keys(jeMitarbeiter)) {
    jeMitarbeiter[maId] = verschmelze(jeMitarbeiter[maId])
  }

  return { jeMitarbeiter, jeAufgabe, pausen, meldungen }
}

// Darf dieser MA die Aufgabe übernehmen? (bereich null = jeder)
function darf(ma, aufgabe) {
  return !aufgabe.bereich || kannBereich(ma, aufgabe.bereich)
}

// Beste Prio zuerst; bei Gleichstand die ID, damit es reproduzierbar bleibt.
// Wer für eine ANDERE Aufgabe eine bessere eigene Prio hat, wird hier
// leicht benachteiligt – so bleibt er für seine Stärke frei.
function vergleiche(m1, m2, aufgabe) {
  const p1 = aufgabe.bereich ? bereichsPrio(m1, aufgabe.bereich) : 5
  const p2 = aufgabe.bereich ? bereichsPrio(m2, aufgabe.bereich) : 5
  if (p1 !== p2) return p1 - p2
  return String(m1.id).localeCompare(String(m2.id))
}

function notiere(ziel, maId, von, bis, name) {
  if (!ziel[maId]) ziel[maId] = []
  ziel[maId].push({ von, bis, name })
}

// Gleiche Aufgabe in aufeinanderfolgenden Abschnitten zu einem Block
function verschmelze(bloecke) {
  const sortiert = [...bloecke].sort((a, b) => a.von - b.von || a.name.localeCompare(b.name))
  const erg = []
  for (const b of sortiert) {
    const letzte = erg.find(x => x.name === b.name && x.bis === b.von)
    if (letzte) letzte.bis = b.bis
    else erg.push({ ...b })
  }
  return erg.sort((a, b) => a.von - b.von)
}

function fasseZusammen(slots) {
  const erg = []
  for (const s of [...slots].sort((a, b) => a.von - b.von || a.name.localeCompare(b.name))) {
    const letzte = erg.find(x => x.name === s.name && x.bis === s.von)
    if (letzte) { letzte.bis = s.bis; letzte.wegenPause = letzte.wegenPause || s.wegenPause }
    else erg.push({ ...s })
  }
  return erg
}

// Alle Tage einer Woche auf einmal (für Prüfung und Anzeige)
export function verteileWoche({ filiale, aufgaben, mitarbeiter, plan }) {
  const erg = {}
  for (const tag of TAGE) {
    erg[tag] = verteileAufgaben({ tag, filiale, aufgaben, mitarbeiter, plan })
  }
  return erg
}
