// Vorgangskatalog: Standard-Daten, Labels und Filial-Override-Merge.
// Der Katalog dient der STUNDEN-KALKULATION (Bedarfsmodul), kein Task-Management.

export const KATEGORIE_LABELS = {
  bakeoff: 'Bake-Off',
  oug: 'Obst & Gemüse',
  fleischmopro: 'Fleisch/Mopro',
  trockenaktion: 'Trocken/Aktion',
  logistik: 'Logistik',
  oeffnungschluss: 'Öffnung/Schluss',
  inventur: 'Inventur',
  bestellung: 'Bestellung',
  kontrolle: 'Kontrolle',
  saison: 'Saison',
}

export const RHYTHMUS_LABELS = {
  taeglich: 'täglich',
  woechentlich: 'wöchentlich',
  monatlich: 'monatlich',
  alle2monate: 'alle 2 Monate',
  alle4monate: 'alle 4 Monate',
  jeLiefertag: 'je Liefertag',
  saison: 'Saison',
}

export const ROLLE_LABELS = {
  baecker: 'Bäcker',
  ml: 'ML',
  kassierer: 'Kasse',
  schluesseltraeger: 'Schlüsselträger',
  reinigung: 'Reinigungskraft',
}

export const ZEITANKER_LABELS = {
  frueh: 'früh',
  vormittag: 'vormittag',
  nachmittag: 'nachmittag',
  abend: 'abends',
}

// Sortierreihenfolge für die Tagesansicht (konkrete Uhrzeiten zuerst)
export function zeitankerSort(anker) {
  if (!anker) return 500 // tagsüber / ohne Anker
  if (/^\d{1,2}:\d{2}$/.test(anker)) {
    const [h, m] = anker.split(':').map(Number)
    return h * 60 + m
  }
  return { frueh: 360, vormittag: 540, nachmittag: 840, abend: 1080 }[anker] ?? 500
}

export const LIEFERARTEN = ['frische', 'trocken', 'tk', 'mopro']
export const LIEFERART_LABELS = {
  frische: 'Frische', trocken: 'Trocken', tk: 'TK', mopro: 'Mopro',
}

// ── Standard-Katalog (beim ersten Start geladen, global; pro Filiale
//    überschreibbar via ep_filialen[].vorgangOverrides) ───────────────────────
function v(id, name, kategorie, rhythmus, pMin, pMax, dMin, dMax, extra = {}) {
  return {
    id, name, kategorie, rhythmus,
    wochentage: [],
    personen: { min: pMin, max: pMax },
    dauerMin: { min: dMin, max: dMax },
    zeitanker: null,
    rolle: null,
    budgetQuelle: 'filiale',
    aktiv: true,
    ...extra,
  }
}

export const STANDARD_KATALOG = [
  // Täglich
  v('backen-frueh', 'Backen früh (Erstbestückung + Reinigung Vorbereitungsraum)', 'bakeoff', 'taeglich', 1, 1, 150, 180, { zeitanker: '06:00', rolle: 'baecker' }),
  v('oug-aufbau', 'O&G-Aufbau (Mitteltisch, Seitenregal, Bananenwelle, Beeren)', 'oug', 'taeglich', 1, 1, 150, 150, { zeitanker: '06:00' }),
  v('oug-aufbau-2p', 'O&G-Aufbau 2. Person (Volumentage)', 'oug', 'woechentlich', 1, 1, 150, 150, { wochentage: ['mo', 'do', 'fr'], zeitanker: '06:00' }),
  v('nachbacken', 'Nachbacken (~4–6 Durchgänge à 15 min)', 'bakeoff', 'taeglich', 1, 1, 60, 90, { rolle: 'baecker' }),
  v('frische-quali', 'Frische-Qualitätskontrolle (alle Bereiche, alle 2 h)', 'kontrolle', 'taeglich', 1, 1, 30, 60),
  v('mhd-oug', 'MHD O&G + Reduzierungen', 'kontrolle', 'taeglich', 1, 1, 15, 15, { zeitanker: 'frueh' }),
  v('mhd-fleisch', 'MHD Fleisch', 'kontrolle', 'taeglich', 1, 1, 10, 10, { zeitanker: 'frueh' }),
  v('mhd-mopro', 'MHD Mopro (Di–Sa)', 'kontrolle', 'woechentlich', 1, 1, 15, 30, { wochentage: ['di', 'mi', 'do', 'fr', 'sa'], zeitanker: 'frueh' }),
  v('mhd-mopro-komplett', 'MHD Mopro Komplettaufnahme', 'kontrolle', 'woechentlich', 1, 1, 120, 120, { wochentage: ['mo'], zeitanker: 'frueh' }),
  v('bestellung-ml', 'Bestellungen ML (Obst 15 + Mopro 20 + Fleisch 15)', 'bestellung', 'taeglich', 1, 1, 50, 50, { zeitanker: 'vormittag', rolle: 'ml' }),
  v('bestellung-bo', 'Bestellung B/O', 'bestellung', 'taeglich', 1, 1, 15, 15, { zeitanker: 'frueh', rolle: 'baecker' }),
  v('leergut', 'Leergut-Sortierung (über den Tag verteilt)', 'logistik', 'taeglich', 1, 1, 60, 120),
  v('presse', 'Zeitschriften/Presse', 'logistik', 'taeglich', 1, 1, 10, 10, { zeitanker: 'frueh', rolle: 'kassierer' }),
  v('kasse-oeffnung', 'Kassen/Tresor Öffnung', 'oeffnungschluss', 'taeglich', 1, 1, 10, 10, { zeitanker: 'frueh', rolle: 'schluesseltraeger' }),
  v('kasse-abrechnung', 'Kassenabrechnung + Safebag + Tresor', 'oeffnungschluss', 'taeglich', 1, 1, 15, 15, { zeitanker: 'abend', rolle: 'schluesseltraeger' }),
  v('reinigung', 'Reinigungskraft (fegen, Wischplan)', 'oeffnungschluss', 'taeglich', 1, 1, 120, 120, { zeitanker: 'frueh', rolle: 'reinigung' }),
  // Wöchentlich
  v('wochenwerbung', 'Wochenwerbung aufbauen (für Mo)', 'trockenaktion', 'woechentlich', 2, 3, 180, 180, { wochentage: ['sa'], zeitanker: 'abend' }),
  v('do-werbung', 'Do-Werbung aufbauen', 'trockenaktion', 'woechentlich', 1, 2, 60, 120, { wochentage: ['mi'], zeitanker: 'abend' }),
  v('freitagskracher', 'Freitagskracher aufbauen', 'trockenaktion', 'woechentlich', 1, 1, 15, 30, { wochentage: ['do'], zeitanker: 'abend' }),
  v('werbemittel', 'Werbemittel (Plakate/Wippen/Aufsteller)', 'trockenaktion', 'woechentlich', 1, 1, 60, 60, { wochentage: ['sa'], zeitanker: 'abend' }),
  v('mhd-kontrollplan', 'MHD-Kontrollplan (rotierende Warengruppe)', 'kontrolle', 'woechentlich', 1, 1, 15, 120),
  v('warensicherung', 'Warensicherungs-Kontrolle', 'kontrolle', 'woechentlich', 1, 1, 60, 60),
  // Inventuren (App schlägt fällige automatisch vor)
  v('inv-sb-fleisch', 'Inventur SB Fleisch/Wurst', 'inventur', 'monatlich', 1, 1, 120, 120, { wochentage: ['di'] }),
  v('inv-oug', 'Inventur O&G', 'inventur', 'monatlich', 1, 1, 60, 60, { wochentage: ['mo'] }),
  v('inv-bakeoff', 'Inventur Bake-Off', 'inventur', 'alle2monate', 1, 1, 60, 60, { wochentage: ['mo'] }),
  v('inv-mopro', 'Inventur Mopro', 'inventur', 'alle2monate', 1, 1, 90, 90, { wochentage: ['mo'] }),
  v('inv-trocken', 'Inventur Trocken inkl. Zigaretten (externes Team)', 'inventur', 'alle4monate', 0, 0, 0, 0, { budgetQuelle: 'extern' }),
  v('inv-ts-vorbereitung', 'TS-Inventur-Vorbereitung (Vortag)', 'inventur', 'alle4monate', 1, 1, 600, 960, { budgetQuelle: 'extern' }),
  // Saison
  v('saison-aufbau', 'Saisonaufbau Ostern / Weihnachten', 'saison', 'saison', 1, 2, 240, 360),
]

// ── Filial-Stammdaten-Defaults (Lieferprofil + Verräumfaktoren) ──────────────
export function defaultLieferprofil() {
  return {
    frische: { tage: ['mo', 'di', 'mi', 'do', 'fr', 'sa'], zeitpunkt: 'frueh', typischePaletten: 4 },
    trocken: { tage: ['di', 'do'], zeitpunkt: 'frueh', typischePaletten: 10 },
    tk: { tage: ['mi', 'fr'], zeitpunkt: 'frueh', typischePaletten: 3 },
    mopro: { tage: [], zeitpunkt: 'frueh', typischePaletten: 3 },
    fleischAusnahmen: ['di'], // Fleisch täglich AUSSER an diesen Tagen
  }
}

export function defaultPalettenFaktoren() {
  // Minuten Verräumzeit pro Palette, je Art (pro Filiale editierbar)
  return { frische: 45, trocken: 40, tk: 60, mopro: 45 }
}

// ── Effektiver Katalog einer Filiale (Standard + Overrides gemerged) ─────────
export function effektiverKatalog(katalog, filiale) {
  const overrides = filiale?.vorgangOverrides || {}
  return katalog.map(vorgang => {
    const o = overrides[vorgang.id]
    if (!o) return vorgang
    return {
      ...vorgang,
      ...o,
      personen: { ...vorgang.personen, ...(o.personen || {}) },
      dauerMin: { ...vorgang.dauerMin, ...(o.dauerMin || {}) },
    }
  })
}
