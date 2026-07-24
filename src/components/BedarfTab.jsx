import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TAGE, TAG_KURZ, TAG_NAMEN, dauerHHMM } from '../utils/zeit'
import { spanneText, lieferungenVorbelegen } from '../utils/bedarf'
import { abgleich, sollMinutenTag, giltAm, stundenFuerTag } from '../utils/aufgaben'
import {
  effektiverKatalog, LIEFERARTEN, LIEFERART_LABELS,
} from '../utils/katalog'

const AMPEL_FARBEN = { gruen: '#1f6f43', gelb: '#b98d00', rot: '#d3392f', grau: '#667085' }
const AMPEL_TEXTE = {
  gruen: 'Budget reicht für die Aufgaben',
  gelb: 'Knapp: weniger als 5 % Luft im Budget',
  rot: 'Aufgaben übersteigen das Wochenbudget',
  grau: 'Kein Budget hinterlegt',
}

// Bedarf-Tab im Plan-Editor: Kalkulation, kein Task-Management.
export default function BedarfTab({
  woche, setWoche, filiale, katalog, geplantProTag, mitarbeiter, zuteilung,
}) {
  const [offenerTag, setOffenerTag] = useState(null)

  // Bedarf kommt jetzt aus den Tagesaufgaben (Wochen-Kopie hat Vorrang)
  const aufgaben = woche.tagesaufgaben || filiale.tagesaufgaben || []
  const check = useMemo(
    () => abgleich({ aufgaben, filiale, mitarbeiter: mitarbeiter || [] }),
    [aufgaben, filiale, mitarbeiter])

  const sollProTag = useMemo(() => Object.fromEntries(
    TAGE.map(tag => [tag, sollMinutenTag({ aufgaben, filiale, tag })])),
    [aufgaben, filiale])

  const budgetMin = check.budgetMin
  const geplantGesamt = TAGE.reduce((s, t) => s + (geplantProTag[t] || 0), 0)
  const ampelFarbe = budgetMin <= 0 ? 'grau'
    : check.sollMin > budgetMin ? 'rot'
      : budgetMin - check.sollMin < 0.05 * budgetMin ? 'gelb' : 'gruen'

  const skalenMax = Math.max(
    ...TAGE.map(t => Math.max(sollProTag[t] || 0, geplantProTag[t] || 0)), 1)

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
      {/* Drei-Wege-Abgleich */}
      <div className="karte">
        <h2>Aufgaben ↔ Budget ↔ Vertragsstunden</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{
            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
            background: AMPEL_FARBEN[ampelFarbe],
          }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              Aufgaben brauchen {dauerHHMM(check.sollMin)}
            </div>
            <div className="hinweis" style={{ margin: 0 }}>
              Budget {dauerHHMM(budgetMin)} · geplant {dauerHHMM(geplantGesamt)} · {AMPEL_TEXTE[ampelFarbe]}
            </div>
          </div>
        </div>
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
        <p className="hinweis">
          Aufgaben und Stunden pflegst du in den{' '}
          <Link to={`/filiale/${filiale.id}/aufgaben`}>Tagesaufgaben der Filiale</Link>.
        </p>
      </div>

      {/* Balken pro Tag: Soll vs. geplant */}
      <div className="karte">
        <h2>Soll und geplant pro Tag</h2>
        <div className="bedarf-legende">
          <span><i style={{ background: '#4272b8' }} /> Soll (Aufgaben)</span>
          <span><i style={{ background: 'var(--gruen)' }} /> Geplant</span>
        </div>
        {TAGE.map(tag => {
          const soll = sollProTag[tag] || 0
          const geplant = geplantProTag[tag] || 0
          const offen = filiale.oeffnungszeiten?.[tag]?.offen
          return (
            <div key={tag} className="bedarf-zeile"
              onClick={() => setOffenerTag(offenerTag === tag ? null : tag)}>
              <div className="bedarf-tag">{TAG_KURZ[tag]}</div>
              <div className="bedarf-balken">
                <div className="balkenreihe">
                  <div className="balken bedarf" style={{ width: `${(soll / skalenMax) * 100}%` }} />
                  <span className="balken-wert">{offen ? dauerHHMM(soll) : 'geschlossen'}</span>
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
      </div>

      {/* Tagesansicht: Aufgaben mit Soll und tatsächlich verteilt */}
      {offenerTag && (
        <div className="karte">
          <h2>{TAG_NAMEN[offenerTag]} – Aufgaben</h2>
          {aufgaben.filter(a => giltAm(a, offenerTag)).length === 0 && (
            <div className="leer-hinweis">Keine Aufgaben an diesem Tag.</div>
          )}
          {aufgaben.filter(a => giltAm(a, offenerTag)).map(a => {
            const soll = Math.round(stundenFuerTag(a, offenerTag) * 60)
            const erledigt = zuteilung?.[offenerTag]?.jeAufgabe?.[a.id]?.erledigtMin ?? 0
            const offen = soll - erledigt
            return (
              <div key={a.id} className="listen-eintrag" style={{ padding: '8px 0' }}>
                <div className="haupt">
                  <div style={{ fontSize: 14 }}>
                    <span className="prio-kugel">{a.prioritaet ?? 3}</span> {a.name}
                  </div>
                  <div className="unter">
                    Soll {dauerHHMM(soll)} · verteilt {dauerHHMM(erledigt)}
                    {offen > 15 && <span className="badge rot" style={{ marginLeft: 6 }}>
                      {dauerHHMM(offen)} offen
                    </span>}
                    {a.budgetQuelle === 'extern' && <span className="badge blau" style={{ marginLeft: 6 }}>extern</span>}
                  </div>
                </div>
              </div>
            )
          })}
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
