import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Kopf from '../components/Kopf'
import TageChips from '../components/TageChips'
import { getFiliale, saveFiliale, getKatalog, saveKatalog, uid } from '../store'
import {
  effektiverKatalog, KATEGORIE_LABELS, RHYTHMUS_LABELS, ROLLE_LABELS,
} from '../utils/katalog'
import { spanneText } from '../utils/bedarf'

const KATEGORIEN = Object.keys(KATEGORIE_LABELS)
const RHYTHMEN = Object.keys(RHYTHMUS_LABELS).filter(r => r !== 'jeLiefertag')
const ROLLEN = ['', ...Object.keys(ROLLE_LABELS)]
const ANKER = ['', 'frueh', 'vormittag', 'nachmittag', 'abend']

export default function KatalogEdit() {
  const { id: filialeId } = useParams()
  const [filiale, setFiliale] = useState(() => getFiliale(filialeId))
  const [katalog, setKatalog] = useState(() => getKatalog())
  const [expanded, setExpanded] = useState(null)

  if (!filiale) {
    return (
      <div className="seite">
        <Kopf titel="Vorgangskatalog" zurueck="/filialen" />
        <div className="leer-hinweis">Filiale nicht gefunden.</div>
      </div>
    )
  }

  const effektiv = effektiverKatalog(katalog, filiale)

  function istCustom(vorgang) {
    return vorgang.id.startsWith('custom-')
  }

  // Änderung schreiben: Standard-Vorgang → Filial-Override,
  // Custom-Vorgang → global in den Katalog.
  function update(vorgang, aenderung) {
    if (istCustom(vorgang)) {
      setKatalog(prev => {
        const neu = prev.map(v => v.id === vorgang.id
          ? { ...v, ...aenderung, personen: { ...v.personen, ...(aenderung.personen || {}) }, dauerMin: { ...v.dauerMin, ...(aenderung.dauerMin || {}) } }
          : v)
        saveKatalog(neu)
        return neu
      })
    } else {
      setFiliale(prev => {
        const alt = prev.vorgangOverrides?.[vorgang.id] || {}
        const override = {
          ...alt, ...aenderung,
          ...(aenderung.personen ? { personen: { ...vorgang.personen, ...alt.personen, ...aenderung.personen } } : {}),
          ...(aenderung.dauerMin ? { dauerMin: { ...vorgang.dauerMin, ...alt.dauerMin, ...aenderung.dauerMin } } : {}),
        }
        const neu = {
          ...prev,
          vorgangOverrides: { ...prev.vorgangOverrides, [vorgang.id]: override },
        }
        saveFiliale(neu)
        return neu
      })
    }
  }

  function resetOverride(vorgangId) {
    setFiliale(prev => {
      const overrides = { ...prev.vorgangOverrides }
      delete overrides[vorgangId]
      const neu = { ...prev, vorgangOverrides: overrides }
      saveFiliale(neu)
      return neu
    })
  }

  function neuerVorgang() {
    const v = {
      id: 'custom-' + uid(),
      name: 'Neuer Vorgang',
      kategorie: 'kontrolle',
      rhythmus: 'woechentlich',
      wochentage: [],
      personen: { min: 1, max: 1 },
      dauerMin: { min: 30, max: 30 },
      zeitanker: null,
      rolle: null,
      budgetQuelle: 'filiale',
      aktiv: true,
    }
    setKatalog(prev => {
      const neu = [...prev, v]
      saveKatalog(neu)
      return neu
    })
    setExpanded(v.id)
  }

  function loescheCustom(vorgangId) {
    if (!confirm('Diesen Vorgang endgültig löschen (gilt für alle Filialen)?')) return
    setKatalog(prev => {
      const neu = prev.filter(v => v.id !== vorgangId)
      saveKatalog(neu)
      return neu
    })
  }

  return (
    <div className="seite">
      <Kopf titel={`Vorgangskatalog · Filiale ${filiale.nummer}`} zurueck={`/filiale/${filialeId}`} />
      <p className="hinweis">
        Standard-Katalog gilt für alle Filialen – Änderungen hier werden als
        Override <b>nur für diese Filiale</b> gespeichert. Dient der
        Stunden-Kalkulation, kein Task-Management.
      </p>

      {KATEGORIEN.map(kategorie => {
        const vorgaenge = effektiv.filter(v => v.kategorie === kategorie)
        if (vorgaenge.length === 0) return null
        return (
          <div className="karte" key={kategorie}>
            <h2>{KATEGORIE_LABELS[kategorie]}</h2>
            {vorgaenge.map(vorgang => {
              const hatOverride = !!filiale.vorgangOverrides?.[vorgang.id]
              const offen = expanded === vorgang.id
              return (
                <div key={vorgang.id} style={{ borderBottom: '1px solid var(--grau-linie)', padding: '8px 0' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setExpanded(offen ? null : vorgang.id)}>
                    <input type="checkbox" checked={vorgang.aktiv}
                      style={{ width: 20, height: 20, accentColor: 'var(--gruen)', flexShrink: 0 }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => update(vorgang, { aktiv: e.target.checked })} />
                    <div style={{ flex: 1, opacity: vorgang.aktiv ? 1 : 0.45 }}>
                      <div style={{ fontSize: 14 }}>{vorgang.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-schwach)' }}>
                        {RHYTHMUS_LABELS[vorgang.rhythmus]}
                        {vorgang.wochentage?.length > 0 ? ` (${vorgang.wochentage.join(', ')})` : ''}
                        {' · '}
                        {vorgang.personen.min}{vorgang.personen.max > vorgang.personen.min ? '–' + vorgang.personen.max : ''} P × {vorgang.dauerMin.min}{vorgang.dauerMin.max > vorgang.dauerMin.min ? '–' + vorgang.dauerMin.max : ''} min
                        {' = '}
                        {spanneText(vorgang.personen.min * vorgang.dauerMin.min, vorgang.personen.max * vorgang.dauerMin.max)}
                        {vorgang.rolle ? ` · ${ROLLE_LABELS[vorgang.rolle]}` : ''}
                        {vorgang.budgetQuelle === 'extern' && <span className="badge blau" style={{ marginLeft: 6 }}>extern</span>}
                        {hatOverride && <span className="badge gelb" style={{ marginLeft: 6 }}>angepasst</span>}
                        {istCustom(vorgang) && <span className="badge" style={{ marginLeft: 6 }}>eigener</span>}
                      </div>
                    </div>
                    <span className="pfeil">{offen ? '▲' : '▼'}</span>
                  </div>

                  {offen && (
                    <div style={{ paddingTop: 10 }}>
                      {istCustom(vorgang) && (
                        <>
                          <label className="feld">
                            <span>Name</span>
                            <input type="text" value={vorgang.name}
                              onChange={e => update(vorgang, { name: e.target.value })} />
                          </label>
                          <div className="zeile">
                            <label className="feld">
                              <span>Kategorie</span>
                              <select value={vorgang.kategorie}
                                onChange={e => update(vorgang, { kategorie: e.target.value })}>
                                {KATEGORIEN.map(k => <option key={k} value={k}>{KATEGORIE_LABELS[k]}</option>)}
                              </select>
                            </label>
                            <label className="feld">
                              <span>Rhythmus</span>
                              <select value={vorgang.rhythmus}
                                onChange={e => update(vorgang, { rhythmus: e.target.value })}>
                                {RHYTHMEN.map(r => <option key={r} value={r}>{RHYTHMUS_LABELS[r]}</option>)}
                              </select>
                            </label>
                          </div>
                        </>
                      )}
                      <div className="zeile">
                        <label className="feld">
                          <span>Personen min</span>
                          <input type="number" min="0" inputMode="numeric" value={vorgang.personen.min}
                            onChange={e => update(vorgang, { personen: { min: parseInt(e.target.value) || 0 } })} />
                        </label>
                        <label className="feld">
                          <span>Personen max</span>
                          <input type="number" min="0" inputMode="numeric" value={vorgang.personen.max}
                            onChange={e => update(vorgang, { personen: { max: parseInt(e.target.value) || 0 } })} />
                        </label>
                        <label className="feld">
                          <span>Dauer min (min)</span>
                          <input type="number" min="0" inputMode="numeric" value={vorgang.dauerMin.min}
                            onChange={e => update(vorgang, { dauerMin: { min: parseInt(e.target.value) || 0 } })} />
                        </label>
                        <label className="feld">
                          <span>Dauer max (min)</span>
                          <input type="number" min="0" inputMode="numeric" value={vorgang.dauerMin.max}
                            onChange={e => update(vorgang, { dauerMin: { max: parseInt(e.target.value) || 0 } })} />
                        </label>
                      </div>
                      {['woechentlich', 'monatlich', 'alle2monate', 'alle4monate'].includes(vorgang.rhythmus) && (
                        <div style={{ marginBottom: 10 }}>
                          <div className="hinweis" style={{ marginBottom: 4 }}>Feste Tage (leer = frei wählbar):</div>
                          <TageChips auswahl={vorgang.wochentage || []}
                            onChange={wochentage => update(vorgang, { wochentage })} />
                        </div>
                      )}
                      <div className="zeile">
                        <label className="feld">
                          <span>Zeitanker</span>
                          <select value={ANKER.includes(vorgang.zeitanker || '') ? (vorgang.zeitanker || '') : 'konkret'}
                            onChange={e => update(vorgang, { zeitanker: e.target.value === 'konkret' ? '06:00' : (e.target.value || null) })}>
                            <option value="">tagsüber / kein</option>
                            <option value="frueh">früh</option>
                            <option value="vormittag">vormittag</option>
                            <option value="nachmittag">nachmittag</option>
                            <option value="abend">abends</option>
                            <option value="konkret">konkrete Uhrzeit …</option>
                          </select>
                        </label>
                        {vorgang.zeitanker && !ANKER.includes(vorgang.zeitanker) && (
                          <label className="feld" style={{ maxWidth: 120 }}>
                            <span>Uhrzeit</span>
                            <input type="time" value={vorgang.zeitanker}
                              onChange={e => update(vorgang, { zeitanker: e.target.value || null })} />
                          </label>
                        )}
                        <label className="feld">
                          <span>Pflicht-Rolle</span>
                          <select value={vorgang.rolle || ''}
                            onChange={e => update(vorgang, { rolle: e.target.value || null })}>
                            {ROLLEN.map(r => (
                              <option key={r} value={r}>{r ? ROLLE_LABELS[r] : '– keine –'}</option>
                            ))}
                          </select>
                        </label>
                        <label className="feld">
                          <span>Budget</span>
                          <select value={vorgang.budgetQuelle}
                            onChange={e => update(vorgang, { budgetQuelle: e.target.value })}>
                            <option value="filiale">Filiale</option>
                            <option value="extern">extern (zählt nicht)</option>
                          </select>
                        </label>
                      </div>
                      <div className="fab-zeile" style={{ margin: 0 }}>
                        {hatOverride && !istCustom(vorgang) && (
                          <button className="btn klein zweit" onClick={() => resetOverride(vorgang.id)}>
                            ↺ Auf Standard zurücksetzen
                          </button>
                        )}
                        {istCustom(vorgang) && (
                          <button className="btn klein gefahr" onClick={() => loescheCustom(vorgang.id)}>
                            Vorgang löschen
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      <button className="btn voll" onClick={neuerVorgang}>+ Eigener Vorgang</button>
    </div>
  )
}
