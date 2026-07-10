import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import Kopf from '../components/Kopf'
import { getProfile, getFilialen, getAlleWochen, deleteWoche } from '../store'
import { isoWochenMontag, datumKurz, tagDatum } from '../utils/zeit'

export default function Home() {
  const navigate = useNavigate()
  const [, neuLaden] = useState(0)
  const profile = getProfile()
  const filialen = getFilialen()
  const wochen = getAlleWochen()

  const wochenListe = Object.entries(wochen)
    .map(([key, w]) => ({ key, ...w, filiale: filialen.find(f => f.id === w.filialeId) }))
    .sort((a, b) => (b.jahr - a.jahr) || (b.kw - a.kw))

  function loeschen(key, e) {
    e.preventDefault()
    if (confirm('Diese Woche wirklich löschen?')) {
      deleteWoche(key)
      neuLaden(x => x + 1)
    }
  }

  return (
    <div className="seite">
      <Kopf titel="EinsatzplanGenerator" />

      <div className="karte">
        <h2>Los geht's</h2>
        <div className="fab-zeile" style={{ margin: 0 }}>
          <button className="btn" onClick={() => navigate('/woche')}
            disabled={filialen.length === 0}>
            📅 Woche planen
          </button>
          <Link className="btn zweit" to="/filialen">🏬 Filialen</Link>
        </div>
        {filialen.length === 0 && (
          <p className="hinweis">Lege zuerst eine Filiale mit Mitarbeitern an.</p>
        )}
      </div>

      <div className="karte">
        <h2>Gespeicherte Wochen</h2>
        {wochenListe.length === 0 && (
          <div className="leer-hinweis">Noch keine Wochenpläne gespeichert.</div>
        )}
        {wochenListe.map(w => {
          const von = isoWochenMontag(w.jahr, w.kw)
          const bis = tagDatum(w.jahr, w.kw, 5)
          return (
            <Link key={w.key} className="listen-eintrag"
              to={`/plan/${w.filialeId}/${w.jahr}/${w.kw}`}>
              <div className="haupt">
                <div className="titel">KW {w.kw}/{w.jahr} · Filiale {w.filiale?.nummer || '?'}</div>
                <div className="unter">{datumKurz(von)} – {datumKurz(bis)} · {w.filiale?.adresse || 'Filiale gelöscht'}</div>
              </div>
              <button className="btn klein zweit" onClick={e => loeschen(w.key, e)}>🗑</button>
              <span className="pfeil">›</span>
            </Link>
          )
        })}
      </div>

      <div className="karte">
        <h2>Profil</h2>
        <Link className="listen-eintrag" to="/profil">
          <div className="haupt">
            <div className="titel">{profile.vlName ? `VL ${profile.vlName}` : 'Profil einrichten'}</div>
            <div className="unter">
              {profile.niederlassung ? `NL ${profile.niederlassung} · ` : ''}
              Mindestlohn {String(profile.mindestlohn).replace('.', ',')} € · Minijob-Grenze {profile.minijobGrenze} €
            </div>
          </div>
          <span className="pfeil">›</span>
        </Link>
      </div>

      <p className="hinweis" style={{ textAlign: 'center' }}>
        Alle Daten bleiben lokal auf diesem Gerät (localStorage).
      </p>
    </div>
  )
}
