import { useState } from 'react'
import Kopf from '../components/Kopf'
import { getProfile, saveProfile } from '../store'

export default function ProfilEdit() {
  const [profil, setProfil] = useState(getProfile)

  // Auto-Save bei jeder Änderung
  function update(aenderung) {
    setProfil(p => {
      const neu = { ...p, ...aenderung }
      saveProfile(neu)
      return neu
    })
  }

  function updateZuschlag(idx, feld, wert) {
    const zuschlaege = profil.zuschlaege.map((z, i) =>
      i === idx ? { ...z, [feld]: wert } : z)
    update({ zuschlaege })
  }

  return (
    <div className="seite">
      <Kopf titel="Profil" zurueck="/" />

      <div className="karte">
        <h2>Verkaufsleitung</h2>
        <label className="feld">
          <span>Name VL</span>
          <input type="text" value={profil.vlName}
            onChange={e => update({ vlName: e.target.value })} placeholder="z.B. Pusch" />
        </label>
        <label className="feld">
          <span>Niederlassung</span>
          <input type="text" value={profil.niederlassung}
            onChange={e => update({ niederlassung: e.target.value })} placeholder="z.B. Ganderkesee" />
        </label>
      </div>

      <div className="karte">
        <h2>Löhne &amp; Grenzen</h2>
        <div className="zeile">
          <label className="feld">
            <span>Mindestlohn (€/Std, Default)</span>
            <input type="number" step="0.01" inputMode="decimal" value={profil.mindestlohn}
              onChange={e => update({ mindestlohn: parseFloat(e.target.value) || 0 })} />
          </label>
          <label className="feld">
            <span>Minijob-Grenze (€/Monat)</span>
            <input type="number" step="1" inputMode="numeric" value={profil.minijobGrenze}
              onChange={e => update({ minijobGrenze: parseFloat(e.target.value) || 0 })} />
          </label>
        </div>
        <p className="hinweis">Werte ändern sich jährlich – hier zentral pflegen. Neue Mitarbeiter übernehmen die Defaults, pro MA überschreibbar.</p>
      </div>

      <div className="karte">
        <h2>Zuschläge</h2>
        <p className="hinweis">Gelten für alle MA, anteilig für Minuten im Zeitband. Nur relevant für die GfB-Verdienstgrenze – das Filialbudget bleibt in Stunden.</p>
        {profil.zuschlaege.map((z, idx) => (
          <div key={idx} style={{ borderTop: idx > 0 ? '1px solid var(--grau-linie)' : 'none', paddingTop: idx > 0 ? 10 : 0 }}>
            <div className="zeile">
              <label className="feld">
                <span>Name</span>
                <input type="text" value={z.name}
                  onChange={e => updateZuschlag(idx, 'name', e.target.value)} />
              </label>
              <label className="feld" style={{ maxWidth: 90 }}>
                <span>Prozent</span>
                <input type="number" inputMode="numeric" value={z.prozent}
                  onChange={e => updateZuschlag(idx, 'prozent', parseFloat(e.target.value) || 0)} />
              </label>
            </div>
            <div className="zeile">
              <label className="feld">
                <span>Von</span>
                <input type="time" value={z.von}
                  onChange={e => updateZuschlag(idx, 'von', e.target.value)} />
              </label>
              <label className="feld">
                <span>Bis</span>
                <input type="time" value={z.bis}
                  onChange={e => updateZuschlag(idx, 'bis', e.target.value)} />
              </label>
              <button className="btn klein gefahr" style={{ alignSelf: 'flex-end', marginBottom: 12 }}
                onClick={() => update({ zuschlaege: profil.zuschlaege.filter((_, i) => i !== idx) })}>
                Entfernen
              </button>
            </div>
          </div>
        ))}
        <button className="btn zweit voll"
          onClick={() => update({ zuschlaege: [...profil.zuschlaege, { name: 'Zuschlag', von: '18:30', bis: '20:00', prozent: 20 }] })}>
          + Zuschlag hinzufügen
        </button>
      </div>

      <p className="hinweis">Feiertage: Filialen sind an Feiertagen geschlossen (Phase-A-Annahme) – kein Sonn-/Feiertagszuschlag modelliert.</p>
    </div>
  )
}
