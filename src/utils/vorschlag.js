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

// Reinigungskräfte plant die Engine nicht ein (kein Verkaufs-Personal);
// ihre manuell geplanten Schichten zählen aber weiter zum Budget.
function planbar(ma) {
  return ma.funktion !== 'Reinigungskraft Lebensmittel'
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

// Kopfbedarf zum Zeitpunkt t: Grundbesetzung max(1, kassenStandard),
// während Peaks max(…, peak.anzahl), plus Sondertag-Zusatzköpfe.
function kopfBedarf(t, tag, filiale, zusatz) {
  let bedarf = Math.max(1, Number(filiale.kassenStandard) || 0)
  for (const p of filiale.kassenPeaks || []) {
    if (!p.tage?.includes(tag)) continue
    const pv = toMin(p.von), pb = toMin(p.bis)
    if (pv != null && pb != null && t >= pv && t < pb) {
      bedarf = Math.max(bedarf, Number(p.anzahl) || 0)
    }
  }
  return bedarf + zusatz
}

// Größte Unterdeckung (Köpfe) innerhalb eines Fensters – Sweep über
// Ereignispunkte (Fenstergrenzen, Peak-Grenzen, Intervallgrenzen).
function maxDefizit({ wVon, wBis, tag, filiale, zusatz, intervalle }) {
  if (wBis <= wVon) return 0
  const punkte = new Set([wVon, wBis])
  for (const p of filiale.kassenPeaks || []) {
    if (!p.tage?.includes(tag)) continue
    for (const x of [toMin(p.von), toMin(p.bis)]) {
      if (x != null && x > wVon && x < wBis) punkte.add(x)
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
    max = Math.max(max, kopfBedarf(t, tag, filiale, zusatz) - deckung)
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

export function erzeugeVorschlag({ woche, filiale, mitarbeiter, profile, alleWochen }) {
  const konflikte = []
  const neue = [] // { maId, tag, von, bis }
  const plan = JSON.parse(JSON.stringify(woche.plan || {}))
  const pool = mitarbeiter.filter(planbar)
  const budgetMin = Math.round((Number(filiale.wochenstundenBudget) || 0) * 60)

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

  // Score: kleiner = besser. Feste mit größtem Vertrags-Defizit zuerst,
  // GfB nur als Puffer; fehlende Pflichtrollen geben Bonus.
  function score(ma, tagIdx, von, bis, rollen) {
    let s = 0
    if (ma.typ === 'fest') {
      s -= (vertragMin[ma.id] || 0) - maMin[ma.id] // Defizit → negativ = gut
    } else {
      s += 5000 // Puffer-Rolle
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
    if (rollen.fehltVertreter && ma.quali?.schluesseltraeger) s -= 3000
    if (rollen.fehltBaecker && ma.quali?.baecker) s -= 2500
    if (rollen.fehltKasse && ma.quali?.kasse) s -= 1500
    s += maTage[ma.id] * 20 // leichte Streuung über die Woche
    return s
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
    const brauchtBaecker = baeckerBis != null && wVon < baeckerBis && auf != null && wVon <= auf + 60
    // Vertreter muss die Kern-Zeit des Fensters abdecken – eine Früh-Schicht,
    // die nur in die Übergabe der Spätschicht hineinragt, zählt nicht.
    const mitte = (wVon + wBis) / 2
    return {
      fehltVertreter: !drin.some(x => {
        if (!x.zelle.vertreter || !x.ma.quali?.schluesseltraeger) return false
        const v = toMin(x.zelle.von), b = toMin(x.zelle.bis)
        return v != null && b != null && v <= mitte && b > mitte
      }),
      fehltBaecker: brauchtBaecker && !drin.some(x => x.ma.quali?.baecker),
      fehltKasse: !drin.some(x => x.ma.quali?.kasse),
      drin,
    }
  }

  // ---------- Schritt 1–4: Tages-Slots erzeugen und greedy besetzen ----------
  for (const [tagIdx, tag] of TAGE.entries()) {
    const oz = filiale.oeffnungszeiten?.[tag]
    if (!oz?.offen) continue
    const auf = toMin(oz.auf), zu = toMin(oz.zu)
    if (auf == null || zu == null || zu <= auf) continue
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
          wVon, wBis, tag, filiale, zusatz, intervalle: intervalleAm(tag),
        })
        if (defizit <= 0) break

        const rollen = rollenStatus(tag, wVon, wBis, auf)
        let bester = null, besterScore = Infinity
        for (const ma of pool) {
          if (!kannArbeiten(ma, tagIdx, vor.von, vor.bis, netto)) continue
          const s = score(ma, tagIdx, vor.von, vor.bis, rollen)
          if (s < besterScore) { besterScore = s; bester = ma }
        }
        if (!bester) {
          konflikte.push({
            schwere: 'rot', tag,
            text: `${TAG_NAMEN[tag]}: ${defizit} Schicht${defizit > 1 ? 'en' : ''} ${toHHMM(vor.von)}–${toHHMM(vor.bis)} unbesetzt – kein MA verfügbar oder Budget erschöpft`,
          })
          break
        }
        const alsVertreter = rollen.fehltVertreter && !!bester.quali?.schluesseltraeger
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
          text: `${TAG_NAMEN[tag]} ${toHHMM(wVon)}–${toHHMM(wBis)}: kein Schlüsselträger als Vertreter (V) verfügbar`,
        })
      }
      if (rollen.fehltBaecker) {
        konflikte.push({
          schwere: 'rot', tag,
          text: `${TAG_NAMEN[tag]}: kein Bäcker fürs Morgen-Fenster (bis ${filiale.baeckerFenster?.bis || '–'}) verfügbar`,
        })
      }
    }
  }

  // ---------- Schritt 5: Feste bis Vertragsstunden auffüllen ----------
  const feste = pool
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
      const alsVertreter = rollen.fehltVertreter && !!ma.quali?.schluesseltraeger
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
