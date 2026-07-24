// Bereiche & Prioritäten pro Mitarbeiter.
// Ersetzt die früheren Quali-Häkchen: Wer für einen Bereich eine Prio-Zahl
// hat, ist dafür qualifiziert – die Zahl bestimmt die Reihenfolge
// (1 = erste Wahl). Leer/null = macht diesen Bereich nicht.
// Damit rückt bei Urlaub der Prio-1-Kraft automatisch Prio 2 nach.

export const BEREICHE = ['vertreter', 'bakeoff', 'kasse', 'packen']

export const BEREICH_LABELS = {
  vertreter: 'Vertreter (V)',
  bakeoff: 'Bake-Off (B/O)',
  kasse: 'Kasse',
  packen: 'Verräumung / Packen',
}

export const BEREICH_INFO = {
  vertreter: 'Schlüssel-/Marktverantwortung der Schicht',
  bakeoff: 'Backen früh, Nachbacken, Bestellung B/O',
  kasse: 'Kassenbesetzung inkl. Peaks',
  packen: 'Lieferungen annehmen und verräumen',
}

// Kurz-Badges für Listen
export const BEREICH_KURZ = {
  vertreter: 'V', bakeoff: 'B/O', kasse: 'Kasse', packen: 'Packen',
}

// Katalog-Rollen (utils/katalog.js) → Bereich. 'ml' und 'reinigung' hängen
// weiterhin an der Funktion, nicht an einer Prioritätsliste.
export const ROLLE_ZU_BEREICH = {
  schluesseltraeger: 'vertreter',
  baecker: 'bakeoff',
  kassierer: 'kasse',
  packen: 'packen',
}

export function leerePrioritaeten() {
  return { vertreter: null, bakeoff: null, kasse: null, packen: null }
}

// Kann dieser MA den Bereich übernehmen?
export function kannBereich(ma, bereich) {
  const p = ma?.prioritaeten?.[bereich]
  return p != null && p !== '' && !isNaN(Number(p))
}

// Priorität (1 = beste). Nicht qualifiziert → Infinity, damit Sortierungen
// solche MA automatisch ans Ende schieben.
export function bereichsPrio(ma, bereich) {
  if (!kannBereich(ma, bereich)) return Infinity
  return Number(ma.prioritaeten[bereich])
}

// MA-Liste für einen Bereich nach Priorität sortiert (nur Qualifizierte).
export function nachPrio(mitarbeiter, bereich) {
  return mitarbeiter
    .filter(m => kannBereich(m, bereich))
    .sort((a, b) => bereichsPrio(a, bereich) - bereichsPrio(b, bereich))
}

// Mitarbeiter, die überhaupt verplant werden dürfen.
// Dauerhaft Abwesende (Elternzeit, Langzeitkrank, ausgeschieden …) bleiben
// gespeichert, tauchen aber weder im Plan noch im Export auf.
export function istPlanbar(ma) {
  return !ma?.dauerhaftAbwesend
}
