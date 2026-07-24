// Phase B: Auto-Vorschlags-Engine (greedy + Prüf-Layer).
// Schreibt Vorschläge in eine KOPIE des Plans – erst "Übernehmen" im Editor
// speichert. Bestehende Zellen (Arbeit + Status/Abwesenheit) werden nie
// verändert. Konflikte werden gemeldet, nie still ein unzulässiger Plan.
//
// Objective (Spec docs/PROMPT-PhaseA.md, Abschnitt Phase B):
// - Budget = harte Obergrenze
// - Festangestellte >= Vertragsstunden (Überschreitung erlaubt für Abdeckung)
// - GfB als Puffer; GfB-Monatsverdienst möglichst unter der Grenze
//   (weiche Nebenbedingung; Spätschichten bei GfB sparsam wegen Zuschlägen)
// - Harte Regeln: Ruhezeit 11h, Azubi (8h, keine Spätarbeit, Berufsschule),
//   Verfügbarkeit, Pausen-Automatik, ein Schichtblock pro MA und Tag.
import {
  TAGE, TAG_NAMEN, toMin, toHHMM, autoPause, dauerHHMM, tagDatum, monatKey,
  overlapMin, euroFormat, monatName,
} from './zeit'
import { schichtVerdienst, gfbMonatsWerte } from './gfb'
import { kannBereich, bereichsPrio, istPlanbar } from './rollen'
import {
  tagesKurve, kopfBedarfZu, sollMinutenTag, arbeitsFenster,
} from './aufgaben'

// Reinigungskräfte plant die Engine nicht ein (kein Verkaufs-Personal);
// ihre manuell geplanten Schichten zählen aber weiter zum Budget.
// Dauerhaft Abwesende (Elternzeit o. ä.) werden nie eingeplant.
function planbar(ma) {
  return ma.funktion !== 'Reinigungskraft Lebensmittel' && istPlanbar(ma)
}

// Rollen-Bonus, nach Priorität gestaffelt: Prio 1 wird vor Prio 2 gezogen.
// Basiswert je Bereich, minus 200 pro Prio-Stufe.
function prioBonus(ma, bereich, basis) {
  if (!kannBereich(ma, bereich)) return 0
  const prio = Math.min(bereichsPrio(ma, bereich), 15)
  return basis - (prio - 1) * 200
}

function maName(ma) {
  return (ma.vorname + ' ' + ma.name).trim() || 'MA'
}

// Schichtvorlagen der Filiale als Minuten-Fenster; ohne Vorlagen werden
// zwei Schichten aus den Öffnungszeiten synthetisiert (15 min Übergabe).
function tagesVorlagen(filiale, auf, zu) {
  const vs = (filiale.schichtvorlagen || [])
    .map(v => ({ name: v.name, von: toMin(v.von), bis: toMin(v.bis) }))
    .filter(v => v.von != null && v.bis != null && v.bis > v.von)
    .sort((a, b) => a.von - b.von)
  if (vs.length > 0) return vs
  const mitte = Math.round((auf + zu) / 2 / 15) * 15
  return [
    { name: 'Früh', von: auf, bis: Math.min(zu, mitte + 15) },
    { name: 'Spät', von: Math.max(auf, mitte - 15), bis: zu },
  ]
}

// Kopfbedarf zum Zeitpunkt t – kommt jetzt aus der Soll-Kurve der
// Tagesaufgaben (siehe utils/aufgaben.js), plus Sondertag-Zusatzköpfe.
function kopfBedarf(t, kurve, zusatz) {
  return Math.max(1, kopfBedarfZu(kurve, t)) + zusatz
}

// Größte Unterdeckung (Köpfe) innerhalb eines Fensters – Sweep über
// Ereignispunkte (Fenstergrenzen, Kurvenstufen, Intervallgrenzen).
function maxDefizit({ wVon, wBis, kurve, zusatz, intervalle }) {
  if (wBis <= wVon) return 0
  const punkte = new Set([wVon, wBis])
  for (const a of kurve) {
    for (const x of [a.von, a.bis]) {
      if (x > wVon && x < wBis) punkte.add(x)
    }
  }
  for (const iv of intervalle) {
    if (iv.von > wVon && iv.von < wBis) punkte.add(iv.von)
    if (iv.bis > wVon && iv.bis < wBis) punkte.add(iv.bis)
  }
  const sortiert = [...punkte].sort((a, b) => a - b)
  let max = 0
  for (let i = 0; i < sortiert.length - 1; i++) {
    const t = (sortiert[i] + sortiert[i + 1]) / 2
    const deckung = intervalle.filter(iv => iv.von < t && iv.bis > t).length
    max = Math.max(max, kopfBedarf(t, kurve, zusatz) - deckung)
  }
  return max
}

// Zuschlagsminuten einer Schicht (für die "GfB spät sparsam"-Strafe)
function zuschlagMinuten(von, bis, zuschlaege) {
  let min = 0
  for (const z of zuschlaege || []) {
    const zv = toMin(z.von)
    let zb = toMin(z.bis)
    if (zb === 23 * 60 + 59) zb = 24 * 60
    min += overlapMin(von, bis, zv ?? 0, zb ?? 0)
  }
  return min
}

export function erzeugeVorschlag({
  woche, filiale, mitarbeiter, profile, alleWochen, nurSollBedarf = false,
}) {
  const konflikte = []
  const neue = [] // { maId, tag, von, bis }
  const plan = JSON.parse(JSON.stringify(woche.plan || {}))
  const pool = mitarbeiter.filter(planbar)
  const budgetMin = Math.round((Number(filiale.wochenstundenBudget) || 0) * 60)
  // Tagesaufgaben: Wochen-Kopie hat Vorrang vor dem Filial-Standard
  const aufgaben = woche.tagesaufgaben || filiale.tagesaufgaben || []
  const kurven = Object.fromEntries(
    TAGE.map(tag => [tag, tagesKurve({ aufgaben, filiale, tag })]))

  // Ausgangslage: verplante Minuten (ALLE MA zählen zum Budget)
  let usedMin = 0
  const maMin = {}, maTage = {}
  for (const ma of mitarbeiter) {
    maMin[ma.id] = 0
    maTage[ma.id] = 0
    for (const tag of TAGE) {
      const z = plan[ma.id]?.[tag]
      if (z?.art === 'arbeit') {
        maMin[ma.id] += z.stdMin || 0
        usedMin += z.stdMin || 0
        maTage[ma.id]++
      }
    }
  }

  // Vertragsstunden der Festen vs. Budget (Konflikt-Check lt. Spec)
  const vertragMin = {}
  let summeVertrag = 0
  for (const ma of pool) {
    if (ma.typ !== 'fest') continue
    vertragMin[ma.id] = Math.round((Number(ma.vertragsstunden) || 0) * 60)
    summeVertrag += vertragMin[ma.id]
  }
  if (budgetMin > 0 && summeVertrag > budgetMin) {
    konflikte.push({
      schwere: 'rot',
      text: `Budget ${dauerHHMM(budgetMin)} ist kleiner als die Summe der Vertragsstunden (${dauerHHMM(summeVertrag)}) – nicht alle Festen erreichen ihre Stunden`,
    })
  }

  // GfB: Monats-Basis (alle gespeicherten Wochen inkl. aktueller) + Grenze
  const gfbBasis = {}, gfbNeu = {}, gfbGrenze = {}
  for (const ma of pool) {
    if (ma.typ !== 'gfb') continue
    gfbBasis[ma.id] = {}
    gfbNeu[ma.id] = {}
    const werte = gfbMonatsWerte(ma, alleWochen, profile)
    for (const k of Object.keys(werte)) gfbBasis[ma.id][k] = werte[k].euro
    gfbGrenze[ma.id] = Number(ma.verdienstgrenze) || profile.minijobGrenze || 0
  }

  function schichtEuro(ma, von, bis) {
    const pause = autoPause(bis - von)
    const lohn = Number(ma.stundenlohn) || profile.mindestlohn || 0
    return schichtVerdienst(toHHMM(von), toHHMM(bis), pause, lohn, profile.zuschlaege)
  }

  // Arbeits-Intervalle eines Tages (nur planbares Personal → Abdeckung)
  function intervalleAm(tag) {
    const erg = []
    for (const ma of pool) {
      const z = plan[ma.id]?.[tag]
      if (z?.art !== 'arbeit') continue
      const v = toMin(z.von), b = toMin(z.bis)
      if (v != null && b != null && b > v) erg.push({ von: v, bis: b, maId: ma.id })
    }
    return erg
  }

  // Harte Regeln – darf dieser MA diese Schicht an diesem Tag arbeiten?
  function kannArbeiten(ma, tagIdx, von, bis, netto) {
    const tag = TAGE[tagIdx]
    if (plan[ma.id]?.[tag]) return false // Zelle belegt (Arbeit ODER Status)
    const verf = ma.verfuegbarkeit?.[tag]
    if (verf) {
      if (verf.verfuegbar === false) return false
      const vv = toMin(verf.von), vb = toMin(verf.bis)
      if (vv != null && von < vv) return false
      if (vb != null && bis > vb) return false
    }
    if (ma.azubi) {
      if (ma.berufsschultage?.includes(tag)) return false
      if (netto > 8 * 60) return false
      if (bis > 20 * 60) return false // keine Spätarbeit
    }
    // Ruhezeit >= 11h zu Vor- und Folgetag
    if (tagIdx > 0) {
      const z = plan[ma.id]?.[TAGE[tagIdx - 1]]
      if (z?.art === 'arbeit') {
        const ende = toMin(z.bis)
        if (ende != null && (24 * 60 - ende) + von < 11 * 60) return false
      }
    }
    if (tagIdx < TAGE.length - 1) {
      const z = plan[ma.id]?.[TAGE[tagIdx + 1]]
      if (z?.art === 'arbeit') {
        const start = toMin(z.von)
        if (start != null && (24 * 60 - bis) + start < 11 * 60) return false
      }
    }
    if (budgetMin > 0 && usedMin + netto > budgetMin) return false // Budget hart
    return true
  }

  // Rest-Vertragsstunden bzw. bereits aufgelaufene Überstunden eines Festen
  function restVertrag(ma) {
    if (ma.typ !== 'fest') return 0
    return (vertragMin[ma.id] || 0) - maMin[ma.id]
  }
  function ueberstundenMin(ma) {
    if (ma.typ !== 'fest') return 0
    return Math.max(0, maMin[ma.id] - (vertragMin[ma.id] || 0))
  }

  // Einsatz-Stufe (kleiner = zuerst) – die harte Reihenfolge:
  //   0 Feste, die ihre Vertragsstunden noch nicht voll haben
  //   1 GfB/Aushilfen als Puffer
  //   2 Feste in Überstunden (nur wenn sonst niemand kann)
  // Ausnahme: Fehlt eine Pflichtrolle (Vertreter/Bake-Off) und dieser MA
  // kann sie abdecken, darf er eine Stufe aufsteigen – sonst bliebe eine
  // Schicht ohne Schlüsselträger, nur um Überstunden zu vermeiden.
  function stufe(ma, rollen) {
    let s
    if (ma.typ === 'fest') s = restVertrag(ma) > 0 ? 0 : 2
    else s = 1
    const rettetRolle =
      (rollen.fehltVertreter && kannBereich(ma, 'vertreter')) ||
      (rollen.fehltBakeoff && kannBereich(ma, 'bakeoff'))
    if (rettetRolle) s = Math.max(0, s - 1)
    return s
  }

  // Score innerhalb einer Stufe: kleiner = besser.
  function score(ma, tagIdx, von, bis, rollen) {
    let s = 0
    if (ma.typ === 'fest') {
      const rest = restVertrag(ma)
      if (rest > 0) {
        s -= rest // größtes Vertrags-Defizit zuerst
      } else {
        // Überstunden möglichst gerecht verteilen: wer bisher am wenigsten
        // Überstunden hat, wird als Nächster gezogen.
        s += ueberstundenMin(ma) * 2
      }
    } else {
      s += zuschlagMinuten(von, bis, profile.zuschlaege) * 3 // spät sparsam
      const d = tagDatum(woche.jahr, woche.kw, tagIdx)
      const mk = monatKey(d)
      const projektion = (gfbBasis[ma.id]?.[mk] || 0) + (gfbNeu[ma.id]?.[mk] || 0)
        + schichtEuro(ma, von, bis)
      const grenze = gfbGrenze[ma.id]
      if (grenze > 0) {
        if (projektion > grenze) s += 1000000        // nur als allerletzte Option
        else if (projektion >= grenze * 0.9) s += 3000
      }
    }
    // Pflichtrollen: nach Priorität gestaffelt (Prio 1 vor Prio 2 vor …)
    if (rollen.fehltVertreter) s -= prioBonus(ma, 'vertreter', 3000)
    if (rollen.fehltBakeoff) s -= prioBonus(ma, 'bakeoff', 2500)
    if (rollen.fehltPacken) s -= prioBonus(ma, 'packen', 2000)
    if (rollen.fehltKasse) s -= prioBonus(ma, 'kasse', 1500)
    s += maTage[ma.id] * 20 // leichte Streuung über die Woche
    return s
  }

  // Besten Kandidaten wählen: erst nach Stufe, dann nach Score.
  function besterKandidat(tagIdx, von, bis, netto, rollen) {
    let bester = null, besteStufe = Infinity, besterScore = Infinity
    for (const ma of pool) {
      if (!kannArbeiten(ma, tagIdx, von, bis, netto)) continue
      const st = stufe(ma, rollen)
      if (st > besteStufe) continue
      const s = score(ma, tagIdx, von, bis, rollen)
      if (st < besteStufe || s < besterScore) {
        besteStufe = st; besterScore = s; bester = ma
      }
    }
    return bester
  }

  function zuweisen(ma, tagIdx, von, bis, vertreter) {
    const tag = TAGE[tagIdx]
    const brutto = bis - von
    const pauseMin = autoPause(brutto)
    const netto = brutto - pauseMin
    if (!plan[ma.id]) plan[ma.id] = {}
    plan[ma.id][tag] = {
      art: 'arbeit', von: toHHMM(von), bis: toHHMM(bis),
      pauseMin, stdMin: netto, vertreter: !!vertreter,
    }
    maMin[ma.id] += netto
    maTage[ma.id]++
    usedMin += netto
    if (ma.typ === 'gfb') {
      const mk = monatKey(tagDatum(woche.jahr, woche.kw, tagIdx))
      gfbNeu[ma.id][mk] = (gfbNeu[ma.id][mk] || 0) + schichtEuro(ma, von, bis)
    }
    neue.push({ maId: ma.id, tag, von: toHHMM(von), bis: toHHMM(bis) })
  }

  // Fehlt im Fenster eine Pflichtrolle? (bezogen auf aktuell geplante Zellen)
  function rollenStatus(tag, wVon, wBis, auf) {
    const drin = []
    for (const ma of pool) {
      const z = plan[ma.id]?.[tag]
      if (z?.art !== 'arbeit') continue
      const v = toMin(z.von), b = toMin(z.bis)
      if (v != null && b != null && v < wBis && b > wVon) drin.push({ ma, zelle: z })
    }
    const baeckerBis = toMin(filiale.baeckerFenster?.bis)
    const brauchtBakeoff = baeckerBis != null && wVon < baeckerBis && auf != null && wVon <= auf + 60
    // Packen wird nur an Liefertagen gebraucht.
    const hatLieferung = (woche.lieferungen || []).some(l => l.tag === tag)
    // Vertreter muss die Kern-Zeit des Fensters abdecken – eine Früh-Schicht,
    // die nur in die Übergabe der Spätschicht hineinragt, zählt nicht.
    const mitte = (wVon + wBis) / 2
    return {
      fehltVertreter: !drin.some(x => {
        if (!x.zelle.vertreter || !kannBereich(x.ma, 'vertreter')) return false
        const v = toMin(x.zelle.von), b = toMin(x.zelle.bis)
        return v != null && b != null && v <= mitte && b > mitte
      }),
      fehltBakeoff: brauchtBakeoff && !drin.some(x => kannBereich(x.ma, 'bakeoff')),
      fehltPacken: hatLieferung && !drin.some(x => kannBereich(x.ma, 'packen')),
      fehltKasse: !drin.some(x => kannBereich(x.ma, 'kasse')),
      drin,
    }
  }

  // ---------- Schritt 1–4: Tages-Slots erzeugen und greedy besetzen ----------
  for (const [tagIdx, tag] of TAGE.entries()) {
    const fenster = arbeitsFenster(filiale, tag)
    if (!fenster) continue
    const { auf, zu } = fenster // nie vor dem frühesten Arbeitsbeginn
    const kurve = kurven[tag]
    const vorlagen = tagesVorlagen(filiale, auf, zu)
    const zusatz = (woche.sondertage || [])
      .filter(s => s.tag === tag)
      .reduce((s, x) => s + (Number(x.zusatzKoepfe) || 0), 0)

    for (const vor of vorlagen) {
      const wVon = Math.max(vor.von, auf), wBis = Math.min(vor.bis, zu)
      if (wBis <= wVon) continue
      const brutto = vor.bis - vor.von
      const netto = brutto - autoPause(brutto)

      let schutz = 30
      while (schutz-- > 0) {
        const defizit = maxDefizit({
          wVon, wBis, kurve, zusatz, intervalle: intervalleAm(tag),
        })
        if (defizit <= 0) break

        const rollen = rollenStatus(tag, wVon, wBis, auf)
        const bester = besterKandidat(tagIdx, vor.von, vor.bis, netto, rollen)
        if (!bester) {
          konflikte.push({
            schwere: 'rot', tag,
            text: `${TAG_NAMEN[tag]}: ${defizit} Schicht${defizit > 1 ? 'en' : ''} ${toHHMM(vor.von)}–${toHHMM(vor.bis)} unbesetzt – kein MA verfügbar oder Budget erschöpft`,
          })
          break
        }
        const alsVertreter = rollen.fehltVertreter && kannBereich(bester, 'vertreter')
        zuweisen(bester, tagIdx, vor.von, vor.bis, alsVertreter)
      }
    }

    // Pflichtrollen-Konflikte des Tages melden (pro Vorlagen-Fenster)
    for (const vor of vorlagen) {
      const wVon = Math.max(vor.von, auf), wBis = Math.min(vor.bis, zu)
      if (wBis <= wVon) continue
      const rollen = rollenStatus(tag, wVon, wBis, auf)
      if (rollen.drin.length === 0) continue
      if (rollen.fehltVertreter) {
        konflikte.push({
          schwere: 'rot', tag,
          text: `${TAG_NAMEN[tag]} ${toHHMM(wVon)}–${toHHMM(wBis)}: kein Vertreter (V) verfügbar – niemand mit Vertreter-Priorität einsetzbar`,
        })
      }
      if (rollen.fehltBakeoff) {
        konflikte.push({
          schwere: 'rot', tag,
          text: `${TAG_NAMEN[tag]}: niemand für Bake-Off im Morgen-Fenster (bis ${filiale.baeckerFenster?.bis || '–'}) verfügbar`,
        })
      }
      if (rollen.fehltPacken) {
        konflikte.push({
          schwere: 'gelb', tag,
          text: `${TAG_NAMEN[tag]}: Liefertag, aber niemand mit Packen-Priorität eingeplant`,
        })
      }
    }
  }

  // ---------- Schritt 4b: Tage auf ihre Soll-Stunden auffüllen ----------
  // Die Soll-Kurve deckt nur die zeitgebundenen Aufgaben ab. Freie Aufgaben
  // (Leergut, Frische packen …) brauchen zusätzlich Stunden – dafür wird
  // weiteres Personal eingeplant, bis das Tages-Soll erreicht ist.
  for (const [tagIdx, tag] of TAGE.entries()) {
    const fenster = arbeitsFenster(filiale, tag)
    if (!fenster) continue
    const sollMin = sollMinutenTag({ aufgaben, filiale, tag })
    if (sollMin <= 0) continue

    let schutz = 12
    while (schutz-- > 0) {
      const geplant = pool.reduce((s, ma) => {
        const z = plan[ma.id]?.[tag]
        return s + (z?.art === 'arbeit' ? (z.stdMin || 0) : 0)
      }, 0)
      if (geplant >= sollMin) break

      const vorlagen = tagesVorlagen(filiale, fenster.auf, fenster.zu)
      const rollen = rollenStatus(tag, fenster.auf, fenster.zu, fenster.auf)
      let bester = null, besteVor = null, besteStufe = Infinity, besterScore = Infinity
      for (const vor of vorlagen) {
        const brutto = vor.bis - vor.von
        const netto = brutto - autoPause(brutto)
        for (const ma of pool) {
          if (!kannArbeiten(ma, tagIdx, vor.von, vor.bis, netto)) continue
          const st = stufe(ma, rollen)
          const s = score(ma, tagIdx, vor.von, vor.bis, rollen)
          if (st < besteStufe || (st === besteStufe && s < besterScore)) {
            besteStufe = st; besterScore = s; bester = ma; besteVor = vor
          }
        }
      }
      if (!bester) break
      zuweisen(bester, tagIdx, besteVor.von, besteVor.bis,
        rollen.fehltVertreter && kannBereich(bester, 'vertreter'))
    }
  }

  // ---------- Schritt 5: Feste bis Vertragsstunden auffüllen ----------
  // Entfällt, wenn der Nutzer "nur Soll-Bedarf planen" gewählt hat.
  const feste = nurSollBedarf ? [] : pool
    .filter(m => m.typ === 'fest')
    .sort((a, b) =>
      ((vertragMin[b.id] || 0) - maMin[b.id]) - ((vertragMin[a.id] || 0) - maMin[a.id]))

  for (const ma of feste) {
    let schutz = TAGE.length
    while (schutz-- > 0 && maMin[ma.id] < (vertragMin[ma.id] || 0)) {
      let beste = null, besteDeckung = Infinity
      for (const [tagIdx, tag] of TAGE.entries()) {
        const oz = filiale.oeffnungszeiten?.[tag]
        if (!oz?.offen || plan[ma.id]?.[tag]) continue
        const auf = toMin(oz.auf), zu = toMin(oz.zu)
        if (auf == null || zu == null || zu <= auf) continue
        const intervalle = intervalleAm(tag)
        for (const vor of tagesVorlagen(filiale, auf, zu)) {
          const brutto = vor.bis - vor.von
          const netto = brutto - autoPause(brutto)
          if (!kannArbeiten(ma, tagIdx, vor.von, vor.bis, netto)) continue
          // Fenster mit der dünnsten Besetzung bevorzugen
          const t = (Math.max(vor.von, auf) + Math.min(vor.bis, zu)) / 2
          const deckung = intervalle.filter(iv => iv.von < t && iv.bis > t).length
          if (deckung < besteDeckung) {
            besteDeckung = deckung
            beste = { tagIdx, vor }
          }
        }
      }
      if (!beste) break
      const rollen = rollenStatus(TAGE[beste.tagIdx],
        Math.max(beste.vor.von, 0), beste.vor.bis, toMin(filiale.oeffnungszeiten?.[TAGE[beste.tagIdx]]?.auf))
      const alsVertreter = rollen.fehltVertreter && kannBereich(ma, 'vertreter')
      zuweisen(ma, beste.tagIdx, beste.vor.von, beste.vor.bis, alsVertreter)
    }
    const defizit = (vertragMin[ma.id] || 0) - maMin[ma.id]
    // Kein Rauschen bei Voll-Abwesenheit: nur melden, wenn der MA an
    // mindestens einem offenen Tag überhaupt frei gewesen wäre.
    const hatteFreienTag = TAGE.some(tag =>
      filiale.oeffnungszeiten?.[tag]?.offen && !plan[ma.id]?.[tag])
    if (defizit > 15 && hatteFreienTag) {
      konflikte.push({
        schwere: 'gelb',
        text: `${maName(ma)}: Vertragsstunden nicht erreicht (${dauerHHMM(maMin[ma.id])} von ${dauerHHMM(vertragMin[ma.id])})`,
      })
    }
  }

  // ---------- Schritt 6: Vertreter (V) nach Priorität vergeben ----------
  // In jedem Schicht-Fenster bekommt der anwesende MA mit der BESTEN
  // Vertreter-Priorität das V. Genau dadurch rückt Prio 2 automatisch nach,
  // wenn Prio 1 Urlaub hat oder nicht verfügbar ist.
  // Manuell gesetzte Zellen bleiben unangetastet.
  const vonEngine = new Set(neue.map(n => n.maId + '_' + n.tag))
  const schonV = new Set()
  for (const tag of TAGE) {
    const oz = filiale.oeffnungszeiten?.[tag]
    if (!oz?.offen) continue
    const auf = toMin(oz.auf), zu = toMin(oz.zu)
    if (auf == null || zu == null || zu <= auf) continue
    for (const vor of tagesVorlagen(filiale, auf, zu)) {
      const wVon = Math.max(vor.von, auf), wBis = Math.min(vor.bis, zu)
      if (wBis <= wVon) continue
      const mitte = (wVon + wBis) / 2
      const kandidaten = []
      let manuellesV = false
      for (const ma of pool) {
        const z = plan[ma.id]?.[tag]
        if (z?.art !== 'arbeit') continue
        const v = toMin(z.von), b = toMin(z.bis)
        if (v == null || b == null || !(v <= mitte && b > mitte)) continue
        const key = ma.id + '_' + tag
        if (z.vertreter && !vonEngine.has(key)) { manuellesV = true; break }
        if (vonEngine.has(key) && kannBereich(ma, 'vertreter')) kandidaten.push({ ma, z, key })
      }
      if (manuellesV || kandidaten.length === 0) continue
      kandidaten.sort((a, b) =>
        bereichsPrio(a.ma, 'vertreter') - bereichsPrio(b.ma, 'vertreter'))
      kandidaten[0].z.vertreter = true
      schonV.add(kandidaten[0].key)
      // Doppel-V im selben Fenster vermeiden – aber ein V aus einem früheren
      // Fenster (lange Schicht) nicht wieder wegnehmen.
      for (const x of kandidaten.slice(1)) {
        if (!schonV.has(x.key)) x.z.vertreter = false
      }
    }
  }

  // GfB über der Grenze? (falls die Engine als letzte Option doch zugewiesen hat)
  for (const ma of pool) {
    if (ma.typ !== 'gfb') continue
    for (const mk of Object.keys(gfbNeu[ma.id] || {})) {
      const gesamt = (gfbBasis[ma.id]?.[mk] || 0) + gfbNeu[ma.id][mk]
      const grenze = gfbGrenze[ma.id]
      if (grenze > 0 && gesamt > grenze) {
        const [j, m] = mk.split('-').map(Number)
        konflikte.push({
          schwere: 'rot',
          text: `${maName(ma)}: ${monatName(m - 1)} ${j} mit Vorschlag ${euroFormat(gesamt)} € – über der Verdienstgrenze (${euroFormat(grenze)} €)`,
        })
      }
    }
  }

  return { plan, neue, konflikte, usedMin, budgetMin }
}
