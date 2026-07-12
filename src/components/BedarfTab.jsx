import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TAGE, TAG_KURZ, TAG_NAMEN, dauerHHMM } from '../utils/zeit'
import {
  wochenBedarf, budgetAmpel, stdText, spanneText, lieferungenVorbelegen,
} from '../utils/bedarf'
import {
  effektiverKatalog, LIEFERARTEN, LIEFERART_LABELS, ROLLE_LABELS,
  ZEITANKER_LABELS,
} from '../utils/katalog'

const AMPEL_FARBEN = { gruen: '#1f6f43', gelb: '#b98d00', rot: '#d3392f', grau: '#667085' }
const AMPEL_TEXTE = {
  gruen: 'Budget reicht für den Bedarf',
  gelb: 'Knapp: weniger als 5 % Luft im Budget',
  rot: 'Bedarf übersteigt das Wochenbudget',
  grau: 'Kein Budget hinterlegt',
}

function ankerText(anker) {
  if (!anker) return 'tagsüber'
  return ZEITANKER_LABELS[anker] || anker
}

// Bedarf-Tab im Plan-Editor: Kalkulation, kein Task-Management.
export default function BedarfTab({ woche, setWoche, filiale, katalog, geplantProTag }) {
  const [offenerTag, setOffenerTag] = useState(null)

  const bedarf = useMemo(
    () => wochenBedarf({ filiale, katalog, woche }),
    [filiale, katalog, woche])

  const budgetMin = Math.round((Number(filiale.wochenstundenBudget) || 0) * 60)
  const ampel = budgetAmpel(bedarf, budgetMin)
  const geplantGesamt = TAGE.reduce((s, t) => s + (geplantProTag[t] || 0), 0)

  const offeneTage = TAGE.filter(t => filiale.oeffnungszeiten?.[t]?.offen)
  const budgetProTag = offeneTage.length > 0 ? budgetMin / offeneTage.length : 0
  const skalenMax = Math.max(
    budgetProTag,
    ...TAGE.map(t => Math.max(bedarf.tage[t].maxMin, geplantProTag[t] || 0)),
    1)

  // Inventuren/Saison: alle Kandidaten aus dem Katalog
  const zusatzKandidaten = effektiverKatalog(katalog, filiale).filter(v =>
    v.aktiv && ['monatlich', 'alle2monate', 'alle4monate', 'saison'].includes(v.rhythmus))
  const zusatzAktiv = woche.inventurenDiesenMonat || []

  function setzeLieferung(idx, aenderung) {
    setWoche(w => ({
      ...w,
      lieferungen: w.lieferungen.map((l, i) => i === idx ? { ...l, ...aenderung } : l),
    }))
  }

  function toggleZusatz(vorgangId, standardTag) {
    setWoche(w => {
      const liste = w.inventurenDiesenMonat || []
      const vorhanden = liste.find(z => z.vorgangId === vorgangId)
      return {
        ...w,
        inventurenDiesenMonat: vorhanden
          ? liste.filter(z => z.vorgangId !== vorgangId)
          : [...liste, { vorgangId, tag: standardTag }],
      }
    })
  }

  return (
    <>
      {/* Wochen-Summe vs. Budget (Ampel) */}
      <div className="karte">
        <h2>Wochenbedarf vs. Budget</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
            background: AMPEL_FARBEN[ampel.farbe],
          }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              Bedarf ca. {spanneText(bedarf.minMin, bedarf.maxMin)}
            </div>
            <div className="hinweis" style={{ margin: 0 }}>
              Budget {dauerHHMM(budgetMin)} Std · geplant {dauerHHMM(geplantGesamt)} · {AMPEL_TEXTE[ampel.farbe]}
            </div>
          </div>
        </div>
        {(bedarf.externMaxMin > 0) && (
          <p className="hinweis">
            + extern (zählt nicht gegen das Budget): {spanneText(bedarf.externMinMin, bedarf.externMaxMin)}
          </p>
        )}
      </div>

      {/* Balken pro Tag: Bedarf vs. geplant vs. Budget-Anteil */}
      <div className="karte">
        <h2>Bedarf pro Tag</h2>
        <div className="bedarf-legende">
          <span><i style={{ background: '#4272b8' }} /> Bedarf (Mittel)</span>
          <span><i style={{ background: 'var(--gruen)' }} /> Geplant</span>
          <span><i className="strich" /> Budget-Anteil/Tag</span>
        </div>
        {TAGE.map(tag => {
          const t = bedarf.tage[tag]
          const mittel = (t.minMin + t.maxMin) / 2
          const geplant = geplantProTag[tag] || 0
          const offen = filiale.oeffnungszeiten?.[tag]?.offen
          const markerPos = budgetProTag > 0 ? Math.min(100, (budgetProTag / skalenMax) * 100) : null
          return (
            <div key={tag} className="bedarf-zeile"
              onClick={() => setOffenerTag(offenerTag === tag ? null : tag)}>
              <div className="bedarf-tag">{TAG_KURZ[tag]}</div>
              <div className="bedarf-balken">
                {markerPos != null && offen && (
                  <span className="bedarf-marker" style={{ left: `${markerPos}%` }} />
                )}
                <div className="balkenreihe">
                  <div className="balken bedarf" style={{ width: `${(mittel / skalenMax) * 100}%` }} />
                  <span className="balken-wert">{offen ? spanneText(t.minMin, t.maxMin) : 'geschlossen'}</span>
                </div>
                <div className="balkenreihe">
                  <div className="balken geplant" style={{ width: `${(geplant / skalenMax) * 100}%` }} />
                  <span className="balken-wert">{dauerHHMM(geplant)}</span>
                </div>
              </div>
              <span className="pfeil">{offenerTag === tag ? '▲' : '▼'}</span>
            </div>
          )
        })}
        {bedarf.flexPosten.length > 0 && (
          <p className="hinweis">
            + frei planbar diese Woche: {bedarf.flexPosten.map(p =>
              `${p.name} (${spanneText(p.minMin, p.maxMin)})`).join(' · ')}
          </p>
        )}
      </div>

      {/* Tagesansicht für den ML */}
      {offenerTag && (
        <div className="karte">
          <h2>{TAG_NAMEN[offenerTag]} – Vorgänge</h2>
          {bedarf.tage[offenerTag].posten.length === 0 && (
            <div className="leer-hinweis">Keine Vorgänge an diesem Tag.</div>
          )}
          {bedarf.tage[offenerTag].posten.map((p, i) => (
            <div key={i} className="listen-eintrag" style={{ padding: '8px 0' }}>
              <div className="haupt">
                <div style={{ fontSize: 14 }}>
                  <b>{ankerText(p.zeitanker)}</b> · {p.name}
                </div>
                <div className="unter">
                  {p.personen ? `${p.personen.min}${p.personen.max > p.personen.min ? '–' + p.personen.max : ''} P · ` : ''}
                  ≈ {spanneText(p.minMin, p.maxMin)}
                  {p.rolle ? ` · Rolle: ${ROLLE_LABELS[p.rolle] || p.rolle}` : ''}
                  {p.extern ? ' · ' : ''}
                  {p.extern && <span className="badge blau">extern</span>}
                </div>
              </div>
            </div>
          ))}
          {(filiale.bestellzeiten || []).length > 0 && (
            <>
              <h3>Bestell-Deadlines</h3>
              {filiale.bestellzeiten.map((b, i) => (
                <div key={i} className="hinweis">⏰ {b.deadline} – {b.name}</div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Lieferungen der Woche */}
      <div className="karte">
        <h2>Lieferungen dieser Woche</h2>
        <p className="hinweis">Vorbelegt aus dem Filial-Lieferprofil – Paletten je Lieferung anpassen.</p>
        {(woche.lieferungen || []).map((l, idx) => (
          <div key={idx} className="zeile" style={{ marginBottom: 6, alignItems: 'center' }}>
            <select value={l.tag} style={{ maxWidth: 90 }}
              onChange={e => setzeLieferung(idx, { tag: e.target.value })}>
              {TAGE.map(t => <option key={t} value={t}>{TAG_KURZ[t]}</option>)}
            </select>
            <select value={l.art}
              onChange={e => setzeLieferung(idx, { art: e.target.value })}>
              {LIEFERARTEN.map(a => <option key={a} value={a}>{LIEFERART_LABELS[a]}</option>)}
            </select>
            <input type="number" min="0" inputMode="numeric" value={l.paletten}
              style={{ maxWidth: 80 }} placeholder="Pal."
              onChange={e => setzeLieferung(idx, { paletten: parseInt(e.target.value) || 0 })} />
            <button className="btn klein gefahr" style={{ flex: '0 0 auto' }}
              onClick={() => setWoche(w => ({ ...w, lieferungen: w.lieferungen.filter((_, i) => i !== idx) }))}>
              ✕
            </button>
          </div>
        ))}
        <div className="fab-zeile" style={{ margin: '10px 0 0' }}>
          <button className="btn zweit"
            onClick={() => setWoche(w => ({
              ...w,
              lieferungen: [...(w.lieferungen || []), { tag: 'mo', art: 'trocken', paletten: 8 }],
            }))}>
            + Lieferung
          </button>
          <button className="btn zweit"
            onClick={() => setWoche(w => ({ ...w, lieferungen: lieferungenVorbelegen(filiale) }))}>
            ↺ Aus Lieferprofil
          </button>
        </div>
      </div>

      {/* Inventuren & Saison */}
      <div className="karte">
        <h2>Inventuren &amp; Saison diese Woche</h2>
        <p className="hinweis">Fällige Inventuren werden nach Rhythmus vorgeschlagen – hier bestätigen oder verschieben.</p>
        {zusatzKandidaten.map(vorgang => {
          const eintrag = zusatzAktiv.find(z => z.vorgangId === vorgang.id)
          return (
            <div key={vorgang.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--grau-linie)' }}>
              <input type="checkbox" checked={!!eintrag}
                style={{ width: 20, height: 20, accentColor: 'var(--gruen)', flexShrink: 0 }}
                onChange={() => toggleZusatz(vorgang.id, vorgang.wochentage?.[0] || 'mo')} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}>{vorgang.name}</div>
                <div className="unter" style={{ fontSize: 12, color: 'var(--text-schwach)' }}>
                  {spanneText(vorgang.personen.min * vorgang.dauerMin.min, vorgang.personen.max * vorgang.dauerMin.max)}
                  {vorgang.budgetQuelle === 'extern' && <span className="badge blau" style={{ marginLeft: 6 }}>extern</span>}
                </div>
              </div>
              {eintrag && (
                <select value={eintrag.tag} style={{ maxWidth: 84 }}
                  onChange={e => setWoche(w => ({
                    ...w,
                    inventurenDiesenMonat: w.inventurenDiesenMonat.map(z =>
                      z.vorgangId === vorgang.id ? { ...z, tag: e.target.value } : z),
                  }))}>
                  {TAGE.map(t => <option key={t} value={t}>{TAG_KURZ[t]}</option>)}
                </select>
              )}
            </div>
          )
        })}
      </div>

      <p className="hinweis">
        Katalog anpassen (Zeiten, Personen, aktiv/inaktiv):{' '}
        <Link to={`/filiale/${filiale.id}/katalog`}>Vorgangskatalog öffnen</Link>
      </p>
    </>
  )
}
