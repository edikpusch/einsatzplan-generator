import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Kopf from '../components/Kopf'
import { getFilialen, getAlleWochen } from '../store'
import { isoKW, isoWochenMontag, tagDatum, datumKurz } from '../utils/zeit'

export default function WocheStart() {
  const navigate = useNavigate()
  const filialen = getFilialen()
  const heute = isoKW(new Date())
  const [filialeId, setFilialeId] = useState(filialen[0]?.id || '')
  const [kw, setKw] = useState(heute.kw)
  const [jahr, setJahr] = useState(heute.jahr)

  const kwOk = kw >= 1 && kw <= 53 && jahr >= 2020 && jahr <= 2100
  const von = kwOk ? isoWochenMontag(jahr, kw) : null
  const bis = kwOk ? tagDatum(jahr, kw, 5) : null

  const vorhandene = Object.values(getAlleWochen())
    .filter(w => w.filialeId === filialeId)
    .sort((a, b) => (b.jahr - a.jahr) || (b.kw - a.kw))

  return (
    <div className="seite">
      <Kopf titel="Woche planen" zurueck="/" />

      <div className="karte">
        <h2>Filiale &amp; Kalenderwoche</h2>
        <label className="feld">
          <span>Filiale</span>
          <select value={filialeId} onChange={e => setFilialeId(e.target.value)}>
            {filialen.map(f => (
              <option key={f.id} value={f.id}>{f.nummer} – {f.adresse}</option>
            ))}
          </select>
        </label>
        <div className="zeile">
          <label className="feld">
            <span>KW</span>
            <input type="number" min="1" max="53" inputMode="numeric" value={kw}
              onChange={e => setKw(parseInt(e.target.value) || 0)} />
          </label>
          <label className="feld">
            <span>Jahr</span>
            <input type="number" inputMode="numeric" value={jahr}
              onChange={e => setJahr(parseInt(e.target.value) || 0)} />
          </label>
        </div>
        {kwOk && (
          <p className="hinweis" style={{ fontSize: 15, color: 'var(--text)' }}>
            📅 Montag {datumKurz(von)} – Samstag {datumKurz(bis)}
          </p>
        )}
        <button className="btn voll" disabled={!filialeId || !kwOk}
          onClick={() => navigate(`/plan/${filialeId}/${jahr}/${kw}`)}>
          Woche öffnen
        </button>
      </div>

      {vorhandene.length > 0 && (
        <div className="karte">
          <h2>Vorhandene Wochen dieser Filiale</h2>
          {vorhandene.map(w => (
            <div key={`${w.jahr}_${w.kw}`} className="listen-eintrag"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/plan/${w.filialeId}/${w.jahr}/${w.kw}`)}>
              <div className="haupt">
                <div className="titel">KW {w.kw}/{w.jahr}</div>
                <div className="unter">{datumKurz(isoWochenMontag(w.jahr, w.kw))} – {datumKurz(tagDatum(w.jahr, w.kw, 5))}</div>
              </div>
              <span className="pfeil">›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
