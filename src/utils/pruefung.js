// Prüf-Layer: Warnungen sind Hinweise, kein Zwang – der Nutzer entscheidet.
// Rückgabe: Array von { typ, schwere: 'rot'|'gelb', tag?, maId?, text }
import {
  TAGE, TAG_NAMEN, toMin, toHHMM, dauerHHMM, euroFormat,
} from './zeit'
import { gfbMonatsWerte, wochenMonate } from './gfb'
import { monatName } from './zeit'
import { tagesBedarf, stdText } from './bedarf'
import { ROLLE_LABELS } from './katalog'

// Erfüllt dieser MA die Pflicht-Rolle eines Vorgangs?
function erfuelltRolle(ma, rolle) {
  switch (rolle) {
    case 'baecker': return !!ma.quali?.baecker
    case 'kassierer': return !!ma.quali?.kasse
    case 'schluesseltraeger': return !!ma.quali?.schluesseltraeger
    case 'ml': return (ma.funktion || '').includes('Filialverantwortlicher')
    case 'reinigung': return ma.funktion === 'Reinigungskraft Lebensmittel'
    default: return true
  }
}

// Zeiträume innerhalb [start, end], in denen weniger als `bedarf` der
// Intervalle gleichzeitig aktiv sind. Rückgabe: [{ von, bis }] (Minuten).
function unterdeckung(start, end, intervalle, bedarf = 1) {
  if (start == null || end == null || end <= start) return []
  const punkte = new Set([start, end])
  for (const iv of intervalle) {
    if (iv.von < end && iv.bis > start) {
      punkte.add(Math.max(iv.von, start))
      punkte.add(Math.min(iv.bis, end))
    }
  }
  const sortiert = [...punkte].sort((a, b) => a - b)
  const luecken = []
  for (let i = 0; i < sortiert.length - 1; i++) {
    const a = sortiert[i], b = sortiert[i + 1]
    if (b <= a) continue
    const mitte = (a + b) / 2
    const anzahl = intervalle.filter(iv => iv.von < mitte && iv.bis > mitte).length
    if (anzahl < bedarf) {
      const letzte = luecken[luecken.length - 1]
      if (letzte && letzte.bis === a) letzte.bis = b
      else luecken.push({ von: a, bis: b })
    }
  }
  return luecken
}

function lueckenText(luecken) {
  return luecken.map(l => toHHMM(l.von) + '–' + toHHMM(l.bis)).join(', ')
}

function maName(ma) {
  return (ma.vorname + ' ' + ma.name).trim() || 'MA'
}

export function pruefeWoche({ woche, filiale, mitarbeiter, profile, alleWochen, katalog }) {
  const warnungen = []
  if (!woche || !filiale) return warnungen
  const plan = woche.plan || {}
  const maById = Object.fromEntries(mitarbeiter.map(m => [m.id, m]))

  // Arbeitszellen pro Tag einsammeln
  const arbeitProTag = {}
  for (const tag of TAGE) {
    arbeitProTag[tag] = []
    for (const ma of mitarbeiter) {
      const zelle = plan[ma.id]?.[tag]
      if (zelle && zelle.art === 'arbeit') {
        const von = toMin(zelle.von), bis = toMin(zelle.bis)
        if (von != null && bis != null && bis > von) {
          arbeitProTag[tag].push({ ma, zelle, von, bis })
        }
      }
    }
  }

  // 1. Budget
  let gesamtMin = 0
  for (const tag of TAGE) for (const a of arbeitProTag[tag]) gesamtMin += a.zelle.stdMin || 0
  const budgetMin = Math.round((Number(filiale.wochenstundenBudget) || 0) * 60)
  if (budgetMin > 0 && gesamtMin > budgetMin) {
    warnungen.push({
      typ: 'budget', schwere: 'rot',
      text: `Budget überschritten: ${dauerHHMM(gesamtMin)} verplant, Budget ${dauerHHMM(budgetMin)} (+${dauerHHMM(gesamtMin - budgetMin)})`,
    })
  }

  for (const [tagIdx, tag] of TAGE.entries()) {
    const oz = filiale.oeffnungszeiten?.[tag]
    const offen = oz?.offen
    const auf = toMin(oz?.auf), zu = toMin(oz?.zu)
    const arbeiten = arbeitProTag[tag]
    const tagName = TAG_NAMEN[tag]

    // 2. Vertreter (V) – Marktverantwortliche/r mit Schlüsselverantwortung
    if (arbeiten.length > 0) {
      const vertreter = arbeiten.filter(a => a.zelle.vertreter)
      if (vertreter.length === 0) {
        warnungen.push({
          typ: 'vertreter', schwere: 'rot', tag,
          text: `${tagName}: kein Vertreter (V) markiert`,
        })
      }
      for (const v of vertreter) {
        if (!v.ma.quali?.schluesseltraeger) {
          warnungen.push({
            typ: 'vertreter', schwere: 'rot', tag, maId: v.ma.id,
            text: `${tagName}: Vertreter ${maName(v.ma)} ist nicht als Schlüsselträger qualifiziert`,
          })
        }
      }
      // Mehr als ein Vertreter gleichzeitig (pro Schicht genau einer).
      // Bis 30 min Überlappung = Schicht-Übergabe (Früh-V an Spät-V), ok.
      for (let i = 0; i < vertreter.length; i++) {
        for (let j = i + 1; j < vertreter.length; j++) {
          const a = vertreter[i], b = vertreter[j]
          if (Math.min(a.bis, b.bis) - Math.max(a.von, b.von) > 30) {
            warnungen.push({
              typ: 'vertreter', schwere: 'gelb', tag,
              text: `${tagName}: mehrere Vertreter gleichzeitig (${maName(a.ma)}, ${maName(b.ma)})`,
            })
          }
        }
      }
      // Personal anwesend, aber kein Vertreter im Haus
      if (vertreter.length > 0) {
        const besetzt = unterdeckung(
          Math.min(...arbeiten.map(a => a.von)),
          Math.max(...arbeiten.map(a => a.bis)),
          vertreter, 1)
        // Nur Zeiten melden, in denen überhaupt jemand arbeitet
        const relevant = besetzt.filter(l =>
          arbeiten.some(a => a.von < l.bis && a.bis > l.von))
        if (relevant.length > 0) {
          warnungen.push({
            typ: 'vertreter', schwere: 'gelb', tag,
            text: `${tagName}: Zeit ohne Vertreter (V): ${lueckenText(relevant)}`,
          })
        }
      }
    }

    if (offen && auf != null && zu != null) {
      // 3. Bäcker-Fenster morgens
      const baeckerBis = toMin(filiale.baeckerFenster?.bis)
      if (baeckerBis != null && baeckerBis > auf && arbeiten.length > 0) {
        const baecker = arbeiten.filter(a => a.ma.quali?.baecker)
        const luecken = unterdeckung(auf, Math.min(baeckerBis, zu), baecker, 1)
        if (luecken.length > 0) {
          warnungen.push({
            typ: 'baecker', schwere: 'rot', tag,
            text: `${tagName}: kein Bäcker eingeplant (${lueckenText(luecken)})`,
          })
        }
      }

      // 4. Kassen-Besetzung (Standard + Peaks)
      const kassen = arbeiten.filter(a => a.ma.quali?.kasse)
      if (arbeiten.length > 0) {
        const standard = Number(filiale.kassenStandard) || 0
        if (standard > 0) {
          const luecken = unterdeckung(auf, zu, kassen, standard)
          if (luecken.length > 0) {
            warnungen.push({
              typ: 'kasse', schwere: 'gelb', tag,
              text: `${tagName}: Kassen-Grundbesetzung (${standard}) nicht erreicht: ${lueckenText(luecken)}`,
            })
          }
        }
        for (const peak of filiale.kassenPeaks || []) {
          if (!peak.tage?.includes(tag)) continue
          const pv = toMin(peak.von), pb = toMin(peak.bis)
          const luecken = unterdeckung(Math.max(pv, auf), Math.min(pb, zu), kassen, Number(peak.anzahl) || 1)
          if (luecken.length > 0) {
            warnungen.push({
              typ: 'kasse', schwere: 'gelb', tag,
              text: `${tagName}: Kassen-Peak (${peak.anzahl} ab ${peak.von}) unterbesetzt: ${lueckenText(luecken)}`,
            })
          }
        }
      }

      // 5. Öffnungszeit nicht abgedeckt
      const luecken = unterdeckung(auf, zu, arbeiten, 1)
      if (luecken.length > 0) {
        warnungen.push({
          typ: 'abdeckung', schwere: 'rot', tag,
          text: `${tagName}: Öffnungszeit ohne Personal: ${lueckenText(luecken)}`,
        })
      }
    }

    // 6. Ruhezeit < 11 h (Vortag → dieser Tag)
    if (tagIdx > 0) {
      const gestern = TAGE[tagIdx - 1]
      for (const heute of arbeiten) {
        const vortag = arbeitProTag[gestern].find(a => a.ma.id === heute.ma.id)
        if (vortag) {
          const ruhe = (24 * 60 - vortag.bis) + heute.von
          if (ruhe < 11 * 60) {
            warnungen.push({
              typ: 'ruhezeit', schwere: 'rot', tag, maId: heute.ma.id,
              text: `${maName(heute.ma)}: Ruhezeit ${TAG_NAMEN[gestern]}→${tagName} nur ${dauerHHMM(ruhe)} (< 11:00)`,
            })
          }
        }
      }
    }

    for (const a of arbeiten) {
      const brutto = a.bis - a.von
      const pause = a.zelle.pauseMin || 0

      // 7. Max. Tagesarbeitszeit + Pausenpflicht
      if ((a.zelle.stdMin || 0) > 10 * 60) {
        warnungen.push({
          typ: 'arbeitszeit', schwere: 'rot', tag, maId: a.ma.id,
          text: `${maName(a.ma)} ${tagName}: über 10 h Arbeitszeit (${dauerHHMM(a.zelle.stdMin)})`,
        })
      }
      if (brutto > 9 * 60 && pause < 45) {
        warnungen.push({
          typ: 'pause', schwere: 'rot', tag, maId: a.ma.id,
          text: `${maName(a.ma)} ${tagName}: Pausenpflicht verletzt (> 9 h → 45 min, eingetragen ${pause} min)`,
        })
      } else if (brutto > 6 * 60 && pause < 30) {
        warnungen.push({
          typ: 'pause', schwere: 'rot', tag, maId: a.ma.id,
          text: `${maName(a.ma)} ${tagName}: Pausenpflicht verletzt (> 6 h → 30 min, eingetragen ${pause} min)`,
        })
      }

      // 8. Azubi / Jugendliche
      if (a.ma.azubi) {
        if ((a.zelle.stdMin || 0) > 8 * 60) {
          warnungen.push({
            typ: 'azubi', schwere: 'rot', tag, maId: a.ma.id,
            text: `Azubi ${maName(a.ma)} ${tagName}: über 8 h/Tag (${dauerHHMM(a.zelle.stdMin)})`,
          })
        }
        if (a.bis > 20 * 60) {
          warnungen.push({
            typ: 'azubi', schwere: 'gelb', tag, maId: a.ma.id,
            text: `Azubi ${maName(a.ma)} ${tagName}: Spätarbeit bis ${toHHMM(a.bis)}`,
          })
        }
        if (a.ma.berufsschultage?.includes(tag)) {
          warnungen.push({
            typ: 'azubi', schwere: 'rot', tag, maId: a.ma.id,
            text: `Azubi ${maName(a.ma)} ${tagName}: am Berufsschultag verplant`,
          })
        }
      }

      // Verfügbarkeit (optional gepflegt)
      const verf = a.ma.verfuegbarkeit?.[tag]
      if (verf) {
        if (verf.verfuegbar === false) {
          warnungen.push({
            typ: 'verfuegbarkeit', schwere: 'gelb', tag, maId: a.ma.id,
            text: `${maName(a.ma)} ${tagName}: verplant, aber als nicht verfügbar hinterlegt`,
          })
        } else {
          const vv = toMin(verf.von), vb = toMin(verf.bis)
          if ((vv != null && a.von < vv) || (vb != null && a.bis > vb)) {
            warnungen.push({
              typ: 'verfuegbarkeit', schwere: 'gelb', tag, maId: a.ma.id,
              text: `${maName(a.ma)} ${tagName}: außerhalb der Verfügbarkeit (${verf.von || '–'}–${verf.bis || '–'})`,
            })
          }
        }
      }
    }
  }

  // 9. Sondertage: Zusatzbedarf gedeckt? (Heuristik: Kopfzahl des Tages im
  // Vergleich zum Maximum der übrigen offenen Tage + Zusatzköpfe)
  for (const st of woche.sondertage || []) {
    const koepfe = arbeitProTag[st.tag]?.length || 0
    const andere = TAGE.filter(t => t !== st.tag && filiale.oeffnungszeiten?.[t]?.offen)
      .map(t => arbeitProTag[t].length)
    const basis = andere.length ? Math.max(...andere) : 0
    const zusatz = Number(st.zusatzKoepfe) || 0
    if (basis > 0 && koepfe < basis + zusatz) {
      warnungen.push({
        typ: 'sondertag', schwere: 'gelb', tag: st.tag,
        text: `${TAG_NAMEN[st.tag]} (${st.typ}): ${koepfe} Köpfe geplant, Zusatzbedarf +${zusatz} evtl. nicht gedeckt`,
      })
    }
  }

  // 11. Bedarfsmodul-Abgleich (nur wenn Katalog übergeben wurde)
  if (katalog) {
    for (const tag of TAGE) {
      const arbeiten = arbeitProTag[tag]
      const bedarf = tagesBedarf({ tag, filiale, katalog, woche })
      const geplantMin = arbeiten.reduce((s, a) => s + (a.zelle.stdMin || 0), 0)
      const hatLieferung = (woche.lieferungen || []).some(l => l.tag === tag)

      // Lieferung, aber geplante Personenstunden < Tagesbedarf (Untergrenze)
      if (hatLieferung && geplantMin > 0 && geplantMin < bedarf.minMin) {
        warnungen.push({
          typ: 'bedarf', schwere: 'gelb', tag,
          text: `${TAG_NAMEN[tag]}: Lieferung, aber Unterdeckung ca. ${stdText(bedarf.minMin - geplantMin)} (Bedarf ≥ ${stdText(bedarf.minMin)}, geplant ${stdText(geplantMin)})`,
        })
      }

      for (const posten of bedarf.posten) {
        if (posten.quelle !== 'vorgang') continue

        // Abend-Vorgang (z.B. Wochenwerbung Sa): genug Leute nach 18 Uhr?
        if (posten.zeitanker === 'abend' && posten.personen && arbeiten.length > 0) {
          const abends = arbeiten.filter(a => a.bis > 19 * 60).length
          if (abends < posten.personen.min) {
            warnungen.push({
              typ: 'bedarf', schwere: 'gelb', tag,
              text: `${TAG_NAMEN[tag]}: „${posten.name}" braucht abends ${posten.personen.min}${posten.personen.max > posten.personen.min ? '–' + posten.personen.max : ''} ${posten.personen.max > 1 ? 'Personen' : 'Person'}, nach 19:00 ${abends === 1 ? 'ist nur 1 eingeplant' : `sind nur ${abends} eingeplant`}`,
            })
          }
        }

        // Pflicht-Rolle: kein anwesender MA mit passender Quali/Funktion
        if (posten.rolle && arbeiten.length > 0) {
          const vorhanden = arbeiten.some(a => erfuelltRolle(a.ma, posten.rolle))
          if (!vorhanden) {
            warnungen.push({
              typ: 'bedarf', schwere: 'gelb', tag,
              text: `${TAG_NAMEN[tag]}: „${posten.name}" braucht Rolle ${ROLLE_LABELS[posten.rolle] || posten.rolle} – niemand mit passender Quali eingeplant`,
            })
          }
        }
      }
    }
  }

  // 10. GfB-Monatsverdienst (Laufsumme über alle gespeicherten Wochen)
  const monate = wochenMonate(woche.jahr, woche.kw)
  for (const ma of mitarbeiter) {
    if (ma.typ !== 'gfb') continue
    const grenze = Number(ma.verdienstgrenze) || profile.minijobGrenze || 0
    if (grenze <= 0) continue
    const werte = gfbMonatsWerte(ma, alleWochen, profile)
    for (const m of monate) {
      const euro = werte[m.key]?.euro || 0
      if (euro > grenze) {
        warnungen.push({
          typ: 'gfb', schwere: 'rot', maId: ma.id,
          text: `${maName(ma)}: ${monatName(m.monatIndex)} ${euroFormat(euro)} € – Verdienstgrenze ${euroFormat(grenze)} € überschritten`,
        })
      } else if (euro >= grenze * 0.9) {
        warnungen.push({
          typ: 'gfb', schwere: 'gelb', maId: ma.id,
          text: `${maName(ma)}: ${monatName(m.monatIndex)} ${euroFormat(euro)} € – nähert sich der Grenze (${euroFormat(grenze)} €)`,
        })
      }
    }
  }

  return warnungen
}
