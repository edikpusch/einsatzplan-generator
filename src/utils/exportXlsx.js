// PEP-Export nach echtem Netto-PEP-Layout. Querformat.
// HARTE REGEL: Docs@Work rechnet keine Excel-Formeln – ALLE Werte werden in
// JS vorberechnet und als Text/Werte geschrieben. Niemals Formeln!
import ExcelJS from 'exceljs'
import {
  TAGE, dauerHHMM, dezimalZuHHMM, tagDatum, tagUeberschrift,
  datumKurz, monatName,
} from './zeit'
import { istAushilfe, FUNKTIONEN } from '../store'
import { wochenMonate, gfbMonatsWerte } from './gfb'

const GELB = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2A8' } }
const GRAU = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
const RAHMEN = {
  top: { style: 'thin' }, left: { style: 'thin' },
  bottom: { style: 'thin' }, right: { style: 'thin' },
}

function sortiereMitarbeiter(mitarbeiter) {
  return [...mitarbeiter].sort((a, b) => {
    const fa = FUNKTIONEN.indexOf(a.funktion), fb = FUNKTIONEN.indexOf(b.funktion)
    if (fa !== fb) return fa - fb
    return (a.name + a.vorname).localeCompare(b.name + b.vorname)
  })
}

// Schreibt einen 3-zeiligen MA-Block, gibt die nächste freie Zeile zurück.
function schreibeMaBlock(sheet, zeile, ma, woche, alleWochen, profile) {
  const plan = woche.plan?.[ma.id] || {}

  // Wochensumme (Minuten)
  let wocheMin = 0
  for (const tag of TAGE) {
    const z = plan[tag]
    if (z?.art === 'arbeit') wocheMin += z.stdMin || 0
  }

  const r1 = sheet.getRow(zeile)
  const r2 = sheet.getRow(zeile + 1)
  const r3 = sheet.getRow(zeile + 2)

  // Spalte A: Name + Funktion / Stunden-Zeilen
  r1.getCell(1).value = {
    richText: [
      { text: `${ma.name}, ${ma.vorname}`, font: { bold: true, size: 10 } },
      { text: `\n${ma.funktion}`, font: { size: 8, color: { argb: 'FF555555' } } },
    ],
  }
  r1.getCell(1).alignment = { wrapText: true, vertical: 'top' }

  if (ma.typ === 'gfb') {
    // GfB: Monatssummen statt Wochenstunden (Laufsumme aller gespeicherten
    // Wochen des Monats, Anzeige in Stunden)
    const monate = wochenMonate(woche.jahr, woche.kw)
    const werte = gfbMonatsWerte(ma, alleWochen, profile)
    const m1 = monate[0]
    r2.getCell(1).value =
      `${monatName(m1.monatIndex)} davon verplant  ${dauerHHMM(werte[m1.key]?.min || 0)}`
    if (monate[1]) {
      const m2 = monate[1]
      r3.getCell(1).value =
        `${monatName(m2.monatIndex)} davon verplant  ${dauerHHMM(werte[m2.key]?.min || 0)}`
    } else {
      r3.getCell(1).value = `Woche verplant  ${dauerHHMM(wocheMin)}`
    }
  } else {
    r2.getCell(1).value = `Wochenstunden  ${dezimalZuHHMM(ma.vertragsstunden)}`
    r2.getCell(1).font = { bold: true, size: 9 }
    r3.getCell(1).value = `davon verplant  ${dauerHHMM(wocheMin)}`
  }
  r2.getCell(1).font = r2.getCell(1).font || { size: 9 }
  r3.getCell(1).font = { size: 9 }

  // Tageszellen
  TAGE.forEach((tag, idx) => {
    const colZeit = 2 + idx * 2
    const colStd = colZeit + 1
    const z = plan[tag]

    if (z?.art === 'arbeit') {
      const teile = [{ text: `A ${z.von} - ${z.bis}`, font: { size: 9 } }]
      if (z.vertreter) {
        teile.push({ text: '  V', font: { bold: true, size: 10, color: { argb: 'FF1F4EA8' } } })
      }
      r1.getCell(colZeit).value = { richText: teile }
      r1.getCell(colStd).value = dauerHHMM(z.stdMin || 0)
      r2.getCell(colZeit).value = 'P'
      r2.getCell(colZeit).font = { size: 9, color: { argb: 'FF555555' } }
      r2.getCell(colStd).value = dauerHHMM(z.pauseMin || 0)
      r2.getCell(colStd).font = { size: 9, color: { argb: 'FF555555' } }
    } else if (z?.art === 'status') {
      sheet.mergeCells(zeile, colZeit, zeile, colStd)
      const c = r1.getCell(colZeit)
      c.value = z.code
      c.font = { bold: true, size: 11 }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    }
    r1.getCell(colStd).alignment = { horizontal: 'right' }
    r2.getCell(colStd).alignment = { horizontal: 'right' }
  })

  // Rahmen um den Block
  for (let r = zeile; r <= zeile + 2; r++) {
    for (let c = 1; c <= 13; c++) {
      const cell = sheet.getRow(r).getCell(c)
      cell.border = {
        left: { style: 'thin' }, right: { style: 'thin' },
        top: r === zeile ? { style: 'thin' } : undefined,
        bottom: r === zeile + 2 ? { style: 'thin' } : undefined,
      }
    }
  }
  r1.height = 26
  return zeile + 3
}

export async function erstellePepXlsx({ woche, filiale, mitarbeiter, profile }, alleWochen) {
  const wb = new ExcelJS.Workbook()
  wb.creator = profile.vlName || 'EinsatzplanGenerator'
  const sheet = wb.addWorksheet(`KW ${woche.kw}`, {
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9, // A4
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })

  // Spalten: A = Mitarbeiter, dann 6× (Zeit | Std)
  sheet.getColumn(1).width = 30
  for (let i = 0; i < 6; i++) {
    sheet.getColumn(2 + i * 2).width = 14
    sheet.getColumn(3 + i * 2).width = 6.5
  }

  // Titel
  sheet.mergeCells('A1:M1')
  sheet.getCell('A1').value = `Personaleinsatzplanung KW ${woche.kw}/${woche.jahr}`
  sheet.getCell('A1').font = { bold: true, size: 14 }

  sheet.mergeCells('A2:M2')
  sheet.getCell('A2').value =
    `Filiale ${filiale.nummer} – ${filiale.adresse} – ${filiale.bereich}`
  sheet.getCell('A2').font = { size: 11 }

  // Kopfzeile: Wochentag + Datum, darunter Zeit | Std
  const kopf = sheet.getRow(4)
  const sub = sheet.getRow(5)
  sheet.mergeCells(4, 1, 5, 1)
  kopf.getCell(1).value = 'Mitarbeiter'
  kopf.getCell(1).font = { bold: true, size: 10 }
  kopf.getCell(1).alignment = { vertical: 'middle' }

  TAGE.forEach((tag, idx) => {
    const col = 2 + idx * 2
    sheet.mergeCells(4, col, 4, col + 1)
    const d = tagDatum(woche.jahr, woche.kw, idx)
    kopf.getCell(col).value = tagUeberschrift(d)
    kopf.getCell(col).font = { bold: true, size: 10 }
    kopf.getCell(col).alignment = { horizontal: 'center' }
    sub.getCell(col).value = 'Zeit'
    sub.getCell(col + 1).value = 'Std'
    sub.getCell(col).font = { size: 9 }
    sub.getCell(col + 1).font = { size: 9 }
    sub.getCell(col + 1).alignment = { horizontal: 'right' }
  })
  for (let c = 1; c <= 13; c++) {
    kopf.getCell(c).fill = GELB
    sub.getCell(c).fill = GELB
    kopf.getCell(c).border = RAHMEN
    sub.getCell(c).border = RAHMEN
  }

  // MA-Blöcke: erst Stammpersonal, dann "- Aushilfe"
  const stamm = sortiereMitarbeiter(mitarbeiter.filter(m => !istAushilfe(m)))
  const aushilfen = sortiereMitarbeiter(mitarbeiter.filter(m => istAushilfe(m)))

  let zeile = 6
  for (const ma of stamm) {
    zeile = schreibeMaBlock(sheet, zeile, ma, woche, alleWochen, profile)
  }

  if (aushilfen.length > 0) {
    zeile += 1
    sheet.mergeCells(zeile, 1, zeile, 13)
    const c = sheet.getRow(zeile).getCell(1)
    c.value = '- Aushilfe'
    c.font = { bold: true, size: 11 }
    c.fill = GRAU
    zeile += 1
    for (const ma of aushilfen) {
      zeile = schreibeMaBlock(sheet, zeile, ma, woche, alleWochen, profile)
    }
  }

  // Summenzeile: alles vorberechnet, KEINE Formeln
  let gesamtMin = 0
  for (const ma of mitarbeiter) {
    for (const tag of TAGE) {
      const z = woche.plan?.[ma.id]?.[tag]
      if (z?.art === 'arbeit') gesamtMin += z.stdMin || 0
    }
  }
  const budgetMin = Math.round((Number(filiale.wochenstundenBudget) || 0) * 60)
  const rest = budgetMin - gesamtMin
  zeile += 1
  sheet.mergeCells(zeile, 1, zeile, 13)
  const sumZelle = sheet.getRow(zeile).getCell(1)
  sumZelle.value =
    `Gesamt verplant: ${dauerHHMM(gesamtMin)}   ·   Budget: ${dauerHHMM(budgetMin)}   ·   ` +
    (rest >= 0 ? `Rest: ${dauerHHMM(rest)}` : `Überschreitung: ${dauerHHMM(-rest)}`)
  sumZelle.font = { bold: true, size: 10 }

  // Fußzeile
  zeile += 2
  const jetzt = new Date()
  const uhrzeit = String(jetzt.getHours()).padStart(2, '0') + ':' +
    String(jetzt.getMinutes()).padStart(2, '0')
  sheet.mergeCells(zeile, 1, zeile, 13)
  const fuss = sheet.getRow(zeile).getCell(1)
  fuss.value = `Ausdruck durch ${filiale.nummer} vom ${datumKurz(jetzt)} um ${uhrzeit}`
  fuss.font = { size: 8, italic: true, color: { argb: 'FF777777' } }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function pepDateiname(woche, filiale, profile) {
  const vl = (profile.vlName || 'VL').replace(/[^\wäöüÄÖÜß-]/g, '')
  return `Personaleinsatzplanung ${filiale.nummer} KW ${woche.kw}-${woche.jahr} ${vl}.xlsx`
}

// WhatsApp-Share via Web Share API, Fallback Download (wie in den anderen Modulen)
export async function teileOderLadeDatei(blob, dateiname) {
  const file = new File([blob], dateiname, { type: blob.type })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: dateiname })
      return 'geteilt'
    } catch (e) {
      if (e.name === 'AbortError') return 'abgebrochen'
      // sonst Fallback Download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'geladen'
}
