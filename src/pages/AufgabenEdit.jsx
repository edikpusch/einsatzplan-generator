import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Kopf from '../components/Kopf'
import TageChips from '../components/TageChips'
import {
  getFiliale, saveFiliale, getKatalog, uid,
  getFavoriten, saveFavorit, deleteFavorit, getMitarbeiter,
} from '../store'
import { TAGE, TAG_KURZ, dauerHHMM } from '../utils/zeit'
import {
  MODI, MODUS_LABELS, MODUS_KURZ, neueAufgabe, aufgabenAusKatalog,
  stundenFuerTag, sollMinutenTag, tagesKurve, abgleich, arbeitsFenster,
} from '../utils/aufgaben'
import { BEREICHE, BEREICH_LABELS } from '../utils/rollen'
import { istPlanbar } from '../utils/rollen'

function stdText(std) {
  return String(Math.round(std * 100) / 100).replace('.', ',') + ' h'
}

export default function AufgabenEdit() {
  const { id: filialeId } = useParams()
  const [filiale, setFiliale] = useState(() => getFiliale(filialeId))
  const [favoriten, setFavoriten] = useState(getFavoriten)
  const [offen, setOffen] = useState(null)

  if (!filiale) {
    return (
      <div className="seite">
        <Kopf titel="Tagesaufgaben" zurueck="/filialen" />
        <div className="leer-hinweis">Filiale nicht gefunden.</div>
      </div>
    )
  }

  const aufgaben = filiale.tagesaufgaben || []
  const mitarbeiter = getMitarbeiter(filialeId).filter(istPlanbar)
  const check = abgleich({ aufgaben, filiale, mitarbeiter })

  function update(aenderung) {
    setFiliale(f => {
      const neu = { ...f, ...aenderung }
      saveFiliale(neu)
      return neu
    })
  }

  function updateAufgabe(id, aenderung) {
    update({
      tagesaufgaben: aufgaben.map(a => a.id === id ? { ...a, ...aenderung } : a),
    })
  }

  function setzeTagesStunden(a, tag, wert) {
    const abw = { ...(a.stundenJeTag || {}) }
    if (wert === '' || wert == null) delete abw[tag]
    else abw[tag] = Number(wert)
    updateAufgabe(a.id, { stundenJeTag: abw })
  }

  function favoritAnwenden(fav) {
    if (!confirm(`„${fav.name}" übernehmen? Die aktuellen Aufgaben dieser Filiale werden ersetzt.`)) return
    // Neue IDs vergeben, damit zwei Filialen sich nicht ins Gehege kommen
    update({
      tagesaufgaben: fav.aufgaben.map(a => ({ ...a, id: uid() })),
    })
  }

  function favoritSpeichern() {
    const name = prompt('Name für diesen Aufgaben-Satz:', 'Standardwoche')
    if (!name) return
    saveFavorit(name, aufgaben)
    setFavoriten(getFavoriten())
  }

  function ausKatalogNeu() {
    if (!confirm('Aufgaben neu aus dem Vorgangskatalog erzeugen? Eigene Änderungen gehen verloren.')) return
    update({ tagesaufgaben: aufgabenAusKatalog(filiale, getKatalog(), uid) })
  }

  return (
    <div className="seite">
      <Kopf titel={`Tagesaufgaben · Filiale ${filiale.nummer || '(neu)'}`}
        zurueck={`/filiale/${filialeId}`} />

      <div className="karte">
        <h2>Wochenbedarf im Abgleich</h2>
        <div className="abgleich-zeile">
          <div><span>Aufgaben</span><strong>{dauerHHMM(check.sollMin)}</strong></div>
          <div><span>Budget</span><strong>{dauerHHMM(check.budgetMin)}</strong></div>
          <div><span>Vertragsstunden</span><strong>{dauerHHMM(check.vertragMin)}</strong></div>
        </div>
        {check.hinweise.map((h, i) => (
          <div key={i} className={`warnung ${h.schwere}`}>
            <span className="punkt">{h.schwere === 'rot' ? '🔴' : '🟡'}</span>
            <span>{h.text}</span>
          </div>
        ))}
        {check.hinweise.length === 0 && (
          <p className="hinweis">Aufgaben, Budget und Vertragsstunden passen zusammen.</p>
        )}
      </div>

      <div className="karte">
        <h2>Soll je Tag</h2>
        <p className="hinweis">
          Wie viele Personen gleichzeitig nötig sind, rechnet die App aus den
          Stunden: Stunden ÷ Öffnungsdauer = Grundbesetzung, der Rest wird in
          die Stoßzeiten gelegt.
        </p>
        {TAGE.map(tag => {
          const f = arbeitsFenster(filiale, tag)
          if (!f) return (
            <div key={tag} className="soll-zeile">
              <b>{TAG_KURZ[tag]}</b><span className="hinweis">geschlossen</span>
            </div>
          )
          const soll = sollMinutenTag({ aufgaben, filiale, tag })
          const kurve = tagesKurve({ aufgaben, filiale, tag })
          const maxKoepfe = kurve.reduce((m, a) => Math.max(m, a.koepfe), 0)
          return (
            <div key={tag} className="soll-zeile">
              <b>{TAG_KURZ[tag]}</b>
              <span>{dauerHHMM(soll)} Soll</span>
              <span className="hinweis" style={{ margin: 0 }}>
                max. {maxKoepfe} gleichzeitig
              </span>
            </div>
          )
        })}
      </div>

      <div className="karte">
        <h2>Aufgaben ({aufgaben.length})</h2>
        {aufgaben.length === 0 && (
          <div className="leer-hinweis">Noch keine Aufgaben – aus dem Katalog erzeugen oder anlegen.</div>
        )}
        {aufgaben.map(a => {
          const auf = offen === a.id
          const abw = Object.keys(a.stundenJeTag || {}).length
          return (
            <div key={a.id} style={{ borderBottom: '1px solid var(--grau-linie)', padding: '9px 0' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setOffen(auf ? null : a.id)}>
                <input type="checkbox" checked={a.aktiv !== false}
                  style={{ width: 20, height: 20, accentColor: 'var(--gruen)', flexShrink: 0 }}
                  onClick={e => e.stopPropagation()}
                  onChange={e => updateAufgabe(a.id, { aktiv: e.target.checked })} />
                <div style={{ flex: 1, opacity: a.aktiv === false ? 0.45 : 1 }}>
                  <div className="ma-name">
                    <span className="prio-kugel">{a.prioritaet ?? 3}</span> {a.name}
                  </div>
                  <div className="ma-info">
                    {stdText(a.stunden)}{abw > 0 ? ` (${abw} Abweichung${abw > 1 ? 'en' : ''})` : ''}
                    {' · '}{MODUS_KURZ[a.modus]}
                    {a.modus === 'fenster' && a.fenster ? ` ${a.fenster.von}–${a.fenster.bis}` : ''}
                    {a.bereich ? ` · ${BEREICH_LABELS[a.bereich]}` : ' · jeder'}
                    {a.budgetQuelle === 'extern' && <span className="badge blau" style={{ marginLeft: 6 }}>extern</span>}
                  </div>
                </div>
                <span className="pfeil">{auf ? '▲' : '▼'}</span>
              </div>

              {auf && (
                <div style={{ paddingTop: 10 }}>
                  <label className="feld">
                    <span>Name</span>
                    <input type="text" value={a.name}
                      onChange={e => updateAufgabe(a.id, { name: e.target.value })} />
                  </label>
                  <div className="zeile">
                    <label className="feld">
                      <span>Wer darf das?</span>
                      <select value={a.bereich || ''}
                        onChange={e => updateAufgabe(a.id, { bereich: e.target.value || null })}>
                        <option value="">jeder Mitarbeiter</option>
                        {BEREICHE.map(b => (
                          <option key={b} value={b}>{BEREICH_LABELS[b]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="feld" style={{ maxWidth: 110 }}>
                      <span>Priorität</span>
                      <input type="number" min="1" max="9" inputMode="numeric"
                        value={a.prioritaet ?? 3}
                        onChange={e => updateAufgabe(a.id, { prioritaet: parseInt(e.target.value) || 1 })} />
                    </label>
                  </div>
                  <label className="feld">
                    <span>Art</span>
                    <select value={a.modus}
                      onChange={e => updateAufgabe(a.id, {
                        modus: e.target.value,
                        fenster: e.target.value === 'fenster'
                          ? (a.fenster || { von: filiale.fruehesterBeginn || '06:00', bis: '10:00' })
                          : null,
                      })}>
                      {MODI.map(m => <option key={m} value={m}>{MODUS_LABELS[m]}</option>)}
                    </select>
                  </label>
                  {a.modus === 'fenster' && (
                    <div className="zeile">
                      <label className="feld">
                        <span>Von</span>
                        <input type="time" value={a.fenster?.von || ''}
                          onChange={e => updateAufgabe(a.id, { fenster: { ...a.fenster, von: e.target.value } })} />
                      </label>
                      <label className="feld">
                        <span>Bis</span>
                        <input type="time" value={a.fenster?.bis || ''}
                          onChange={e => updateAufgabe(a.id, { fenster: { ...a.fenster, bis: e.target.value } })} />
                      </label>
                    </div>
                  )}

                  <div className="hinweis" style={{ marginBottom: 4 }}>An welchen Tagen?</div>
                  <TageChips auswahl={a.tage || []}
                    onChange={tage => updateAufgabe(a.id, { tage })} />

                  <div className="zeile" style={{ marginTop: 10 }}>
                    <label className="feld" style={{ maxWidth: 150 }}>
                      <span>Stunden (Standard)</span>
                      <input type="number" step="0.25" min="0" inputMode="decimal" value={a.stunden}
                        onChange={e => updateAufgabe(a.id, { stunden: parseFloat(e.target.value) || 0 })} />
                    </label>
                    <label className="feld">
                      <span>Budget</span>
                      <select value={a.budgetQuelle || 'filiale'}
                        onChange={e => updateAufgabe(a.id, { budgetQuelle: e.target.value })}>
                        <option value="filiale">zählt zum Budget</option>
                        <option value="extern">extern (zählt nicht)</option>
                      </select>
                    </label>
                  </div>

                  <div className="hinweis" style={{ marginBottom: 4 }}>
                    Abweichende Stunden je Tag (leer = Standard):
                  </div>
                  <div className="abw-tage" style={{ marginBottom: 10 }}>
                    {TAGE.map(tag => (
                      <label key={tag} style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
                        <div style={{ color: 'var(--text-schwach)', fontWeight: 600 }}>{TAG_KURZ[tag]}</div>
                        <input type="number" step="0.25" min="0" inputMode="decimal"
                          className="tages-feld"
                          disabled={!(a.tage || []).includes(tag)}
                          placeholder={String(a.stunden)}
                          value={a.stundenJeTag?.[tag] ?? ''}
                          onChange={e => setzeTagesStunden(a, tag, e.target.value)} />
                      </label>
                    ))}
                  </div>

                  <button className="btn klein gefahr"
                    onClick={() => {
                      if (confirm(`Aufgabe „${a.name}" löschen?`)) {
                        update({ tagesaufgaben: aufgaben.filter(x => x.id !== a.id) })
                        setOffen(null)
                      }
                    }}>
                    Aufgabe löschen
                  </button>
                </div>
              )}
            </div>
          )
        })}

        <div className="fab-zeile">
          <button className="btn" onClick={() => {
            const a = neueAufgabe(uid)
            update({ tagesaufgaben: [...aufgaben, a] })
            setOffen(a.id)
          }}>
            + Aufgabe
          </button>
          <button className="btn zweit" onClick={ausKatalogNeu}>↺ Aus Katalog</button>
        </div>
      </div>

      <div className="karte">
        <h2>Stoßzeiten</h2>
        <p className="hinweis">
          Nur die Zeiträume – wie viele Personen dort zusätzlich stehen, ergibt
          sich aus den Aufgaben-Stunden.
        </p>
        {(filiale.stosszeiten || []).map((s, idx) => (
          <div key={idx} style={{ borderTop: '1px solid var(--grau-linie)', padding: '10px 0' }}>
            <TageChips auswahl={s.tage || []}
              onChange={tage => update({
                stosszeiten: filiale.stosszeiten.map((x, i) => i === idx ? { ...x, tage } : x),
              })} />
            <div className="zeile" style={{ marginTop: 8 }}>
              <label className="feld">
                <span>Von</span>
                <input type="time" value={s.von}
                  onChange={e => update({ stosszeiten: filiale.stosszeiten.map((x, i) => i === idx ? { ...x, von: e.target.value } : x) })} />
              </label>
              <label className="feld">
                <span>Bis</span>
                <input type="time" value={s.bis}
                  onChange={e => update({ stosszeiten: filiale.stosszeiten.map((x, i) => i === idx ? { ...x, bis: e.target.value } : x) })} />
              </label>
              <button className="btn klein gefahr" style={{ alignSelf: 'flex-end', marginBottom: 12 }}
                onClick={() => update({ stosszeiten: filiale.stosszeiten.filter((_, i) => i !== idx) })}>
                ✕
              </button>
            </div>
          </div>
        ))}
        <button className="btn zweit voll"
          onClick={() => update({
            stosszeiten: [...(filiale.stosszeiten || []), { tage: [...TAGE], von: '11:00', bis: '14:00' }],
          })}>
          + Stoßzeit
        </button>
        <label className="feld" style={{ marginTop: 12 }}>
          <span>Frühester Arbeitsbeginn (harte Schranke)</span>
          <input type="time" value={filiale.fruehesterBeginn || '06:00'}
            onChange={e => update({ fruehesterBeginn: e.target.value })} />
        </label>
      </div>

      <div className="karte">
        <h2>Favoriten</h2>
        {favoriten.length === 0 && (
          <div className="leer-hinweis">Noch keine gespeicherten Aufgaben-Sätze.</div>
        )}
        {favoriten.map(f => (
          <div key={f.id} className="listen-eintrag" style={{ padding: '8px 0' }}>
            <div className="haupt">
              <div className="titel">{f.name}</div>
              <div className="unter">{f.aufgaben.length} Aufgaben</div>
            </div>
            <button className="btn klein zweit" onClick={() => favoritAnwenden(f)}>Übernehmen</button>
            <button className="btn klein gefahr"
              onClick={() => {
                if (confirm(`Favorit „${f.name}" löschen?`)) {
                  deleteFavorit(f.id); setFavoriten(getFavoriten())
                }
              }}>✕</button>
          </div>
        ))}
        <button className="btn zweit voll" style={{ marginTop: 10 }} onClick={favoritSpeichern}>
          ★ Aktuelle Aufgaben als Favorit speichern
        </button>
      </div>
    </div>
  )
}
