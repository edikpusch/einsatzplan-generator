import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Kopf from '../components/Kopf'
import TageChips from '../components/TageChips'
import {
  getFiliale, saveFiliale, deleteFiliale, getMitarbeiter, uid, istAushilfe,
} from '../store'
import { ALLE_TAGE, TAG_NAMEN, dezimalZuHHMM } from '../utils/zeit'
import { LIEFERARTEN, LIEFERART_LABELS } from '../utils/katalog'

export default function FilialeEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [filiale, setFiliale] = useState(() => getFiliale(id))

  if (!filiale) {
    return (
      <div className="seite">
        <Kopf titel="Filiale" zurueck="/filialen" />
        <div className="leer-hinweis">Filiale nicht gefunden.</div>
      </div>
    )
  }

  const mitarbeiter = getMitarbeiter(filiale.id)

  // Auto-Save bei jeder Änderung
  function update(aenderung) {
    setFiliale(f => {
      const neu = { ...f, ...aenderung }
      saveFiliale(neu)
      return neu
    })
  }

  function updateOeffnung(tag, feld, wert) {
    update({
      oeffnungszeiten: {
        ...filiale.oeffnungszeiten,
        [tag]: { ...filiale.oeffnungszeiten[tag], [feld]: wert },
      },
    })
  }

  function updatePeak(idx, aenderung) {
    update({
      kassenPeaks: filiale.kassenPeaks.map((p, i) => i === idx ? { ...p, ...aenderung } : p),
    })
  }

  function updateVorlage(idx, aenderung) {
    update({
      schichtvorlagen: filiale.schichtvorlagen.map((v, i) => i === idx ? { ...v, ...aenderung } : v),
    })
  }

  function loeschen() {
    if (confirm(`Filiale ${filiale.nummer} inkl. Mitarbeitern wirklich löschen?`)) {
      deleteFiliale(filiale.id)
      navigate('/filialen')
    }
  }

  return (
    <div className="seite">
      <Kopf titel={`Filiale ${filiale.nummer || '(neu)'}`} zurueck="/filialen" />

      <div className="karte">
        <h2>Stammdaten</h2>
        <div className="zeile">
          <label className="feld" style={{ maxWidth: 120 }}>
            <span>Nummer</span>
            <input type="text" inputMode="numeric" value={filiale.nummer}
              onChange={e => update({ nummer: e.target.value })} placeholder="2497" />
          </label>
          <label className="feld">
            <span>Adresse</span>
            <input type="text" value={filiale.adresse}
              onChange={e => update({ adresse: e.target.value })} placeholder="Brake-Bahnhofstr. 79 a" />
          </label>
        </div>
        <div className="zeile">
          <label className="feld">
            <span>Bereich</span>
            <input type="text" value={filiale.bereich}
              onChange={e => update({ bereich: e.target.value })} />
          </label>
          <label className="feld">
            <span>Wochenstunden-Budget</span>
            <input type="number" step="0.5" inputMode="decimal" value={filiale.wochenstundenBudget}
              onChange={e => update({ wochenstundenBudget: parseFloat(e.target.value) || 0 })} />
          </label>
        </div>
      </div>

      <div className="karte">
        <h2>Öffnungszeiten</h2>
        {ALLE_TAGE.map(tag => {
          const oz = filiale.oeffnungszeiten[tag]
          return (
            <div key={tag} className="zeile" style={{ alignItems: 'center', marginBottom: 8 }}>
              <label className="check" style={{ flex: '0 0 110px', padding: 0 }}>
                <input type="checkbox" checked={!!oz.offen}
                  onChange={e => updateOeffnung(tag, 'offen', e.target.checked)} />
                {TAG_NAMEN[tag]}
              </label>
              {oz.offen ? (
                <>
                  <input type="time" value={oz.auf || ''}
                    onChange={e => updateOeffnung(tag, 'auf', e.target.value)} />
                  <input type="time" value={oz.zu || ''}
                    onChange={e => updateOeffnung(tag, 'zu', e.target.value)} />
                </>
              ) : (
                <span className="hinweis" style={{ flex: 1 }}>geschlossen</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="karte">
        <h2>Besetzungsregeln</h2>
        <div className="zeile">
          <label className="feld">
            <span>Bäcker morgens bis</span>
            <input type="time" value={filiale.baeckerFenster?.bis || ''}
              onChange={e => update({ baeckerFenster: { bis: e.target.value } })} />
          </label>
          <label className="feld">
            <span>Kassen-Grundbesetzung</span>
            <input type="number" min="0" inputMode="numeric" value={filiale.kassenStandard}
              onChange={e => update({ kassenStandard: parseInt(e.target.value) || 0 })} />
          </label>
        </div>

        <h3>Kassen-Peaks</h3>
        {(filiale.kassenPeaks || []).map((peak, idx) => (
          <div key={idx} style={{ borderTop: '1px solid var(--grau-linie)', padding: '10px 0' }}>
            <TageChips auswahl={peak.tage || []} onChange={tage => updatePeak(idx, { tage })} />
            <div className="zeile" style={{ marginTop: 8 }}>
              <label className="feld">
                <span>Von</span>
                <input type="time" value={peak.von}
                  onChange={e => updatePeak(idx, { von: e.target.value })} />
              </label>
              <label className="feld">
                <span>Bis</span>
                <input type="time" value={peak.bis}
                  onChange={e => updatePeak(idx, { bis: e.target.value })} />
              </label>
              <label className="feld" style={{ maxWidth: 80 }}>
                <span>Kassen</span>
                <input type="number" min="1" inputMode="numeric" value={peak.anzahl}
                  onChange={e => updatePeak(idx, { anzahl: parseInt(e.target.value) || 1 })} />
              </label>
              <button className="btn klein gefahr" style={{ alignSelf: 'flex-end', marginBottom: 12 }}
                onClick={() => update({ kassenPeaks: filiale.kassenPeaks.filter((_, i) => i !== idx) })}>
                ✕
              </button>
            </div>
          </div>
        ))}
        <button className="btn zweit voll"
          onClick={() => update({ kassenPeaks: [...(filiale.kassenPeaks || []), { tage: ['mo', 'di', 'mi', 'do', 'fr', 'sa'], von: '11:00', bis: '14:00', anzahl: 2 }] })}>
          + Peak-Fenster
        </button>
      </div>

      <div className="karte">
        <h2>Lieferprofil (Bedarfsmodul)</h2>
        <p className="hinweis">Typische Liefertage + Paletten – Vorbelegung für die Wochenplanung, dort pro Woche anpassbar.</p>
        {LIEFERARTEN.map(art => {
          const p = filiale.lieferprofil?.[art] || { tage: [], typischePaletten: 0, zeitpunkt: 'frueh' }
          return (
            <div key={art} style={{ borderTop: '1px solid var(--grau-linie)', padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <b style={{ flex: '0 0 70px', fontSize: 14 }}>{LIEFERART_LABELS[art]}</b>
                <TageChips auswahl={p.tage || []}
                  onChange={tage => update({ lieferprofil: { ...filiale.lieferprofil, [art]: { ...p, tage } } })} />
              </div>
              <div className="zeile">
                <label className="feld" style={{ maxWidth: 140 }}>
                  <span>Typische Paletten</span>
                  <input type="number" min="0" inputMode="numeric" value={p.typischePaletten ?? 0}
                    onChange={e => update({ lieferprofil: { ...filiale.lieferprofil, [art]: { ...p, typischePaletten: parseInt(e.target.value) || 0 } } })} />
                </label>
                <label className="feld" style={{ maxWidth: 150 }}>
                  <span>Zeitpunkt</span>
                  <select value={p.zeitpunkt || 'frueh'}
                    onChange={e => update({ lieferprofil: { ...filiale.lieferprofil, [art]: { ...p, zeitpunkt: e.target.value } } })}>
                    <option value="frueh">früh</option>
                    <option value="vorabend">Vorabend</option>
                    <option value="nachts">nachts</option>
                  </select>
                </label>
                <label className="feld" style={{ maxWidth: 170 }}>
                  <span>Verräumzeit/Palette (min)</span>
                  <input type="number" min="0" inputMode="numeric"
                    value={filiale.palettenFaktoren?.[art] ?? 45}
                    onChange={e => update({ palettenFaktoren: { ...filiale.palettenFaktoren, [art]: parseInt(e.target.value) || 0 } })} />
                </label>
              </div>
            </div>
          )
        })}
        <div style={{ borderTop: '1px solid var(--grau-linie)', padding: '10px 0' }}>
          <div className="hinweis" style={{ marginBottom: 4 }}>Fleisch kommt täglich AUSSER an:</div>
          <TageChips auswahl={filiale.lieferprofil?.fleischAusnahmen || []}
            onChange={fleischAusnahmen => update({ lieferprofil: { ...filiale.lieferprofil, fleischAusnahmen } })} />
        </div>

        <h3>Bestell-Deadlines (Anzeige im Tagesplan)</h3>
        {(filiale.bestellzeiten || []).map((b, idx) => (
          <div key={idx} className="zeile" style={{ marginBottom: 4, alignItems: 'flex-end' }}>
            <label className="feld">
              <span>Warengruppe</span>
              <input type="text" value={b.name}
                onChange={e => update({ bestellzeiten: filiale.bestellzeiten.map((x, i) => i === idx ? { ...x, name: e.target.value } : x) })} />
            </label>
            <label className="feld" style={{ maxWidth: 120 }}>
              <span>Deadline</span>
              <input type="time" value={b.deadline}
                onChange={e => update({ bestellzeiten: filiale.bestellzeiten.map((x, i) => i === idx ? { ...x, deadline: e.target.value } : x) })} />
            </label>
            <button className="btn klein gefahr" style={{ marginBottom: 12 }}
              onClick={() => update({ bestellzeiten: filiale.bestellzeiten.filter((_, i) => i !== idx) })}>
              ✕
            </button>
          </div>
        ))}
        <div className="fab-zeile" style={{ margin: '8px 0 0' }}>
          <button className="btn zweit"
            onClick={() => update({ bestellzeiten: [...(filiale.bestellzeiten || []), { name: 'Obst & Gemüse', deadline: '10:00' }] })}>
            + Deadline
          </button>
          <button className="btn zweit" onClick={() => navigate(`/filiale/${filiale.id}/katalog`)}>
            🧮 Vorgangskatalog
          </button>
        </div>
      </div>

      <div className="karte">
        <h2>Schichtvorlagen</h2>
        <p className="hinweis">Pause wird automatisch aus der Schichtlänge berechnet (&gt;6h → 30, &gt;9h → 45 min). Flexible Zeiten sind im Planer trotzdem möglich.</p>
        {(filiale.schichtvorlagen || []).map((v, idx) => (
          <div key={v.id} className="zeile" style={{ marginBottom: 4 }}>
            <label className="feld">
              <span>Name</span>
              <input type="text" value={v.name}
                onChange={e => updateVorlage(idx, { name: e.target.value })} />
            </label>
            <label className="feld">
              <span>Von</span>
              <input type="time" value={v.von}
                onChange={e => updateVorlage(idx, { von: e.target.value })} />
            </label>
            <label className="feld">
              <span>Bis</span>
              <input type="time" value={v.bis}
                onChange={e => updateVorlage(idx, { bis: e.target.value })} />
            </label>
            <button className="btn klein gefahr" style={{ alignSelf: 'flex-end', marginBottom: 12 }}
              onClick={() => update({ schichtvorlagen: filiale.schichtvorlagen.filter((_, i) => i !== idx) })}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn zweit voll"
          onClick={() => update({ schichtvorlagen: [...(filiale.schichtvorlagen || []), { id: uid(), name: 'Schicht', von: '08:00', bis: '16:30', pauseMin: 30 }] })}>
          + Schichtvorlage
        </button>
      </div>

      <div className="karte">
        <h2>Mitarbeiter ({mitarbeiter.length})</h2>
        {mitarbeiter.map(ma => (
          <Link key={ma.id} className="listen-eintrag" to={`/filiale/${filiale.id}/ma/${ma.id}`}>
            <div className="haupt">
              <div className="titel">{ma.vorname} {ma.name}</div>
              <div className="unter">
                {ma.funktion} · {ma.typ === 'gfb' ? 'GfB' : `${dezimalZuHHMM(ma.vertragsstunden)} Std`}
              </div>
              <div style={{ marginTop: 3 }}>
                {ma.quali?.schluesseltraeger && <span className="badge blau">Schlüssel</span>}
                {ma.quali?.baecker && <span className="badge gelb">Bäcker</span>}
                {ma.quali?.kasse && <span className="badge gruen">Kasse</span>}
                {ma.azubi && <span className="badge">Azubi</span>}
                {istAushilfe(ma) && <span className="badge">Aushilfe</span>}
              </div>
            </div>
            <span className="pfeil">›</span>
          </Link>
        ))}
        <div className="fab-zeile" style={{ marginBottom: 0 }}>
          <button className="btn" onClick={() => navigate(`/filiale/${filiale.id}/ma/neu`)}>
            + Mitarbeiter
          </button>
          <button className="btn zweit" onClick={() => navigate(`/filiale/${filiale.id}/scan`)}>
            📷 Mitarbeiter scannen
          </button>
        </div>
      </div>

      <button className="btn gefahr voll" onClick={loeschen}>Filiale löschen</button>
    </div>
  )
}
