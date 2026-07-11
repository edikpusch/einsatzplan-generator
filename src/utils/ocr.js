// OCR-Mitarbeiterimport aus dem Personalbericht – portiert aus
// MehrstundenManager (OcrScan.jsx). Tesseract.js, komplett offline
// (keine API-Calls, keine Daten verlassen das Gerät).
//
// Zwei-Bild-Flow: Bild 1 = Namensspalte, Bild 2 = Funktion + Wo-Std.
// Zusammenführung per Y-Positions-Matching (normalisiert 0–1, |Δy| < 0.03) –
// NICHT per Index: Index-Matching bricht, sobald ein Name über zwei Zeilen
// läuft (bekannter Bug im MehrstundenManager).
import * as Tesseract from 'tesseract.js'

export const Y_TOLERANZ = 0.03

// ── Bild-Vorverarbeitung (1:1 aus MehrstundenManager, + Rotation) ────────────
// Schmale Spalten-Streifen hochskalieren; Graustufen + Kontrast, damit kleine
// Zahlen/Kürzel schärfer werden und farbige Zeilen-Hintergründe verschwinden.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export async function preprocessImage(file, rotation = 0) {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const gedreht = rotation === 90 || rotation === 270
    const srcW = img.width, srcH = img.height
    const baseW = gedreht ? srcH : srcW
    const scale = baseW < 1400 ? Math.min(4, 1700 / baseW) : 1
    const w = Math.round((gedreht ? srcH : srcW) * scale)
    const h = Math.round((gedreht ? srcW : srcH) * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    const dw = gedreht ? h : w
    const dh = gedreht ? w : h
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()

    const imgData = ctx.getImageData(0, 0, w, h)
    const d = imgData.data
    const C = 1.6 // Kontrastfaktor
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      g = (g - 128) * C + 128
      g = g < 0 ? 0 : g > 255 ? 255 : g
      d[i] = d[i + 1] = d[i + 2] = g
    }
    ctx.putImageData(imgData, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── Tesseract-Worker (Konfiguration 1:1 aus MehrstundenManager) ──────────────
// worker.recognize() → data.words[] inkl. bbox (nicht die reine Text-API!)
export async function runTesseract(file, onProgress, rotation = 0) {
  const image = await preprocessImage(file, rotation)
  const worker = await Tesseract.createWorker('deu', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    logger: m => {
      if (onProgress && m.status === 'recognizing text') onProgress(Math.round(m.progress * 100))
    },
  })
  // PSM 6 = ein einheitlicher Textblock → robust für schmale Spalten-Streifen
  await worker.setParameters({ tessedit_pageseg_mode: '6' })
  const { data } = await worker.recognize(image)
  await worker.terminate()
  return data
}

// ── Funktions-Mapping: Kürzel im Personalbericht → ep_mitarbeiter.funktion ───
// Zentral und erweiterbar. null = unbekanntes Kürzel (im Review rot markiert).
export const KUERZEL_ZU_FUNKTION = {
  ML: 'Filialverantwortlicher',
  MLV: '1. stellv. Filialverantwortlicher',
  MLV2: '2. stellv. Filialverantwortlicher',
  VK: 'Verkäufer/in Lebensmittel',
  AZUBI: 'Azubi Verkäufer/in',
  GfB: 'Aushilfe Lebensmittel',
  RK: 'Reinigungskraft Lebensmittel',
}

// OCR-Fehler-Aliases (1:1 aus MehrstundenManager, erweiterbar)
const FUNKTION_MAP = {
  // Filialverwalter → Filialverantwortlicher
  filvw: 'ML', fivw: 'ML', fiivw: 'ML', filw: 'ML',
  fillt: 'ML', filt: 'ML', fiilt: 'ML', fill: 'ML', fin: 'ML', fil: 'ML',
  // 2. Stellvertreter VOR 1. prüfen (eigene Funktion im EinsatzplanGenerator)
  '2stml': 'MLV2', '2stmi': 'MLV2', '2stm': 'MLV2', '2sm': 'MLV2', '2sim': 'MLV2',
  // 1. Stellvertreter
  '1stml': 'MLV', '1stmi': 'MLV', '1stm': 'MLV', '1sm': 'MLV',
  sam: 'MLV', sim: 'MLV', '1sim': 'MLV',
  // Verkäufer (inkl. VerkL → VK)
  verkl: 'VK', verki: 'VK', verk: 'VK',
  vk: 'VK', wk: 'VK', vw: 'VK', ww: 'VK', yw: 'VK',
  // Azubi (inkl. AzuVK)
  azuvk: 'AZUBI', azuk: 'AZUBI', azu: 'AZUBI',
  // Aushilfe / geringfügig beschäftigt
  aush: 'GfB', auhs: 'GfB', aus: 'GfB',
  // Reinigung (Reini + ReiKr → Reinigungskraft)
  reikr: 'RK', reik: 'RK', reini: 'RK', rein: 'RK',
}

export function mapFunktion(raw) {
  if (!raw) return null
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!key || key.length < 2) return null
  for (const [k, v] of Object.entries(FUNKTION_MAP)) {
    if (key === k || key.startsWith(k)) return v
  }
  return null
}

// OCR-Ziffernverwechslungen – NUR für die Stunden-Erkennung, nie für die
// Funktion ("BO"→"80"→8,0 ; "S"→5 ; "l/I/|"→1)
export function normalizeOcrDigits(str) {
  return str
    .replace(/[OoQ]/g, '0')
    .replace(/B/g, '8')
    .replace(/[lI|!]/g, '1')
    .replace(/S/g, '5')
    .replace(/Z/g, '2')
    .replace(/g/g, '9')
}

// Vertragsstunden robust parsen:
//   "37:30" → 37.5 (HH:MM) · "37,5"/"30.0" → dezimal · OCR-Artefakt mit
//   verschlucktem Komma: "300" → 30.0, "375" → 37.5, "80" → 8.0
export function parseStunden(str) {
  // HH:MM ("37:30" → 37.5, NICHT 3730)
  const hm = str.match(/\b(\d{1,2}):([0-5]\d)\b/)
  if (hm) {
    const v = parseInt(hm[1], 10) + parseInt(hm[2], 10) / 60
    if (v >= 1 && v <= 48) return Math.round(v * 100) / 100
  }
  // Dezimal: "37,5" oder "37.5"
  const dec = str.match(/(\d{1,2}[,.]\d)/)
  if (dec) {
    const v = parseFloat(dec[1].replace(',', '.'))
    if (v >= 4 && v <= 45) return v
  }
  // Komma verschluckt: 2–3-stellige Zahl als X10 deuten ("80"→8,0 ; "375"→37,5)
  const int = str.match(/\b(\d{2,3})\b/)
  if (int) {
    const v = parseInt(int[1], 10)
    const h = v / 10
    if (v % 5 === 0 && h >= 4 && h <= 45) return h
  }
  return null
}

// ── Wörter zu Zeilen gruppieren (1:1 aus MehrstundenManager) ─────────────────
// Über vertikale Überlappung – robuster als feste Abstände.
export function gruppiereZeilen(words, minWordLen = 1) {
  const valid = words
    .filter(w => (w.text || '').trim().length >= minWordLen)
    .sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1))

  const lines = []
  for (const word of valid) {
    const wy0 = word.bbox.y0, wy1 = word.bbox.y1
    let best = null, bestRatio = 0
    for (const l of lines) {
      const ov = Math.min(wy1, l.y1) - Math.max(wy0, l.y0)
      if (ov <= 0) continue
      const ratio = ov / Math.min(wy1 - wy0, l.y1 - l.y0)
      if (ratio > bestRatio) { bestRatio = ratio; best = l }
    }
    if (best && bestRatio >= 0.4) {
      best.words.push(word)
      best.y0 = Math.min(best.y0, wy0)
      best.y1 = Math.max(best.y1, wy1)
    } else {
      lines.push({ words: [word], y0: wy0, y1: wy1 })
    }
  }
  lines.forEach(l => {
    l.yCenter = (l.y0 + l.y1) / 2
    l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0)
  })
  lines.sort((a, b) => a.yCenter - b.yCenter)
  return lines
}

// ── Bild 1: Namen mit normalisierter Y-Position ──────────────────────────────
// Mehrzeilige (umgebrochene) Namen werden zusammengeführt: eine Zeile mit nur
// EINEM groß beginnenden Wort direkt unter einer Namenszeile gilt als
// Fortsetzung des Vornamens → Durchschnitts-Y der beteiligten Zeilen.
export function extractNamen(data) {
  const HEADER = /^(Name|PNR|Tätig|Wo-|Std|Tarif|Eintritt|Austritt|Filiale|Regio|Nieder|Verkauf|Kontakt|Befrist)/i
  const imgH = data.words.reduce((max, w) => Math.max(max, w.bbox.y1), 1)
  const lines = gruppiereZeilen(data.words, 2)

  const result = []
  const hoehen = lines.map(l => l.y1 - l.y0).sort((a, b) => a - b)
  const medianHoehe = hoehen[Math.floor(hoehen.length / 2)] || 20

  for (const line of lines) {
    const text = line.words.map(w => w.text).join(' ').trim()
    if (!text || HEADER.test(text)) continue
    if (/^\d/.test(text) || /[0-9]{2}[.,][0-9]/.test(text)) continue

    // Nur groß beginnende Wörter (filtert OCR-Rauschen, Spaltenlinien, Kürzel)
    const words = text.split(/\s+/).filter(w => w.length >= 2 && /^[A-ZÄÖÜ]/.test(w))
    if (words.length === 0) continue

    const vorher = result[result.length - 1]
    if (words.length === 1) {
      // Einzelnes Wort: Fortsetzung eines umgebrochenen Namens, wenn es dicht
      // unter der vorherigen Namenszeile liegt – sonst Rauschen, überspringen.
      if (vorher && line.yCenter - vorher.yCenterUnten < medianHoehe * 2.2) {
        vorher.vorname = (vorher.vorname + ' ' + words[0]).trim()
        vorher.yCenter = (vorher.yCenter * vorher.zeilen + line.yCenter) / (vorher.zeilen + 1)
        vorher.zeilen += 1
        vorher.yCenterUnten = line.yCenter
        vorher.yNorm = vorher.yCenter / imgH
      }
      continue
    }

    result.push({
      nachname: words[0],
      vorname: words.slice(1).join(' '),
      yCenter: line.yCenter,
      yCenterUnten: line.yCenter,
      zeilen: 1,
      yNorm: line.yCenter / imgH,
    })
  }

  // Nur exakte Duplikate entfernen
  return result.filter((m, i, arr) =>
    arr.findIndex(x =>
      x.nachname.toLowerCase() === m.nachname.toLowerCase() &&
      x.vorname.toLowerCase() === m.vorname.toLowerCase()
    ) === i)
}

// ── Bild 2: Funktion + Stunden mit normalisierter Y-Position ─────────────────
export function extractStunden(data) {
  const HEADER = /^(Tätig|Wo-|Std|Tarif|PNR|Name|Filiale|Regio|Nieder|Verkauf|Kontakt)/i
  const imgH = data.words.reduce((max, w) => Math.max(max, w.bbox.y1), 1)
  const lines = gruppiereZeilen(data.words, 1)

  const result = []
  for (const line of lines) {
    const text = line.words.map(w => w.text).join(' ').replace(/[|()\[\]{}<>]/g, ' ').trim()
    if (!text || HEADER.test(text)) continue
    if (text.match(/^\d{4}/)) continue // Jahreszahlen etc.
    if (text.replace(/\s/g, '').length < 2) continue

    // Stunden: erst normal, dann mit OCR-Ziffernkorrektur ("AusH BO" → 8,0)
    let std = parseStunden(text)
    if (std === null) std = parseStunden(normalizeOcrDigits(text))

    // Funktion aus dem ORIGINAL-Text (nicht ziffernkorrigiert!)
    let kuerzel = null
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const f = mapFunktion(w)
      if (f) { kuerzel = f; break }
    }

    result.push({
      kuerzel, // z.B. 'VK' oder null (unbekannt)
      vertragsstunden: std,
      yCenter: line.yCenter,
      yNorm: line.yCenter / imgH,
    })
  }
  return result
}

// ── Y-Positions-Matching Bild 1 ↔ Bild 2 ─────────────────────────────────────
// Für jeden Namen die Stunden-Zeile mit minimalem |Δy| suchen (normalisiert
// auf Bildhöhe). Match nur bei |Δy| < Y_TOLERANZ; jede Stunden-Zeile wird
// höchstens einmal vergeben. OCR-Rauschzeilen in Bild 2 fallen automatisch
// raus, mehr/weniger Zeilen verursachen keinen Versatz.
export function matchePerY(namen, stundenListe) {
  const vergeben = new Set()
  return namen.map(name => {
    let best = null, bestDelta = Infinity
    stundenListe.forEach((s, i) => {
      if (vergeben.has(i)) return
      const delta = Math.abs(s.yNorm - name.yNorm)
      if (delta < bestDelta) { bestDelta = delta; best = i }
    })
    let treffer = null
    if (best != null && bestDelta < Y_TOLERANZ) {
      vergeben.add(best)
      treffer = stundenListe[best]
    }
    return {
      nachname: name.nachname,
      vorname: name.vorname,
      kuerzel: treffer?.kuerzel ?? null,
      vertragsstunden: treffer?.vertragsstunden ?? null,
      gematcht: !!treffer,
    }
  })
}

// ── Merge mit bestehenden ep_mitarbeiter (KRITISCH: IDs stabil halten!) ──────
// ep_wochen[*].plan referenziert maId – ein Rescan darf NIEMALS neue IDs für
// bestehende MA erzeugen, sonst brechen alle gespeicherten Wochenpläne.

// Normalisierter Match-Key: nachname+vorname, lowercase, Umlaute/Bindestriche/
// Leerzeichen entfernt.
export function matchKey(nachname, vorname) {
  return (String(nachname) + String(vorname))
    .toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '')
}

// Aus dem Scan ableitbare Felder eines Eintrags
export function scanFelder(eintrag) {
  const funktion = eintrag.kuerzel ? (KUERZEL_ZU_FUNKTION[eintrag.kuerzel] || '') : ''
  const gfb = eintrag.kuerzel === 'GfB' || eintrag.kuerzel === 'RK'
  return {
    funktion,
    typ: gfb ? 'gfb' : 'fest',
    azubi: eintrag.kuerzel === 'AZUBI',
    vertragsstunden: gfb ? null : eintrag.vertragsstunden,
  }
}

// Vergleicht Scan-Ergebnis mit Bestand. Rückgabe: { neu, geaendert, fehlt }
//  neu[]:       Scan-Einträge ohne Treffer im Bestand
//  geaendert[]: { ma, felder, diffs[] } – nur scanbare Felder, Rest bleibt
//  fehlt[]:     bestehende MA ohne Treffer im Scan (NICHT automatisch löschen)
export function baueVergleich(scanEintraege, bestehende) {
  const bestandNachKey = new Map(bestehende.map(m => [matchKey(m.name, m.vorname), m]))
  const getroffen = new Set()
  const neu = []
  const geaendert = []

  for (const e of scanEintraege) {
    const key = matchKey(e.nachname, e.vorname)
    const ma = bestandNachKey.get(key)
    const felder = scanFelder(e)
    if (ma && !getroffen.has(ma.id)) {
      getroffen.add(ma.id)
      const diffs = []
      if (felder.funktion && felder.funktion !== ma.funktion) {
        diffs.push({ feld: 'Funktion', alt: ma.funktion || '–', neu: felder.funktion })
      }
      if (felder.typ !== ma.typ) {
        diffs.push({ feld: 'Typ', alt: ma.typ, neu: felder.typ })
      }
      if (felder.typ === 'fest' && felder.vertragsstunden != null &&
        Number(felder.vertragsstunden) !== Number(ma.vertragsstunden)) {
        diffs.push({ feld: 'Vertragsstunden', alt: String(ma.vertragsstunden), neu: String(felder.vertragsstunden) })
      }
      if (felder.azubi !== !!ma.azubi) {
        diffs.push({ feld: 'Azubi', alt: ma.azubi ? 'ja' : 'nein', neu: felder.azubi ? 'ja' : 'nein' })
      }
      if (diffs.length > 0) geaendert.push({ ma, eintrag: e, felder, diffs })
    } else if (!ma) {
      neu.push({ eintrag: e, felder })
    }
  }

  const fehlt = bestehende.filter(m => !getroffen.has(m.id))
  return { neu, geaendert, fehlt }
}
