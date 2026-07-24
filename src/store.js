// localStorage-Zugriff, Prefix ep_ – kein Backend, alles auf dem Gerät.
import { ALLE_TAGE, TAGE } from './utils/zeit'
import {
  STANDARD_KATALOG, defaultLieferprofil, defaultPalettenFaktoren,
} from './utils/katalog'
import { leerePrioritaeten } from './utils/rollen'

const KEY_PROFILE = 'ep_profile'
const KEY_FILIALEN = 'ep_filialen'
const KEY_MITARBEITER = 'ep_mitarbeiter'
const KEY_WOCHEN = 'ep_wochen'
const KEY_KATALOG = 'ep_vorgangskatalog'

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function lade(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function speichere(key, wert) {
  localStorage.setItem(key, JSON.stringify(wert))
}

// ---------- Profil ----------

export function defaultProfile() {
  return {
    vlName: '',
    niederlassung: '',
    mindestlohn: 13.90,
    minijobGrenze: 603,
    zuschlaege: [
      { name: 'Spätzuschlag', von: '18:30', bis: '20:00', prozent: 20 },
      { name: 'Nachtzuschlag', von: '20:00', bis: '23:59', prozent: 50 },
    ],
  }
}

export function getProfile() {
  return { ...defaultProfile(), ...lade(KEY_PROFILE, {}) }
}

export function saveProfile(profile) {
  speichere(KEY_PROFILE, profile)
}

// ---------- Filialen ----------

export function defaultFiliale() {
  const oz = {}
  for (const t of ALLE_TAGE) {
    oz[t] = t === 'so'
      ? { auf: '06:00', zu: '22:15', offen: false }
      : { auf: '06:00', zu: '22:15', offen: true }
  }
  return {
    id: uid(),
    nummer: '',
    adresse: '',
    bereich: 'Lebensmittel',
    oeffnungszeiten: oz,
    wochenstundenBudget: 380,
    baeckerFenster: { bis: '10:00' },
    kassenStandard: 1,
    kassenPeaks: [
      { tage: [...TAGE], von: '11:00', bis: '14:00', anzahl: 2 },
    ],
    schichtvorlagen: [
      { id: uid(), name: 'Früh', von: '06:00', bis: '14:30', pauseMin: 30 },
      { id: uid(), name: 'Spät', von: '14:15', bis: '22:15', pauseMin: 30 },
    ],
    lieferprofil: defaultLieferprofil(),
    palettenFaktoren: defaultPalettenFaktoren(),
    bestellzeiten: [],
    vorgangOverrides: {},
  }
}

// Migration: ältere Filialen um Bedarfsmodul-Felder ergänzen (lazy)
function mitFilialDefaults(f) {
  return {
    lieferprofil: defaultLieferprofil(),
    palettenFaktoren: defaultPalettenFaktoren(),
    bestellzeiten: [],
    vorgangOverrides: {},
    ...f,
  }
}

export function getFilialen() {
  return lade(KEY_FILIALEN, []).map(mitFilialDefaults)
}

export function getFiliale(id) {
  return getFilialen().find(f => f.id === id) || null
}

export function saveFiliale(filiale) {
  const alle = getFilialen()
  const idx = alle.findIndex(f => f.id === filiale.id)
  if (idx >= 0) alle[idx] = filiale
  else alle.push(filiale)
  speichere(KEY_FILIALEN, alle)
}

export function deleteFiliale(id) {
  speichere(KEY_FILIALEN, getFilialen().filter(f => f.id !== id))
  // Mitarbeiter der Filiale mit entfernen
  speichere(KEY_MITARBEITER, getAlleMitarbeiter().filter(m => m.filialeId !== id))
}

// ---------- Mitarbeiter ----------

export const FUNKTIONEN = [
  'Filialverantwortlicher',
  '1. stellv. Filialverantwortlicher',
  '2. stellv. Filialverantwortlicher',
  'Verkäufer/in Lebensmittel',
  'Azubi Verkäufer/in',
  'Aushilfe Lebensmittel',
  'Reinigungskraft Lebensmittel',
]

export function defaultMitarbeiter(filialeId, profile) {
  const verf = {}
  for (const t of TAGE) verf[t] = { verfuegbar: true, von: null, bis: null }
  return {
    id: uid(),
    filialeId,
    name: '',
    vorname: '',
    funktion: 'Verkäufer/in Lebensmittel',
    typ: 'fest',
    vertragsstunden: 37.5,
    stundenlohn: profile?.mindestlohn ?? 13.90,
    verdienstgrenze: profile?.minijobGrenze ?? 603,
    prioritaeten: leerePrioritaeten(),
    dauerhaftAbwesend: false,
    abwesenheitsGrund: '',
    verfuegbarkeit: verf,
    azubi: false,
    berufsschultage: [],
  }
}

// Migration: alte Quali-Häkchen → Bereichs-Prioritäten (alle als Prio 1,
// also gleichwertig wie vorher – die Reihenfolge pflegt der Nutzer danach).
function mitMaDefaults(m) {
  if (m.prioritaeten) {
    return { dauerhaftAbwesend: false, abwesenheitsGrund: '', ...m }
  }
  const q = m.quali || {}
  return {
    dauerhaftAbwesend: false,
    abwesenheitsGrund: '',
    ...m,
    prioritaeten: {
      vertreter: q.schluesseltraeger ? 1 : null,
      bakeoff: q.baecker ? 1 : null,
      kasse: q.kasse ? 1 : null,
      packen: null,
    },
  }
}

export function getAlleMitarbeiter() {
  return lade(KEY_MITARBEITER, []).map(mitMaDefaults)
}

export function getMitarbeiter(filialeId) {
  return getAlleMitarbeiter().filter(m => m.filialeId === filialeId)
}

export function getMitarbeiterById(id) {
  return getAlleMitarbeiter().find(m => m.id === id) || null
}

export function saveMitarbeiter(ma) {
  const alle = getAlleMitarbeiter()
  const idx = alle.findIndex(m => m.id === ma.id)
  if (idx >= 0) alle[idx] = ma
  else alle.push(ma)
  speichere(KEY_MITARBEITER, alle)
}

export function deleteMitarbeiter(id) {
  speichere(KEY_MITARBEITER, getAlleMitarbeiter().filter(m => m.id !== id))
}

// GfB = geringfügig Beschäftigte; Aushilfen + Reinigungskraft laufen im
// Export im eigenen "- Aushilfe"-Block.
export function istAushilfe(ma) {
  return ma.typ === 'gfb' || ma.funktion === 'Aushilfe Lebensmittel' ||
    ma.funktion === 'Reinigungskraft Lebensmittel'
}

// ---------- Wochen ----------

export function wocheKey(filialeId, jahr, kw) {
  return `${filialeId}_${jahr}_KW${kw}`
}

export function getAlleWochen() {
  return lade(KEY_WOCHEN, {})
}

export function getWoche(filialeId, jahr, kw) {
  return getAlleWochen()[wocheKey(filialeId, jahr, kw)] || null
}

export function saveWoche(woche) {
  const alle = getAlleWochen()
  alle[wocheKey(woche.filialeId, woche.jahr, woche.kw)] = woche
  speichere(KEY_WOCHEN, alle)
}

export function deleteWoche(key) {
  const alle = getAlleWochen()
  delete alle[key]
  speichere(KEY_WOCHEN, alle)
}

// ---------- Vorgangskatalog (Bedarfsmodul) ----------

// Global; beim ersten Zugriff mit dem Standard-Katalog befüllt. Neue
// Standard-Vorgänge (App-Update) werden bestehenden Katalogen angehängt.
export function getKatalog() {
  const gespeichert = lade(KEY_KATALOG, null)
  if (!gespeichert) {
    speichere(KEY_KATALOG, STANDARD_KATALOG)
    return STANDARD_KATALOG
  }
  const vorhanden = new Set(gespeichert.map(v => v.id))
  const fehlend = STANDARD_KATALOG.filter(v => !vorhanden.has(v.id))
  if (fehlend.length > 0) {
    const erweitert = [...gespeichert, ...fehlend]
    speichere(KEY_KATALOG, erweitert)
    return erweitert
  }
  return gespeichert
}

export function saveKatalog(katalog) {
  speichere(KEY_KATALOG, katalog)
}
