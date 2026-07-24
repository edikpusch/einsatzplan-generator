import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import Kopf from '../components/Kopf'
import {
  getFiliale, getProfile, getMitarbeiter, getWoche, saveWoche, getAlleWochen,
  wocheKey, istAushilfe, FUNKTIONEN, getKatalog,
} from '../store'
import BedarfTab from '../components/BedarfTab'
import { lieferungenVorbelegen, faelligeInventuren } from '../utils/bedarf'
import { istPlanbar, kannBereich } from '../utils/rollen'
import {
  TAGE, TAG_KURZ, TAG_NAMEN, STATUS_CODES, STATUS_LABELS,
  toMin, autoPause, berechneStdMin, dauerHHMM, dezimalZuHHMM, euroFormat,
  tagDatum, datumKurz, monatName,
} from '../utils/zeit'
import { pruefeWoche } from '../utils/pruefung'
import { erzeugeVorschlag } from '../utils/vorschlag'
import { gfbMonatsWerte, wochenMonate } from '../utils/gfb'
import { erstellePepXlsx, pepDateiname, teileOderLadeDatei } from '../utils/exportXlsx'

function neueWoche(filialeId, jahr, kw) {
  return {
    filialeId, jahr, kw,
    datumVon: datumKurz(tagDatum(jahr, kw, 0)),
    datumBis: datumKurz(tagDatum(jahr, kw, 5)),
    abwesenheiten: {},
    sondertage: [],
    plan: {},
  }
}

function baueArbeitsZelle(von, bis, pauseOverride, vertreter) {
  const brutto = (toMin(bis) ?? 0) - (toMin(von) ?? 0)
  const pauseMin = pauseOverride != null && pauseOverride !== ''
    ? Math.max(0, parseInt(pauseOverride) || 0)
    : autoPause(brutto)
  return {
    art: 'arbeit', von, bis, pauseMin,
    stdMin: berechneStdMin(von, bis, pauseMin),
    vertreter: !!vertreter,
  }
}

function sortiere(mitarbeiter) {
  return [...mitarbeiter].sort((a, b) => {
    const ha = istAushilfe(a) ? 1 : 0, hb = istAushilfe(b) ? 1 : 0
    if (ha !== hb) return ha - hb
    const fa = FUNKTIONEN.indexOf(a.funktion), fb = FUNKTIONEN.indexOf(b.funktion)
    if (fa !== fb) return fa - fb
    return (a.name + a.vorname).localeCompare(b.name + b.vorname)
  })
}

// ---------- Bottom-Sheet für eine Zelle ----------

function ZellenSheet({ ma, tag, datum, zelle, filiale, onSetzen, onSchliessen }) {
  const [von, setVon] = useState(zelle?.art === 'arbeit' ? zelle.von : '')
  const [bis, setBis] = useState(zelle?.art === 'arbeit' ? zelle.bis : '')
  const [pause, setPause] = useState(zelle?.art === 'arbeit' ? String(zelle.pauseMin) : '')
  const [vertreter, setVertreter] = useState(!!zelle?.vertreter)

  const brutto = von && bis ? (toMin(bis) ?? 0) - (toMin(von) ?? 0) : 0
  const autoP = autoPause(brutto)
  const zeitOk = von && bis && brutto > 0

  function vorlageAnwenden(v) {
    onSetzen(baueArbeitsZelle(v.von, v.bis, null, vertreter))
    onSchliessen()
  }

  function flexibelAnwenden() {
    if (!zeitOk) return
    onSetzen(baueArbeitsZelle(von, bis, pause !== '' ? pause : null, vertreter))
    onSchliessen()
  }

  function statusSetzen(code) {
    onSetzen({ art: 'status', code })
    onSchliessen()
  }

  return (
    <div className="sheet-hintergrund" onClick={onSchliessen}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>{ma.vorname} {ma.name}</h2>
        <div className="unter">{TAG_NAMEN[tag]}, {datumKurz(datum)}</div>

        <h3 style={{ margin: '10px 0 6px', fontSize: 13, color: 'var(--text-schwach)' }}>Schichtvorlagen</h3>
        <div className="vorlagen-grid">
          {(filiale.schichtvorlagen || []).map(v => (
            <button key={v.id} className="btn zweit" onClick={() => vorlageAnwenden(v)}>
              {v.name}<br />
              <small>{v.von}–{v.bis}</small>
            </button>
          ))}
        </div>

        <h3 style={{ margin: '10px 0 6px', fontSize: 13, color: 'var(--text-schwach)' }}>Flexible Zeit</h3>
        <div className="zeile">
          <label className="feld">
            <span>Von</span>
            <input type="time" value={von} onChange={e => setVon(e.target.value)} />
          </label>
          <label className="feld">
            <span>Bis</span>
            <input type="time" value={bis} onChange={e => setBis(e.target.value)} />
          </label>
          <label className="feld" style={{ maxWidth: 110 }}>
            <span>Pause (min)</span>
            <input type="number" inputMode="numeric" value={pause}
              placeholder={String(autoP)}
              onChange={e => setPause(e.target.value)} />
          </label>
        </div>
        {zeitOk && (
          <p className="hinweis">
            Netto: {dauerHHMM(berechneStdMin(von, bis, pause !== '' ? parseInt(pause) || 0 : autoP))} Std
            {pause === '' && autoP > 0 ? ` (Pause automatisch ${autoP} min)` : ''}
          </p>
        )}

        <label className="check">
          <input type="checkbox" checked={vertreter}
            disabled={!kannBereich(ma, 'vertreter')}
            onChange={e => setVertreter(e.target.checked)} />
          Vertreter (V) – Marktverantwortliche/r der Schicht
          {!kannBereich(ma, 'vertreter') && <span className="badge rot">keine Vertreter-Prio</span>}
        </label>

        <button className="btn voll" disabled={!zeitOk} onClick={flexibelAnwenden}
          style={{ margin: '8px 0 14px' }}>
          Übernehmen
        </button>

        <h3 style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-schwach)' }}>Status</h3>
        <div className="status-grid">
          {STATUS_CODES.map(code => (
            <button key={code}
              className={'btn zweit' + (zelle?.art === 'status' && zelle.code === code ? ' aktiv-status' : '')}
              title={STATUS_LABELS[code]}
              onClick={() => statusSetzen(code)}>
              {code}
            </button>
          ))}
        </div>
        <p className="hinweis">
          {STATUS_CODES.map(c => `${c}=${STATUS_LABELS[c]}`).join(' · ')}
        </p>

        <div className="fab-zeile">
          {zelle && (
            <button className="btn gefahr" onClick={() => { onSetzen(null); onSchliessen() }}>
              Zelle leeren
            </button>
          )}
          <button className="btn zweit" onClick={onSchliessen}>Abbrechen</button>
        </div>
      </div>
    </div>
  )
}

// ---------- Abwesenheits-Abfrage VOR der Generierung ----------
// Schnellauswahl: Wer ist diese Woche im Urlaub oder krank? Schreibt in
// dieselben Zellen wie der Abwesend-Tab (plan + abwesenheiten), also keine
// Doppelpflege. Der Generator plant diese Tage dann nicht ein.

function AbwesenheitsSheet({ mitarbeiter, woche, jahr, kw, onSetzen, onWeiter, onSchliessen }) {
  function statusVon(maId, tag) {
    const z = woche.plan?.[maId]?.[tag]
    if (z?.art === 'status') return z.code
    if (z?.art === 'arbeit') return 'A'
    return null
  }

  // Tippen schaltet weiter: frei → U (Urlaub) → K (krank) → frei
  function weiterschalten(maId, tag) {
    const jetzt = statusVon(maId, tag)
    if (jetzt === 'U') onSetzen(maId, tag, { art: 'status', code: 'K' })
    else if (jetzt === 'K') onSetzen(maId, tag, null)
    else onSetzen(maId, tag, { art: 'status', code: 'U' })
  }

  function ganzeWoche(maId, code) {
    for (const tag of TAGE) onSetzen(maId, tag, { art: 'status', code })
  }

  function wocheLeeren(maId) {
    for (const tag of TAGE) {
      if (woche.plan?.[maId]?.[tag]?.art === 'status') onSetzen(maId, tag, null)
    }
  }

  const anzahl = mitarbeiter.filter(ma =>
    TAGE.some(tag => ['U', 'K'].includes(statusVon(ma.id, tag)))).length

  return (
    <div className="sheet-hintergrund" onClick={onSchliessen}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>Wer fehlt diese Woche?</h2>
        <div className="unter">
          KW {kw}/{jahr} · Tag antippen schaltet weiter: frei → <b>U</b> Urlaub →
          <b> K</b> krank → frei. Der Vorschlag plant diese Tage nicht ein.
        </div>

        <div style={{ maxHeight: '52vh', overflowY: 'auto', margin: '10px 0' }}>
          {mitarbeiter.map(ma => (
            <div key={ma.id} className="abw-zeile">
              <div className="abw-kopf">
                <span className="name">{ma.vorname} {ma.name}</span>
                <button className="btn klein zweit" onClick={() => ganzeWoche(ma.id, 'U')}>
                  U Woche
                </button>
                <button className="btn klein zweit" onClick={() => ganzeWoche(ma.id, 'K')}>
                  K Woche
                </button>
                <button className="btn klein zweit" onClick={() => wocheLeeren(ma.id)}>✕</button>
              </div>
              <div className="abw-tage">
                {TAGE.map(tag => {
                  const s = statusVon(ma.id, tag)
                  const klasse = s === 'U' ? 'u' : s === 'K' ? 'k' : s === 'A' ? 'arbeit' : ''
                  return (
                    <button key={tag} className={`abw-tag ${klasse}`}
                      onClick={() => weiterschalten(ma.id, tag)}>
                      <span className="wt">{TAG_KURZ[tag]}</span>
                      {s || '–'}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="hinweis">
          {anzahl === 0
            ? 'Aktuell ist niemand als abwesend markiert.'
            : `${anzahl} Mitarbeiter mit Abwesenheit markiert.`}
        </p>

        <div className="fab-zeile">
          <button className="btn zweit" onClick={onSchliessen}>Abbrechen</button>
          <button className="btn" onClick={onWeiter}>Weiter → Plan erzeugen</button>
        </div>
      </div>
    </div>
  )
}

// ---------- Vorschau des Auto-Vorschlags (Phase B) ----------

function VorschlagSheet({ vorschlag, mitarbeiter, onUebernehmen, onSchliessen }) {
  const maById = Object.fromEntries(mitarbeiter.map(m => [m.id, m]))
  const proTag = TAGE
    .map(tag => ({
      tag,
      eintraege: vorschlag.neue.filter(n => n.tag === tag),
    }))
    .filter(x => x.eintraege.length > 0)

  return (
    <div className="sheet-hintergrund" onClick={onSchliessen}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2>⚡ Auto-Vorschlag</h2>
        <div className="unter">
          {vorschlag.neue.length > 0
            ? `${vorschlag.neue.length} Schicht${vorschlag.neue.length > 1 ? 'en' : ''} vorgeschlagen · bestehende Einträge bleiben unverändert`
            : 'Keine neuen Schichten nötig – der Plan deckt den Bedarf bereits ab.'}
        </div>

        {proTag.length > 0 && (
          <div style={{ maxHeight: '38vh', overflowY: 'auto', margin: '10px 0' }}>
            {proTag.map(({ tag, eintraege }) => (
              <div key={tag} style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>{TAG_NAMEN[tag]}</strong>
                {eintraege.map((n, i) => {
                  const ma = maById[n.maId]
                  return (
                    <div key={i} className="hinweis" style={{ margin: '2px 0 0 8px' }}>
                      {ma ? `${ma.vorname} ${ma.name}` : '?'} · {n.von}–{n.bis}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {vorschlag.konflikte.length > 0 && (
          <>
            <h3 style={{ margin: '10px 0 6px', fontSize: 13, color: 'var(--text-schwach)' }}>
              Nicht lösbar ({vorschlag.konflikte.length})
            </h3>
            <div style={{ maxHeight: '24vh', overflowY: 'auto' }}>
              {vorschlag.konflikte.map((k, i) => (
                <div key={i} className={`warnung ${k.schwere}`}>
                  <span className="punkt">{k.schwere === 'rot' ? '🔴' : '🟡'}</span>
                  <span>{k.text}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="hinweis">
          Der Vorschlag ist ein Entwurf – nach dem Übernehmen kannst du jede
          Zelle wie gewohnt anpassen.
        </p>

        <div className="fab-zeile">
          <button className="btn voll" disabled={vorschlag.neue.length === 0}
            onClick={onUebernehmen}>
            Übernehmen
          </button>
          <button className="btn zweit" onClick={onSchliessen}>Verwerfen</button>
        </div>
      </div>
    </div>
  )
}

// ---------- Hauptseite ----------

export default function PlanEditor() {
  const params = useParams()
  const jahr = parseInt(params.jahr)
  const kw = parseInt(params.kw)
  const filialeId = params.filialeId

  const filiale = useMemo(() => getFiliale(filialeId), [filialeId])
  const profile = useMemo(() => getProfile(), [])
  // Dauerhaft Abwesende (Elternzeit, Langzeitkrank …) tauchen weder im
  // Raster noch in Prüfung, Generierung oder Export auf.
  const mitarbeiter = useMemo(
    () => sortiere(getMitarbeiter(filialeId).filter(istPlanbar)), [filialeId])
  const katalog = useMemo(() => getKatalog(), [])

  const [woche, setWoche] = useState(() => {
    const w = getWoche(filialeId, jahr, kw) || neueWoche(filialeId, jahr, kw)
    // Bedarfsmodul-Migration: Lieferungen + fällige Inventuren vorbelegen
    if (!w.lieferungen) w.lieferungen = filiale ? lieferungenVorbelegen(filiale) : []
    if (!w.inventurenDiesenMonat) w.inventurenDiesenMonat = faelligeInventuren(jahr, kw, getKatalog())
    return w
  })
  const [tab, setTab] = useState('plan')
  const [auswahl, setAuswahl] = useState(null) // { maId, tag }
  const [exportiert, setExportiert] = useState(false)
  const [vorschlag, setVorschlag] = useState(null) // Ergebnis der Auto-Engine
  const [abwesenheitsAbfrage, setAbwesenheitsAbfrage] = useState(false)

  // Auto-Save: jede Änderung sofort in localStorage (kein Datenverlust auf Mobil)
  useEffect(() => {
    if (filiale) saveWoche(woche)
  }, [woche, filiale])

  // Querformat auf dem Handy: die Wochen-Matrix braucht die volle Breite.
  // Best-effort – funktioniert nur, wenn die Umgebung das Sperren erlaubt
  // (installierte PWA / Fullscreen auf Android). iOS Safari ignoriert das
  // still; dort erscheint stattdessen der Dreh-Hinweis (siehe .quer-hinweis).
  useEffect(() => {
    const o = window.screen?.orientation
    if (o?.lock) o.lock('landscape').catch(() => {})
    return () => { if (o?.unlock) { try { o.unlock() } catch { /* egal */ } } }
  }, [])

  const alleWochen = useMemo(() => ({
    ...getAlleWochen(),
    [wocheKey(filialeId, jahr, kw)]: woche,
  }), [woche, filialeId, jahr, kw])

  const warnungen = useMemo(() =>
    pruefeWoche({ woche, filiale, mitarbeiter, profile, alleWochen, katalog }),
    [woche, filiale, mitarbeiter, profile, alleWochen, katalog])

  const monate = useMemo(() => wochenMonate(jahr, kw), [jahr, kw])

  if (!filiale) {
    return (
      <div className="seite">
        <Kopf titel="Wochenplan" zurueck="/" />
        <div className="leer-hinweis">Filiale nicht gefunden.</div>
      </div>
    )
  }

  function setzeZelle(maId, tag, zelle) {
    setWoche(w => {
      const planMa = { ...(w.plan?.[maId] || {}) }
      const abwMa = { ...(w.abwesenheiten?.[maId] || {}) }
      if (!zelle) {
        delete planMa[tag]
        delete abwMa[tag]
      } else {
        planMa[tag] = zelle
        if (zelle.art === 'status') abwMa[tag] = zelle.code
        else delete abwMa[tag]
      }
      return {
        ...w,
        plan: { ...w.plan, [maId]: planMa },
        abwesenheiten: { ...w.abwesenheiten, [maId]: abwMa },
      }
    })
  }

  function updateSondertag(idx, aenderung) {
    setWoche(w => ({
      ...w,
      sondertage: w.sondertage.map((s, i) => i === idx ? { ...s, ...aenderung } : s),
    }))
  }

  // Vor dem Generieren erst die Urlaub/Krank-Abfrage, dann rechnen.
  function autoVorschlag() {
    setAbwesenheitsAbfrage(true)
  }

  function generieren() {
    setAbwesenheitsAbfrage(false)
    setVorschlag(erzeugeVorschlag({ woche, filiale, mitarbeiter, profile, alleWochen }))
  }

  function vorschlagUebernehmen() {
    const neuerPlan = vorschlag.plan
    setWoche(w => ({ ...w, plan: neuerPlan }))
    setVorschlag(null)
  }

  async function exportieren() {
    try {
      const blob = await erstellePepXlsx({ woche, filiale, mitarbeiter, profile }, alleWochen)
      await teileOderLadeDatei(blob, pepDateiname(woche, filiale, profile))
      setExportiert(true)
      setTimeout(() => setExportiert(false), 2500)
    } catch (e) {
      alert('Export fehlgeschlagen: ' + e.message)
    }
  }

  // Summen
  let gesamtMin = 0
  const wochenSummen = {}
  const geplantProTag = Object.fromEntries(TAGE.map(t => [t, 0]))
  for (const ma of mitarbeiter) {
    let min = 0
    for (const tag of TAGE) {
      const z = woche.plan?.[ma.id]?.[tag]
      if (z?.art === 'arbeit') {
        min += z.stdMin || 0
        geplantProTag[tag] += z.stdMin || 0
      }
    }
    wochenSummen[ma.id] = min
    gesamtMin += min
  }
  const budgetMin = Math.round((Number(filiale.wochenstundenBudget) || 0) * 60)
  const restMin = budgetMin - gesamtMin
  const prozent = budgetMin > 0 ? Math.min(100, (gesamtMin / budgetMin) * 100) : 0

  const zellWarnungen = new Set(
    warnungen.filter(w => w.maId && w.tag).map(w => `${w.maId}_${w.tag}`))
  const tagWarnungen = new Set(
    warnungen.filter(w => w.tag && !w.maId).map(w => w.tag))

  const roteAnzahl = warnungen.filter(w => w.schwere === 'rot').length

  return (
    <div className="seite">
      <Kopf
        titel={`Filiale ${filiale.nummer} · KW ${kw}/${jahr}`}
        zurueck="/"
        aktion={
          <button className="zurueck" onClick={exportieren} title="PEP exportieren / teilen">
            {exportiert ? '✓' : '📤'}
          </button>
        }
      />

      <p className="hinweis" style={{ marginTop: -6 }}>
        {woche.datumVon} – {woche.datumBis} · {filiale.adresse}
      </p>

      <div className="tabs">
        <button className={tab === 'plan' ? 'aktiv' : ''} onClick={() => setTab('plan')}>Plan</button>
        <button className={tab === 'bedarf' ? 'aktiv' : ''} onClick={() => setTab('bedarf')}>Bedarf</button>
        <button className={tab === 'abwesend' ? 'aktiv' : ''} onClick={() => setTab('abwesend')}>Abwesend</button>
        <button className={tab === 'sondertage' ? 'aktiv' : ''} onClick={() => setTab('sondertage')}>
          Sondertage{woche.sondertage.length > 0 && <span className="zahl">{woche.sondertage.length}</span>}
        </button>
        <button className={tab === 'pruefung' ? 'aktiv' : ''} onClick={() => setTab('pruefung')}>
          Prüfung{warnungen.length > 0 && <span className="zahl">{warnungen.length}</span>}
        </button>
      </div>

      {mitarbeiter.length === 0 && (
        <div className="karte leer-hinweis">
          Diese Filiale hat noch keine Mitarbeiter.
        </div>
      )}

      {tab === 'plan' && mitarbeiter.length > 0 && (
        <div className="quer-hinweis">
          <span style={{ fontSize: 20 }}>📱↻</span>
          <span>Handy quer drehen – dann siehst du die ganze Woche auf einen Blick.</span>
        </div>
      )}

      {tab === 'plan' && mitarbeiter.length > 0 && (
        <div className="plan-wrap">
          <table className="plan">
            <thead>
              <tr>
                <th className="ma-spalte">Mitarbeiter</th>
                {TAGE.map((tag, idx) => {
                  const d = tagDatum(jahr, kw, idx)
                  const offen = filiale.oeffnungszeiten?.[tag]?.offen
                  return (
                    <th key={tag} style={offen ? {} : { color: 'var(--text-schwach)' }}>
                      {TAG_KURZ[tag]} {String(d.getDate()).padStart(2, '0')}.{String(d.getMonth() + 1).padStart(2, '0')}.
                      {tagWarnungen.has(tag) && <span style={{ color: 'var(--rot)' }}> ⚠</span>}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {mitarbeiter.map(ma => {
                const gfbWerte = ma.typ === 'gfb' ? gfbMonatsWerte(ma, alleWochen, profile) : null
                const grenze = Number(ma.verdienstgrenze) || profile.minijobGrenze
                return (
                  <tr key={ma.id}>
                    <td className="ma-spalte">
                      <div className="ma-name">{ma.vorname} {ma.name}</div>
                      <div className="ma-info">{ma.funktion}</div>
                      {ma.typ === 'fest' ? (
                        <div className="ma-info">
                          {dauerHHMM(wochenSummen[ma.id])} / {dezimalZuHHMM(ma.vertragsstunden)}
                        </div>
                      ) : (
                        <>
                          <div className="ma-info">Woche {dauerHHMM(wochenSummen[ma.id])}</div>
                          {monate.map(m => {
                            const euro = gfbWerte?.[m.key]?.euro || 0
                            const klasse = euro > grenze ? 'rot' : euro >= grenze * 0.9 ? 'warn' : ''
                            return (
                              <div key={m.key} className={`ma-info ${klasse}`}>
                                {monatName(m.monatIndex).slice(0, 3)}: {euroFormat(euro)} € / {euroFormat(grenze)} €
                              </div>
                            )
                          })}
                        </>
                      )}
                    </td>
                    {TAGE.map(tag => {
                      const z = woche.plan?.[ma.id]?.[tag]
                      const warnung = zellWarnungen.has(`${ma.id}_${tag}`)
                      return (
                        <td key={tag} className={warnung ? 'hat-warnung' : ''}>
                          <button className="zelle-btn" onClick={() => setAuswahl({ maId: ma.id, tag })}>
                            {z?.art === 'arbeit' && (
                              <>
                                <div className="zeit">
                                  {z.von}–{z.bis}
                                  {z.vertreter && <span className="v-badge">V</span>}
                                </div>
                                <div className="std">{dauerHHMM(z.stdMin)} · P {z.pauseMin}′</div>
                              </>
                            )}
                            {z?.art === 'status' && <div className="status-code">{z.code}</div>}
                            {!z && <div className="leer">+</div>}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'bedarf' && (
        <BedarfTab
          woche={woche}
          setWoche={setWoche}
          filiale={filiale}
          katalog={katalog}
          geplantProTag={geplantProTag}
        />
      )}

      {tab === 'abwesend' && mitarbeiter.length > 0 && (
        <div className="plan-wrap" style={{ padding: 8 }}>
          <p className="hinweis">Status pro Tag: U=Urlaub, F=Frei, K=Krank, FT=Feiertag, BV=Beschäftigungsverbot, Kur, SCH=Schule</p>
          <table className="abwesend">
            <thead>
              <tr>
                <th className="ma-spalte">Mitarbeiter</th>
                {TAGE.map(tag => <th key={tag}>{TAG_KURZ[tag]}</th>)}
              </tr>
            </thead>
            <tbody>
              {mitarbeiter.map(ma => (
                <tr key={ma.id}>
                  <td className="ma-spalte">{ma.vorname} {ma.name}</td>
                  {TAGE.map(tag => {
                    const z = woche.plan?.[ma.id]?.[tag]
                    const wert = z?.art === 'status' ? z.code : ''
                    return (
                      <td key={tag}>
                        <select value={wert}
                          style={z?.art === 'arbeit' ? { background: '#eef4f0' } : {}}
                          onChange={e => setzeZelle(ma.id, tag,
                            e.target.value ? { art: 'status', code: e.target.value } : null)}>
                          <option value="">{z?.art === 'arbeit' ? 'A' : '–'}</option>
                          {STATUS_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sondertage' && (
        <div className="karte">
          <h2>Sondertage (Zusatzbedarf)</h2>
          {woche.sondertage.length === 0 && (
            <div className="leer-hinweis">Keine Sondertage in dieser Woche.</div>
          )}
          {woche.sondertage.map((st, idx) => (
            <div key={idx} style={{ borderBottom: '1px solid var(--grau-linie)', paddingBottom: 8, marginBottom: 8 }}>
              <div className="zeile">
                <label className="feld" style={{ maxWidth: 110 }}>
                  <span>Tag</span>
                  <select value={st.tag} onChange={e => updateSondertag(idx, { tag: e.target.value })}>
                    {TAGE.map(t => <option key={t} value={t}>{TAG_NAMEN[t]}</option>)}
                  </select>
                </label>
                <label className="feld">
                  <span>Typ</span>
                  <input type="text" value={st.typ} list="sondertag-typen"
                    onChange={e => updateSondertag(idx, { typ: e.target.value })} />
                </label>
                <label className="feld" style={{ maxWidth: 90 }}>
                  <span>+ Köpfe</span>
                  <input type="number" min="0" inputMode="numeric" value={st.zusatzKoepfe}
                    onChange={e => updateSondertag(idx, { zusatzKoepfe: parseInt(e.target.value) || 0 })} />
                </label>
              </div>
              <div className="zeile">
                <label className="feld">
                  <span>Notiz</span>
                  <input type="text" value={st.notiz || ''}
                    onChange={e => updateSondertag(idx, { notiz: e.target.value })} />
                </label>
                <button className="btn klein gefahr" style={{ alignSelf: 'flex-end', marginBottom: 12 }}
                  onClick={() => setWoche(w => ({ ...w, sondertage: w.sondertage.filter((_, i) => i !== idx) }))}>
                  ✕
                </button>
              </div>
            </div>
          ))}
          <datalist id="sondertag-typen">
            <option value="Lieferung" />
            <option value="Aktion aufbauen" />
            <option value="Inventur" />
          </datalist>
          <button className="btn zweit voll"
            onClick={() => setWoche(w => ({
              ...w,
              sondertage: [...w.sondertage, { tag: 'mo', typ: 'Lieferung', zusatzKoepfe: 1, notiz: '' }],
            }))}>
            + Sondertag
          </button>
        </div>
      )}

      {tab === 'pruefung' && (
        <div className="karte">
          <h2>Prüfung ({warnungen.length})</h2>
          {warnungen.length === 0 && (
            <div className="leer-hinweis">✅ Keine Warnungen – Plan sieht gut aus.</div>
          )}
          {warnungen.map((w, idx) => (
            <div key={idx} className={`warnung ${w.schwere}`}>
              <span className="punkt">{w.schwere === 'rot' ? '🔴' : '🟡'}</span>
              <span>{w.text}</span>
            </div>
          ))}
          {warnungen.length > 0 && (
            <p className="hinweis">Warnungen sind Hinweise, kein Zwang – du entscheidest.</p>
          )}
        </div>
      )}

      {tab === 'plan' && (
        <div className="fab-zeile">
          {mitarbeiter.length > 0 && (
            <button className="btn zweit" onClick={autoVorschlag}
              title="Leere Zellen automatisch mit einem Vorschlag füllen">
              ⚡ Auto-Vorschlag
            </button>
          )}
          <button className="btn voll" onClick={exportieren}>
            📤 PEP exportieren / teilen {roteAnzahl > 0 ? `(${roteAnzahl} rote Warnungen)` : ''}
          </button>
        </div>
      )}

      <div className="budget-leiste">
        <strong>{dauerHHMM(gesamtMin)}</strong>
        <div className="balken">
          <div className={restMin < 0 ? 'ueber' : ''} style={{ width: `${prozent}%` }} />
        </div>
        <span className={`rest ${restMin < 0 ? 'ueber' : ''}`}>
          {restMin >= 0
            ? `Rest ${dauerHHMM(restMin)} von ${dauerHHMM(budgetMin)}`
            : `+${dauerHHMM(-restMin)} über Budget!`}
        </span>
      </div>

      {abwesenheitsAbfrage && (
        <AbwesenheitsSheet
          mitarbeiter={mitarbeiter}
          woche={woche}
          jahr={jahr}
          kw={kw}
          onSetzen={setzeZelle}
          onWeiter={generieren}
          onSchliessen={() => setAbwesenheitsAbfrage(false)}
        />
      )}

      {vorschlag && (
        <VorschlagSheet
          vorschlag={vorschlag}
          mitarbeiter={mitarbeiter}
          onUebernehmen={vorschlagUebernehmen}
          onSchliessen={() => setVorschlag(null)}
        />
      )}

      {auswahl && (
        <ZellenSheet
          ma={mitarbeiter.find(m => m.id === auswahl.maId)}
          tag={auswahl.tag}
          datum={tagDatum(jahr, kw, TAGE.indexOf(auswahl.tag))}
          zelle={woche.plan?.[auswahl.maId]?.[auswahl.tag] || null}
          filiale={filiale}
          onSetzen={zelle => setzeZelle(auswahl.maId, auswahl.tag, zelle)}
          onSchliessen={() => setAuswahl(null)}
        />
      )}
    </div>
  )
}
