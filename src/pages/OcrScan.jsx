import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Kopf from '../components/Kopf'
import {
  getFiliale, getMitarbeiter, getProfile, saveMitarbeiter, deleteMitarbeiter,
  defaultMitarbeiter, FUNKTIONEN,
} from '../store'
import {
  runTesseract, extractNamen, extractStunden, matchePerY, baueVergleich,
  scanFelder, KUERZEL_ZU_FUNKTION,
} from '../utils/ocr'

const ROTATIONEN = [0, 90, 180, 270]

// Unplausible Stunden rot markieren (nur bei Festangestellten relevant)
function stundenProblem(felder) {
  if (felder.typ === 'gfb') return false
  const v = felder.vertragsstunden
  return v == null || v < 1 || v > 48
}

export default function OcrScan() {
  const { id: filialeId } = useParams()
  const navigate = useNavigate()
  const filiale = getFiliale(filialeId)
  const profile = getProfile()

  const [schritt, setSchritt] = useState('start') // start | scan1 | scan2 | review | fertig
  const [progress, setProgress] = useState(0)
  const [scanLabel, setScanLabel] = useState('')
  const [rotation, setRotation] = useState(0)
  const [namen, setNamen] = useState(null)
  const [rohtext, setRohtext] = useState('')
  const [showRoh, setShowRoh] = useState(false)
  const [fehler, setFehler] = useState('')

  // Review-Zustand
  const [neu, setNeu] = useState([])           // { eintrag, felder, ausgewaehlt }
  const [geaendert, setGeaendert] = useState([]) // { ma, felder, diffs, ausgewaehlt }
  const [fehlt, setFehlt] = useState([])       // { ma, loeschen }
  const [statistik, setStatistik] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const input1Ref = useRef()
  const input2Ref = useRef()

  if (!filiale) {
    return (
      <div className="seite">
        <Kopf titel="Mitarbeiter scannen" zurueck="/filialen" />
        <div className="leer-hinweis">Filiale nicht gefunden.</div>
      </div>
    )
  }

  async function handleBild1(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setScanLabel('Bild 1: Namen')
    setSchritt('scan')
    setProgress(0)
    setFehler('')
    try {
      const data = await runTesseract(file, setProgress, rotation)
      const erkannt = extractNamen(data)
      setRohtext(data.text)
      setNamen(erkannt)
      setSchritt('namen')
    } catch (err) {
      setFehler('Scan fehlgeschlagen: ' + err.message)
      setSchritt('start')
    }
  }

  async function handleBild2(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setScanLabel('Bild 2: Funktion + Stunden')
    setSchritt('scan')
    setProgress(0)
    setFehler('')
    try {
      const data = await runTesseract(file, setProgress, rotation)
      const stunden = extractStunden(data)
      setRohtext(prev => prev + '\n\n--- Bild 2 ---\n' + data.text)

      const eintraege = matchePerY(namen, stunden)
      const bestand = getMitarbeiter(filialeId)
      const v = baueVergleich(eintraege, bestand)
      setNeu(v.neu.map(x => ({ ...x, ausgewaehlt: true })))
      setGeaendert(v.geaendert.map(x => ({ ...x, ausgewaehlt: true })))
      setFehlt(v.fehlt.map(ma => ({ ma, loeschen: false })))
      setStatistik({
        namen: namen.length,
        stunden: stunden.length,
        gematcht: eintraege.filter(x => x.gematcht).length,
      })
      setExpanded(null)
      setSchritt('review')
    } catch (err) {
      setFehler('Scan fehlgeschlagen: ' + err.message)
      setSchritt('namen')
    }
  }

  function updateNeu(idx, aenderung) {
    setNeu(prev => prev.map((x, i) => i === idx ? { ...x, ...aenderung } : x))
  }
  function updateNeuFelder(idx, aenderung) {
    setNeu(prev => prev.map((x, i) =>
      i === idx ? { ...x, felder: { ...x.felder, ...aenderung } } : x))
  }
  function updateNeuName(idx, feld, wert) {
    setNeu(prev => prev.map((x, i) =>
      i === idx ? { ...x, eintrag: { ...x.eintrag, [feld]: wert } } : x))
  }

  // Übernehmen: erst HIER wird nach localStorage geschrieben.
  function uebernehmen() {
    let angelegt = 0, aktualisiert = 0, geloescht = 0

    for (const n of neu) {
      if (!n.ausgewaehlt) continue
      if (!n.eintrag.nachname && !n.eintrag.vorname) continue
      // Neue ID + Defaults; Quali-Häkchen bleiben false (nicht scanbar)
      const ma = {
        ...defaultMitarbeiter(filialeId, profile),
        name: n.eintrag.nachname,
        vorname: n.eintrag.vorname,
        funktion: n.felder.funktion || 'Verkäufer/in Lebensmittel',
        typ: n.felder.typ,
        azubi: n.felder.azubi,
        vertragsstunden: n.felder.typ === 'gfb' ? 0 : (n.felder.vertragsstunden ?? 0),
      }
      saveMitarbeiter(ma)
      angelegt++
    }

    for (const g of geaendert) {
      if (!g.ausgewaehlt) continue
      // ID BEIBEHALTEN – nur scanbare Felder aktualisieren, alles andere
      // (stundenlohn, verdienstgrenze, quali, verfuegbarkeit, berufsschultage)
      // bleibt unverändert.
      saveMitarbeiter({
        ...g.ma,
        funktion: g.felder.funktion || g.ma.funktion,
        typ: g.felder.typ,
        azubi: g.felder.azubi,
        vertragsstunden: g.felder.typ === 'gfb'
          ? g.ma.vertragsstunden
          : (g.felder.vertragsstunden ?? g.ma.vertragsstunden),
      })
      aktualisiert++
    }

    for (const f of fehlt) {
      if (f.loeschen) {
        deleteMitarbeiter(f.ma.id)
        geloescht++
      }
    }

    setStatistik(s => ({ ...s, angelegt, aktualisiert, geloescht }))
    setSchritt('fertig')
  }

  // ── START ──────────────────────────────────────────────────────────────────
  if (schritt === 'start') {
    return (
      <div className="seite">
        <Kopf titel="Mitarbeiter scannen" zurueck={`/filiale/${filialeId}`} />
        {fehler && <div className="warnung rot"><span>⚠ {fehler}</span></div>}
        <div className="karte">
          <h2>Personalbericht scannen (2 Bilder)</h2>
          <p className="hinweis" style={{ lineHeight: 1.7 }}>
            📸 <b>Bild 1:</b> nur die <b>Name</b>-Spalte<br />
            📸 <b>Bild 2:</b> die Spalten <b>Tätigkeit + Wo-Std</b><br />
            Zuordnung per Zeilenposition (Y-Matching).
          </p>
          <div className="warnung gelb" style={{ marginTop: 8 }}>
            <span className="punkt">💡</span>
            <span>Beide Bilder im <b>gleichen Ausschnitt/Maßstab</b> aufnehmen (gleiche Zeilenhöhe) – sonst leidet die Zuordnung. Läuft komplett offline auf dem Gerät.</span>
          </div>

          <h3>Drehung (falls quer fotografiert)</h3>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {ROTATIONEN.map(r => (
              <button key={r} className="btn klein"
                style={rotation === r ? {} : { background: '#e8eef0', color: 'var(--text-schwach)' }}
                onClick={() => setRotation(r)}>
                {r}°
              </button>
            ))}
          </div>

          <input ref={input1Ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBild1} />
          <button className="btn voll" onClick={() => input1Ref.current.click()}>
            📷 Bild 1: Namen scannen
          </button>
        </div>
      </div>
    )
  }

  // ── SCANNING ───────────────────────────────────────────────────────────────
  if (schritt === 'scan') {
    return (
      <div className="seite">
        <Kopf titel={scanLabel} />
        <div className="karte" style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🔍</div>
          <div className="balken" style={{ height: 8, background: 'var(--grau-linie)', borderRadius: 4, overflow: 'hidden', margin: '0 0 8px' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gruen)' }} />
          </div>
          <div className="hinweis">{progress} % – Texterkennung läuft offline …</div>
        </div>
      </div>
    )
  }

  // ── NAMEN PRÜFEN (Zwischenschritt) ─────────────────────────────────────────
  if (schritt === 'namen') {
    return (
      <div className="seite">
        <Kopf titel={`Namen prüfen (${namen.length})`} zurueck={null}
          aktion={<button className="zurueck" onClick={() => setShowRoh(!showRoh)}>📋</button>} />
        {fehler && <div className="warnung rot"><span>⚠ {fehler}</span></div>}
        {showRoh && (
          <div className="karte" style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>
            {rohtext}
          </div>
        )}
        <div className="karte">
          {namen.length === 0 && (
            <div className="leer-hinweis">😕 Keine Namen erkannt. Bitte nur die Name-Spalte scannen (ggf. Drehung anpassen).</div>
          )}
          {namen.map((n, i) => (
            <div key={i} className="zeile" style={{ marginBottom: 8, alignItems: 'center' }}>
              <input type="text" placeholder="Nachname" value={n.nachname}
                onChange={e => setNamen(prev => prev.map((x, j) => j === i ? { ...x, nachname: e.target.value } : x))} />
              <input type="text" placeholder="Vorname" value={n.vorname}
                onChange={e => setNamen(prev => prev.map((x, j) => j === i ? { ...x, vorname: e.target.value } : x))} />
              <button className="btn klein gefahr" style={{ flex: '0 0 auto' }}
                onClick={() => setNamen(prev => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <div className="fab-zeile">
          <button className="btn zweit" onClick={() => setSchritt('start')}>← Bild 1 neu</button>
          <input ref={input2Ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBild2} />
          <button className="btn" disabled={namen.length === 0} onClick={() => input2Ref.current.click()}>
            📷 Bild 2: Funktion + Stunden
          </button>
        </div>
      </div>
    )
  }

  // ── REVIEW (Pflicht vor dem Speichern) ─────────────────────────────────────
  if (schritt === 'review') {
    const neuCount = neu.filter(x => x.ausgewaehlt).length
    const aendCount = geaendert.filter(x => x.ausgewaehlt).length
    const loeschCount = fehlt.filter(x => x.loeschen).length

    return (
      <div className="seite">
        <Kopf titel="Import prüfen" zurueck={null}
          aktion={<button className="zurueck" onClick={() => setShowRoh(!showRoh)}>📋</button>} />
        {showRoh && (
          <div className="karte" style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>
            {rohtext}
          </div>
        )}

        {statistik && (
          <div className={`warnung ${statistik.gematcht === statistik.namen ? 'gelb' : 'rot'}`}
            style={statistik.gematcht === statistik.namen ? { background: '#e2f2e8', color: 'var(--gruen)' } : {}}>
            <span className="punkt">{statistik.gematcht === statistik.namen ? '✓' : '⚠'}</span>
            <span>
              {statistik.namen} Namen, {statistik.stunden} Funktionszeilen, {statistik.gematcht} per Y-Position zugeordnet.
              {statistik.gematcht < statistik.namen && ' Nicht zugeordnete Einträge unten korrigieren.'}
            </span>
          </div>
        )}

        {/* NEU */}
        <div className="karte">
          <h2>Neu ({neu.length})</h2>
          {neu.length === 0 && <div className="leer-hinweis">Keine neuen Mitarbeiter.</div>}
          {neu.map((n, i) => {
            const problem = !n.felder.funktion || stundenProblem(n.felder) || !n.eintrag.gematcht
            const key = `neu_${i}`
            return (
              <div key={i} style={{ borderBottom: '1px solid var(--grau-linie)', padding: '8px 0' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setExpanded(expanded === key ? null : key)}>
                  <input type="checkbox" checked={n.ausgewaehlt} style={{ width: 20, height: 20, accentColor: 'var(--gruen)' }}
                    onClick={e => e.stopPropagation()}
                    onChange={e => updateNeu(i, { ausgewaehlt: e.target.checked })} />
                  <div style={{ flex: 1 }}>
                    <div className="ma-name">{n.eintrag.nachname} {n.eintrag.vorname}</div>
                    <div className={'ma-info' + (problem ? ' rot' : '')}>
                      {n.felder.funktion || '⚠ Funktion unbekannt'}
                      {n.felder.typ === 'gfb'
                        ? ' · GfB'
                        : ` · ${n.felder.vertragsstunden != null ? n.felder.vertragsstunden + ' Std' : '⚠ Stunden fehlen'}`}
                      {n.felder.azubi ? ' · Azubi' : ''}
                    </div>
                  </div>
                  <span className="pfeil">{expanded === key ? '▲' : '▼'}</span>
                </div>
                {expanded === key && (
                  <div style={{ paddingTop: 8 }}>
                    <div className="zeile">
                      <input type="text" placeholder="Nachname" value={n.eintrag.nachname}
                        onChange={e => updateNeuName(i, 'nachname', e.target.value)} />
                      <input type="text" placeholder="Vorname" value={n.eintrag.vorname}
                        onChange={e => updateNeuName(i, 'vorname', e.target.value)} />
                    </div>
                    <div className="zeile" style={{ marginTop: 8 }}>
                      <select value={n.felder.funktion}
                        onChange={e => updateNeuFelder(i, { funktion: e.target.value })}>
                        <option value="">– Funktion wählen –</option>
                        {FUNKTIONEN.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div className="zeile" style={{ marginTop: 8 }}>
                      <select value={n.felder.typ}
                        onChange={e => updateNeuFelder(i, { typ: e.target.value })}>
                        <option value="fest">Festangestellt</option>
                        <option value="gfb">GfB (Minijob)</option>
                      </select>
                      {n.felder.typ === 'fest' && (
                        <input type="number" step="0.25" inputMode="decimal" placeholder="Wochenstunden"
                          value={n.felder.vertragsstunden ?? ''}
                          onChange={e => updateNeuFelder(i, { vertragsstunden: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* GEÄNDERT */}
        <div className="karte">
          <h2>Geändert ({geaendert.length})</h2>
          {geaendert.length === 0 && <div className="leer-hinweis">Keine Änderungen an bestehenden Mitarbeitern.</div>}
          {geaendert.map((g, i) => (
            <div key={g.ma.id} style={{ borderBottom: '1px solid var(--grau-linie)', padding: '8px 0', display: 'flex', gap: 10 }}>
              <input type="checkbox" checked={g.ausgewaehlt} style={{ width: 20, height: 20, accentColor: 'var(--gruen)', flexShrink: 0, marginTop: 2 }}
                onChange={e => setGeaendert(prev => prev.map((x, j) => j === i ? { ...x, ausgewaehlt: e.target.checked } : x))} />
              <div>
                <div className="ma-name">{g.ma.name} {g.ma.vorname}</div>
                {g.diffs.map((d, j) => (
                  <div key={j} className="ma-info">{d.feld}: {d.alt} → <b>{d.neu}</b></div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* FEHLT IM SCAN */}
        <div className="karte">
          <h2>Fehlt im Scan ({fehlt.length})</h2>
          {fehlt.length === 0
            ? <div className="leer-hinweis">Alle bestehenden Mitarbeiter wurden im Scan gefunden.</div>
            : <p className="hinweis">Kann OCR-Fehler oder Urlaub sein – Standard: <b>behalten</b>.</p>}
          {fehlt.map((f, i) => (
            <div key={f.ma.id} style={{ borderBottom: '1px solid var(--grau-linie)', padding: '8px 0', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div className="ma-name" style={f.loeschen ? { textDecoration: 'line-through', color: 'var(--rot)' } : {}}>
                  {f.ma.name} {f.ma.vorname}
                </div>
                <div className="ma-info">{f.ma.funktion}</div>
              </div>
              {f.loeschen ? (
                <button className="btn klein zweit"
                  onClick={() => setFehlt(prev => prev.map((x, j) => j === i ? { ...x, loeschen: false } : x))}>
                  Behalten
                </button>
              ) : (
                <button className="btn klein gefahr"
                  onClick={() => {
                    if (confirm(`${f.ma.vorname} ${f.ma.name} wirklich löschen? Gespeicherte Wochenpläne verlieren die Einträge dieses MA.`)) {
                      setFehlt(prev => prev.map((x, j) => j === i ? { ...x, loeschen: true } : x))
                    }
                  }}>
                  Löschen
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="fab-zeile">
          <button className="btn zweit" onClick={() => setSchritt('namen')}>← Zurück</button>
          <button className="btn" disabled={neuCount + aendCount + loeschCount === 0}
            onClick={uebernehmen}>
            💾 Übernehmen ({neuCount} neu, {aendCount} geändert{loeschCount > 0 ? `, ${loeschCount} löschen` : ''})
          </button>
        </div>
      </div>
    )
  }

  // ── FERTIG ─────────────────────────────────────────────────────────────────
  return (
    <div className="seite">
      <Kopf titel="Import abgeschlossen" />
      <div className="karte" style={{ textAlign: 'center', padding: '32px 16px' }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>✅</div>
        <p style={{ fontWeight: 700, fontSize: 17, margin: '0 0 4px' }}>
          {statistik?.angelegt ?? 0} neu angelegt · {statistik?.aktualisiert ?? 0} aktualisiert
          {statistik?.geloescht ? ` · ${statistik.geloescht} gelöscht` : ''}
        </p>
        <p className="hinweis">Filiale {filiale.nummer} – {filiale.adresse}</p>
      </div>
      <div className="warnung gelb">
        <span className="punkt">⚠</span>
        <span>
          Neu angelegte Mitarbeiter haben <b>keine Quali-Häkchen</b> (Schlüsselträger/Bäcker/Kasse) –
          bitte jetzt setzen, sonst meldet die Prüfung „kein Vertreter/Bäcker möglich".
          Bei GfB außerdem den <b>Stundenlohn</b> prüfen (Default = Mindestlohn {String(profile.mindestlohn).replace('.', ',')} €).
        </span>
      </div>
      <Link className="btn voll" to={`/filiale/${filialeId}`}>→ Zur Mitarbeiter-Verwaltung</Link>
    </div>
  )
}
