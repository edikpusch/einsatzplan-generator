import { Link, useNavigate } from 'react-router-dom'
import Kopf from '../components/Kopf'
import { getFilialen, getMitarbeiter, defaultFiliale, saveFiliale } from '../store'

export default function FilialeList() {
  const navigate = useNavigate()
  const filialen = getFilialen()

  function neueFiliale() {
    const f = defaultFiliale()
    saveFiliale(f)
    navigate(`/filiale/${f.id}`)
  }

  return (
    <div className="seite">
      <Kopf titel="Filialen" zurueck="/" />

      <div className="karte">
        {filialen.length === 0 && (
          <div className="leer-hinweis">Noch keine Filialen angelegt.</div>
        )}
        {filialen.map(f => (
          <Link key={f.id} className="listen-eintrag" to={`/filiale/${f.id}`}>
            <div className="haupt">
              <div className="titel">
                {f.nummer
                  ? `${f.nummer}${f.adresse ? ` – ${f.adresse}` : ''}`
                  : '⚠ Nummer/Adresse fehlt'}
              </div>
              <div className="unter">
                {getMitarbeiter(f.id).length} Mitarbeiter · Budget {String(f.wochenstundenBudget).replace('.', ',')} Std
                {!f.nummer && ' · zum Ergänzen antippen'}
              </div>
            </div>
            <span className="pfeil">›</span>
          </Link>
        ))}
      </div>

      <button className="btn voll" onClick={neueFiliale}>+ Neue Filiale</button>
    </div>
  )
}
