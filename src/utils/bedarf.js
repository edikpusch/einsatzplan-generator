// Bedarfsrechnung: Vorgangskatalog + Lieferungen + Kassen-Dauerbesetzung
// → Personenstunden-Bedarf pro Tag/Woche, gegen das Wochenbudget gestellt.
// Alles in JS vorberechnet, Min/Max-Spannen werden mitgeführt.
import { TAGE, toMin, overlapMin, tagDatum } from './zeit'
import { effektiverKatalog, LIEFERART_LABELS, zeitankerSort } from './katalog'

// "≈ 6,5 h" – Bedarfs-Anzeige in Stunden mit Komma
export function stdText(min) {
  if (min == null || isNaN(min)) return '0 h'
  const h = min / 60
  const gerundet = Math.round(h * 10) / 10
  return String(gerundet).replace('.', ',') + ' h'
}

export function spanneText(minMin, maxMin) {
  if (minMin === maxMin) return stdText(minMin)
  return stdText(minMin) + '–' + stdText(maxMin)
}

// ── Lieferungen der Woche aus dem Filial-Lieferprofil vorbelegen ─────────────
export function lieferungenVorbelegen(filiale) {
  const profil = filiale?.lieferprofil
  if (!profil) return []
  const erg = []
  for (const art of ['frische', 'trocken', 'tk', 'mopro']) {
    const p = profil[art]
    if (!p) continue
    for (const tag of p.tage || []) {
      erg.push({ tag, art, paletten: Number(p.typischePaletten) || 1 })
    }
  }
  const reihenfolge = Object.fromEntries(TAGE.map((t, i) => [t, i]))
  return erg.sort((a, b) => reihenfolge[a.tag] - reihenfolge[b.tag])
}

// ── Fällige Inventuren/Saison-Vorgänge dieser Woche vorschlagen ──────────────
// Heuristik: monatlich = die Woche enthält das ERSTE Vorkommen des Ziel-
// Wochentags im Kalendermonat. alle2monate: nur in ungeraden Monaten (Jan,
// Mär, …), alle4monate: Jan/Mai/Sep. Nutzer kann im Bedarf-Tab an-/abwählen.
export function faelligeInventuren(jahr, kw, katalog) {
  const erg = []
  for (const vorgang of katalog) {
    if (!vorgang.aktiv) continue
    if (!['monatlich', 'alle2monate', 'alle4monate'].includes(vorgang.rhythmus)) continue
    const zielTag = vorgang.wochentage?.[0] || 'mo'
    const idx = TAGE.indexOf(zielTag)
    const datum = tagDatum(jahr, kw, idx >= 0 ? idx : 0)
    const istErsterImMonat = datum.getDate() <= 7
    if (!istErsterImMonat) continue
    const monat = datum.getMonth() // 0-basiert
    if (vorgang.rhythmus === 'alle2monate' && monat % 2 !== 0) continue
    if (vorgang.rhythmus === 'alle4monate' && monat % 4 !== 0) continue
    erg.push({ vorgangId: vorgang.id, tag: zielTag })
  }
  return erg
}

// ── Kassen-Dauerbesetzung eines Tages (Minuten) ──────────────────────────────
function kassenBedarfMin(filiale, tag) {
  const oz = filiale.oeffnungszeiten?.[tag]
  if (!oz?.offen) return 0
  const auf = toMin(oz.auf), zu = toMin(oz.zu)
  if (auf == null || zu == null || zu <= auf) return 0
  const standard = Number(filiale.kassenStandard) || 0
  let min = standard * (zu - auf)
  for (const peak of filiale.kassenPeaks || []) {
    if (!peak.tage?.includes(tag)) continue
    const extra = (Number(peak.anzahl) || 0) - standard
    if (extra <= 0) continue
    min += extra * overlapMin(auf, zu, toMin(peak.von) ?? 0, toMin(peak.bis) ?? 0)
  }
  return min
}

// ── Bedarf eines Tages ────────────────────────────────────────────────────────
// Rückgabe: { posten[], minMin, maxMin, externMinMin, externMaxMin }
// posten: { name, quelle:'vorgang'|'lieferung'|'kasse', minMin, maxMin,
//           extern, zeitanker, rolle, personen, vorgangId? }
export function tagesBedarf({ tag, filiale, katalog, woche }) {
  const posten = []
  const offen = !!filiale.oeffnungszeiten?.[tag]?.offen
  const kat = effektiverKatalog(katalog, filiale)
  const zusatz = woche?.inventurenDiesenMonat || []

  for (const vorgang of kat) {
    if (!vorgang.aktiv) continue
    let faelligHeute = false
    if (vorgang.rhythmus === 'taeglich') {
      faelligHeute = offen
    } else if (vorgang.rhythmus === 'woechentlich') {
      faelligHeute = vorgang.wochentage?.length > 0 && vorgang.wochentage.includes(tag)
    } else if (['monatlich', 'alle2monate', 'alle4monate', 'saison'].includes(vorgang.rhythmus)) {
      faelligHeute = zusatz.some(z => z.vorgangId === vorgang.id && z.tag === tag)
    }
    if (!faelligHeute) continue

    posten.push({
      vorgangId: vorgang.id,
      name: vorgang.name,
      quelle: 'vorgang',
      minMin: vorgang.personen.min * vorgang.dauerMin.min,
      maxMin: vorgang.personen.max * vorgang.dauerMin.max,
      extern: vorgang.budgetQuelle === 'extern',
      zeitanker: vorgang.zeitanker,
      rolle: vorgang.rolle,
      personen: vorgang.personen,
    })
  }

  // Lieferungen des Tages: 30 min Annahme + Paletten × Verräumfaktor
  const faktoren = filiale.palettenFaktoren || {}
  for (const lieferung of woche?.lieferungen || []) {
    if (lieferung.tag !== tag) continue
    const faktor = Number(faktoren[lieferung.art]) || 45
    const paletten = Number(lieferung.paletten) || 0
    const dauer = 30 + paletten * faktor
    posten.push({
      name: `Lieferung ${LIEFERART_LABELS[lieferung.art] || lieferung.art} (${paletten} Pal.)`,
      quelle: 'lieferung',
      minMin: dauer,
      maxMin: dauer,
      extern: false,
      zeitanker: filiale.lieferprofil?.[lieferung.art]?.zeitpunkt === 'frueh' ? 'frueh' : null,
      rolle: null,
      personen: null,
    })
  }

  // Kassen-Dauerbesetzung über die Öffnungszeit
  const kasse = kassenBedarfMin(filiale, tag)
  if (kasse > 0) {
    posten.push({
      name: 'Kassen-Dauerbesetzung (Standard + Peaks)',
      quelle: 'kasse',
      minMin: kasse,
      maxMin: kasse,
      extern: false,
      zeitanker: null,
      rolle: 'kassierer',
      personen: null,
    })
  }

  posten.sort((a, b) => zeitankerSort(a.zeitanker) - zeitankerSort(b.zeitanker))

  let minMin = 0, maxMin = 0, externMinMin = 0, externMaxMin = 0
  for (const p of posten) {
    if (p.extern) { externMinMin += p.minMin; externMaxMin += p.maxMin }
    else { minMin += p.minMin; maxMin += p.maxMin }
  }
  return { posten, minMin, maxMin, externMinMin, externMaxMin }
}

// ── Bedarf der ganzen Woche ──────────────────────────────────────────────────
// flexPosten = wöchentliche Vorgänge ohne festen Tag (einmal pro Woche zählen)
export function wochenBedarf({ filiale, katalog, woche }) {
  const tage = {}
  let minMin = 0, maxMin = 0, externMinMin = 0, externMaxMin = 0
  for (const tag of TAGE) {
    const t = tagesBedarf({ tag, filiale, katalog, woche })
    tage[tag] = t
    minMin += t.minMin
    maxMin += t.maxMin
    externMinMin += t.externMinMin
    externMaxMin += t.externMaxMin
  }

  const flexPosten = []
  for (const vorgang of effektiverKatalog(katalog, filiale)) {
    if (!vorgang.aktiv) continue
    if (vorgang.rhythmus !== 'woechentlich' || vorgang.wochentage?.length > 0) continue
    const p = {
      vorgangId: vorgang.id,
      name: vorgang.name,
      minMin: vorgang.personen.min * vorgang.dauerMin.min,
      maxMin: vorgang.personen.max * vorgang.dauerMin.max,
      extern: vorgang.budgetQuelle === 'extern',
      rolle: vorgang.rolle,
      personen: vorgang.personen,
    }
    flexPosten.push(p)
    if (p.extern) { externMinMin += p.minMin; externMaxMin += p.maxMin }
    else { minMin += p.minMin; maxMin += p.maxMin }
  }

  return { tage, flexPosten, minMin, maxMin, externMinMin, externMaxMin }
}

// ── Ampel: Wochenbedarf (Mittelwert) vs. Budget ──────────────────────────────
// grün = passt, gelb = knapp (< 5 % Luft), rot = Bedarf > Budget
export function budgetAmpel(bedarf, budgetMin) {
  const mittel = (bedarf.minMin + bedarf.maxMin) / 2
  if (budgetMin <= 0) return { farbe: 'grau', mittel }
  if (mittel > budgetMin) return { farbe: 'rot', mittel }
  if (budgetMin - mittel < 0.05 * budgetMin) return { farbe: 'gelb', mittel }
  return { farbe: 'gruen', mittel }
}
