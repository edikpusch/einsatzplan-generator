import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Kopf from '../components/Kopf'
import TageChips from '../components/TageChips'
import {
  getProfile, getMitarbeiterById, defaultMitarbeiter, saveMitarbeiter,
  deleteMitarbeiter, FUNKTIONEN,
} from '../store'
import { TAGE, TAG_NAMEN, dezimalZuHHMM } from '../utils/zeit'

export default function MitarbeiterEdit() {
  const { filialeId, maId } = useParams()
  const navigate = useNavigate()
  const neu = maId === 'neu'
  const [ma, setMa] = useState(() =>
    neu ? defaultMitarbeiter(filialeId, getProfile()) : getMitarbeiterById(maId))

  if (!ma) {
    return (
      <div className="seite">
        <Kopf titel="Mitarbeiter" zurueck={`/filiale/${filialeId}`} />
        <div className="leer-hinweis">Mitarbeiter nicht gefunden.</div>
      </div>
    )
  }

  function update(aenderung) {
    setMa(m => ({ ...m, ...aenderung }))
  }

  function updateVerf(tag, aenderung) {
    update({
      verfuegbarkeit: {
        ...ma.verfuegbarkeit,
        [tag]: { ...(ma.verfuegbarkeit?.[tag] || { verfuegbar: true, von: null, bis: null }), ...aenderung },
      },
    })
  }

  function speichern() {
    if (!ma.name && !ma.vorname) {
      alert('Bitte mindestens einen Namen eingeben.')
      return
    }
    saveMitarbeiter(ma)
    navigate(`/filiale/${filialeId}`)
  }

  function loeschen() {
    if (confirm(`${ma.vorname} ${ma.name} wirklich löschen?`)) {
      deleteMitarbeiter(ma.id)
      navigate(`/filiale/${filialeId}`)
    }
  }

  return (
    <div className="seite">
      <Kopf titel={neu ? 'Neuer Mitarbeiter' : `${ma.vorname} ${ma.name}`} zurueck={`/filiale/${filialeId}`} />

      <div className="karte">
        <h2>Person</h2>
        <div className="zeile">
          <label className="feld">
            <span>Vorname</span>
            <input type="text" value={ma.vorname}
              onChange={e => update({ vorname: e.target.value })} />
          </label>
          <label className="feld">
            <span>Nachname</span>
            <input type="text" value={ma.name}
              onChange={e => update({ name: e.target.value })} />
          </label>
        </div>
        <label className="feld">
          <span>Funktion</span>
          <select value={ma.funktion} onChange={e => update({ funktion: e.target.value })}>
            {FUNKTIONEN.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      </div>

      <div className="karte">
        <h2>Vertrag</h2>
        <div className="zeile">
          <label className="feld">
            <span>Typ</span>
            <select value={ma.typ} onChange={e => update({ typ: e.target.value })}>
              <option value="fest">Festangestellt</option>
              <option value="gfb">GfB (Minijob)</option>
            </select>
          </label>
          {ma.typ === 'fest' ? (
            <label className="feld">
              <span>Vertragsstunden ({dezimalZuHHMM(ma.vertragsstunden)})</span>
              <input type="number" step="0.25" inputMode="decimal" value={ma.vertragsstunden}
                onChange={e => update({ vertragsstunden: parseFloat(e.target.value) || 0 })} />
            </label>
          ) : (
            <label className="feld">
              <span>Verdienstgrenze (€/Monat)</span>
              <input type="number" step="1" inputMode="decimal" value={ma.verdienstgrenze}
                onChange={e => update({ verdienstgrenze: parseFloat(e.target.value) || 0 })} />
            </label>
          )}
        </div>
        <label className="feld">
          <span>Stundenlohn (€/Std)</span>
          <input type="number" step="0.01" inputMode="decimal" value={ma.stundenlohn}
            onChange={e => update({ stundenlohn: parseFloat(e.target.value) || 0 })} />
        </label>
        {ma.typ === 'gfb' && (
          <p className="hinweis">Zuschläge (Spät/Nacht) zählen für die Verdienstgrenze mit – Warnung bei Annäherung, keine Sperre.</p>
        )}
      </div>

      <div className="karte">
        <h2>Qualifikationen</h2>
        <label className="check">
          <input type="checkbox" checked={!!ma.quali?.schluesseltraeger}
            onChange={e => update({ quali: { ...ma.quali, schluesseltraeger: e.target.checked } })} />
          Schlüsselträger (kann Vertreter „V" sein)
        </label>
        <label className="check">
          <input type="checkbox" checked={!!ma.quali?.baecker}
            onChange={e => update({ quali: { ...ma.quali, baecker: e.target.checked } })} />
          Bäcker
        </label>
        <label className="check">
          <input type="checkbox" checked={!!ma.quali?.kasse}
            onChange={e => update({ quali: { ...ma.quali, kasse: e.target.checked } })} />
          Kasse
        </label>
        <p className="hinweis">Eine Person darf mehrere Rollen gleichzeitig erfüllen.</p>
      </div>

      <div className="karte">
        <h2>Azubi</h2>
        <label className="check">
          <input type="checkbox" checked={!!ma.azubi}
            onChange={e => update({ azubi: e.target.checked })} />
          Azubi / Jugendschutz beachten
        </label>
        {ma.azubi && (
          <>
            <h3>Berufsschultage</h3>
            <TageChips auswahl={ma.berufsschultage || []}
              onChange={berufsschultage => update({ berufsschultage })} />
          </>
        )}
      </div>

      <div className="karte">
        <h2>Verfügbarkeit</h2>
        <p className="hinweis">Ohne Zeiten = ganztags verfügbar. Haken weg = an dem Tag gar nicht verfügbar.</p>
        {TAGE.map(tag => {
          const v = ma.verfuegbarkeit?.[tag] || { verfuegbar: true, von: null, bis: null }
          return (
            <div key={tag} className="zeile" style={{ alignItems: 'center', marginBottom: 8 }}>
              <label className="check" style={{ flex: '0 0 110px', padding: 0 }}>
                <input type="checkbox" checked={v.verfuegbar !== false}
                  onChange={e => updateVerf(tag, { verfuegbar: e.target.checked })} />
                {TAG_NAMEN[tag]}
              </label>
              {v.verfuegbar !== false ? (
                <>
                  <input type="time" value={v.von || ''}
                    onChange={e => updateVerf(tag, { von: e.target.value || null })} />
                  <input type="time" value={v.bis || ''}
                    onChange={e => updateVerf(tag, { bis: e.target.value || null })} />
                </>
              ) : (
                <span className="hinweis" style={{ flex: 1 }}>nicht verfügbar</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="fab-zeile">
        {!neu && <button className="btn gefahr" onClick={loeschen}>Löschen</button>}
        <button className="btn" onClick={speichern}>Speichern</button>
      </div>
    </div>
  )
}
