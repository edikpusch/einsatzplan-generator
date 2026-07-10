# Claude Code Prompt – EinsatzplanGenerator (Modul 4)

## Kontext (BR-Projekt)

Baue eine neue mobile-first React-PWA **EinsatzplanGenerator** – Modul 4 einer VL-Tool-Suite (nach MehrstundenManager, InventurManager, FlopMelder). Sie generiert wöchentliche **Personaleinsatzpläne (PEP)** pro Filiale.

**Stack (identisch zu den anderen Modulen):**
- React + Vite
- ExcelJS für xlsx-Export
- **localStorage only, kein Backend** – alle Daten bleiben auf dem Gerät
- Mobile-first (Android-Handy), auch iPad
- Deployment: Vercel, Auto-Deploy on push to `main`
- Repo-Vorschlag: `edikpusch/einsatzplan-generator`

**Harte, projektweite Regel:** Docs@Work auf dem iPad rechnet **keine Excel-Formeln**. **Alle** Zahlen (Std pro Zelle, Wochensummen, Filial-Gesamtsumme, Budget-Abgleich) müssen in JavaScript **vorberechnet** und als Werte/Text geschrieben werden. Niemals Formeln in die xlsx schreiben.

Lege eine `CLAUDE.md` im Repo-Root an mit Projektkontext, Datenmodell, bekannten Eigenheiten und diesem Prompt als Referenz.

---

## Umsetzung in ZWEI Phasen

**Baue jetzt nur Phase A** (das voll nutzbare Tool). Phase B (Auto-Engine) ist unten spezifiziert, damit das Datenmodell zukunftssicher ist – **noch nicht implementieren**, nur berücksichtigen.

---

## Datenmodell (localStorage, Prefix `ep_`)

### `ep_profile`
```
{
  vlName: "Pusch",
  niederlassung: "Ganderkesee",
  mindestlohn: 13.90,        // Default-Stundenlohn, konfigurierbar (ändert sich jährlich)
  minijobGrenze: 603,        // €/Monat, konfigurierbar (2026)
  zuschlaege: [              // gelten für ALLE MA; anteilig für Minuten im jeweiligen Band
    { name: "Spätzuschlag", von: "18:30", bis: "20:00", prozent: 20 },
    { name: "Nachtzuschlag", von: "20:00", bis: "23:59", prozent: 50 }
  ]
}
```
Hinweis Feiertage (Phase-A-Annahme): Filialen an Feiertagen geschlossen → kein gesonderter Sonn-/Feiertagszuschlag modelliert. Falls eine Filiale ausnahmsweise öffnet, manuell behandeln.

### `ep_filialen` – Array
Alles pro Filiale einstellbar:
```
{
  id,
  nummer,                 // z.B. "2497"
  adresse,                // z.B. "Brake-Bahnhofstr. 79 a"
  bereich,                // Default "Lebensmittel"
  oeffnungszeiten: {      // je Wochentag Mo–Sa; So Default geschlossen (toggle)
    mo: { auf: "06:00", zu: "22:15", offen: true },
    di: {...}, mi: {...}, do: {...}, fr: {...}, sa: {...}, so: { offen: false }
  },
  wochenstundenBudget,    // Stunden, die die Filiale verplanen darf (z.B. 380.0)
  baeckerFenster: { bis: "10:00" },   // morgens muss bis hier ein Bäcker geplant sein
  kassenStandard: 1,      // Grundbesetzung Kasse
  kassenPeaks: [          // Zeitfenster mit erhöhter Kassenbesetzung, pro Filiale frei
    { tage: ["mo","di","mi","do","fr","sa"], von: "11:00", bis: "14:00", anzahl: 2 }
  ],
  schichtvorlagen: [      // feste Vorlagen; flexible Zeiten trotzdem erlaubt (Mischmodell)
    { id, name: "Früh", von: "06:00", bis: "14:30", pauseMin: 30 },
    { id, name: "Spät", von: "14:15", bis: "22:15", pauseMin: 30 }
  ]
}
```

### `ep_mitarbeiter` – Array (jeder MA an eine Filiale gebunden)
```
{
  id, filialeId,
  name, vorname,
  funktion,               // "Filialverantwortlicher" | "1. stellv. Filialverantwortlicher" |
                          // "2. stellv. Filialverantwortlicher" | "Verkäufer/in Lebensmittel" |
                          // "Azubi Verkäufer/in" | "Aushilfe Lebensmittel" |
                          // "Reinigungskraft Lebensmittel"
  typ,                    // "fest" | "gfb"
  vertragsstunden,        // nur bei typ=fest, dezimal (37.5) – Anzeige als HH:MM ("37:30")
  stundenlohn,            // € pro Stunde, Default 13.90 (Mindestlohn 2026); individuell überschreibbar
  verdienstgrenze,        // nur bei typ=gfb, €/Monat, Default 603 (Minijob-Grenze 2026); pro MA überschreibbar
  quali: { schluesseltraeger: false, baecker: false, kasse: false },  // frei setzbar pro MA
  verfuegbarkeit: {       // optional; leer = ganztags an offenen Tagen verfügbar
    mo: { verfuegbar: true, von: null, bis: null }, ...
  },
  azubi: false,
  berufsschultage: []     // z.B. ["di","mi"] → an diesen Tagen frei/Schule
}
```

### `ep_wochen` – keyed by `${filialeId}_${jahr}_KW${kw}`
```
{
  filialeId, jahr, kw,
  datumVon, datumBis,     // Mo–Sa, automatisch aus KW berechnet
  abwesenheiten: {        // maId -> tag -> code
    [maId]: { mo: "U", sa: "F", ... }   // U=Urlaub F=Frei K=Krank FT=Feiertag BV=Beschäftigungsverbot Kur SCH=Schule
  },
  sondertage: [           // Zusatzbedarf an bestimmten Tagen
    { tag: "di", typ: "Lieferung", zusatzKoepfe: 1, notiz: "" },
    { tag: "do", typ: "Aktion aufbauen", zusatzKoepfe: 2, notiz: "" }
  ],
  plan: {                 // maId -> tag -> Zelle
    [maId]: {
      mo: { art: "arbeit", von: "06:00", bis: "14:30", pauseMin: 30, stdMin: 480, vertreter: true },
      di: { art: "status", code: "U" }
    }
  }
}
```

`stdMin` = (bis − von) − pauseMin, in Minuten, **vorberechnet in JS**.

`pauseMin` wird **automatisch aus der Brutto-Schichtlänge** abgeleitet: ≤ 6 h → 0, > 6 h → 30, > 9 h → 45. Der Wert in `schichtvorlagen` dient nur als Startwert; die Automatik hat Vorrang. Manueller Override pro Zelle optional.

`vertreter: true` = dieser MA ist in dieser Schicht der **Vertreter / Marktverantwortliche** (Tresor-/Schlüsselverantwortung). Pro Schicht genau einer; muss `quali.schluesseltraeger` haben. Im Export als **V** dargestellt.

---

## Phase A – Features

### 1. Filialen-Verwaltung (CRUD)
Öffnungszeiten je Tag, Wochenstunden-Budget, Bäcker-Fenster, Kassen-Standard + Peak-Fenster, Schichtvorlagen – alles pro Filiale editierbar.

### 2. Mitarbeiter-Verwaltung pro Filiale (CRUD)
Funktion, Typ fest/GfB, Vertragsstunden, **Quali-Häkchen** (Schlüsselträger / Bäcker / Kasse – jeweils Checkbox, jeder MA kann alle haben), Stundenlohn + Verdienstgrenze (bei GfB), Verfügbarkeit, Azubi + Berufsschultage.

**Rollen-Abdeckung:** Der Prüf-Layer zählt für jede Anforderung (Vertreter, Bäcker, Kasse) die anwesenden Köpfe mit dem passenden Häkchen. **Eine Person darf mehrere Rollen gleichzeitig erfüllen** (z.B. Vertreter + Kasse). Nur zeitgleich physisch Unmögliches nicht (Kasse + Backen im selben Moment) – das bleibt im manuellen Editor in der Verantwortung des Nutzers, in Phase B eine Nebenbedingung.

### 3. Wochenauswahl
KW + Jahr eingeben → Datumsbereich Mo–Sa automatisch berechnen und anzeigen.

### 4. Abwesenheiten + Sondertage der Woche erfassen
Schnelle Eingabe: pro MA/Tag Status-Kürzel; Sondertage mit Typ + Zusatzköpfen.

### 5. Manueller Plan-Editor (Kern)
Matrix **MA (Zeilen) × Mo–Sa (Spalten)**. Pro Zelle wählbar:
- **Schichtvorlage antippen** → füllt von/bis/pauseMin automatisch
- **flexible Zeit** manuell eingeben (Mischmodell)
- **Status** (U/F/K/FT/BV/Kur/SCH)

Pro Schicht lässt sich **ein MA als Vertreter (V)** markieren (Marktverantwortliche/r der Schicht). Nur schlüsselträger-qualifizierte MA wählbar.

**Ein Schichtblock pro MA und Tag** (keine geteilten Dienste/Teildienste). Jede Zelle = maximal eine Arbeitszeit oder ein Status.

Live-Berechnung (sofort, in JS):
- Std pro Zelle (Zeit − Pause), Anzeige HH:MM
- „davon verplant" = Wochensumme pro MA
- Filial-Gesamtsumme vs. **Budget** (Rest/Überschreitung sichtbar)
- GfB: zusätzlich **monatliche Std-Summe** (pro Kalendermonat, siehe Export) und **monatlicher Verdienst in €** (siehe GfB-Finanzlogik) mit Warnung nahe/über Grenze

Schnell bedienbar: Tap-Buttons für die Schichtvorlagen, „+"-Feld für flexible Zeiten. Auto-Save (kein Datenverlust auf Mobil).

### 6. Prüf-Layer (Warnungen, farbig markiert + Liste)
Auch ohne Auto-Engine wertvoll. Prüfe und markiere:
- Budget überschritten
- Schicht ohne **Vertreter (V)** / mehr als ein Vertreter / Vertreter nicht schlüsselträger-qualifiziert
- morgens (bis Bäcker-Fenster) **kein Bäcker** eingeplant
- Kassen-Peak **unterbesetzt**
- **Öffnungszeit nicht abgedeckt** (Lücke ohne Personal)
- **Ruhezeit < 11h** (typisch Spät→Früh am Folgetag)
- Tag > 10h; Pausenpflicht (>6h→30min, >9h→45min) nicht eingehalten
- **Azubi/Jugendliche**: > 8h/Tag, Spätarbeit, Berufsschultag verplant
- Sondertag-Zusatzbedarf nicht gedeckt
- **GfB-Monatsverdienst** nähert sich (z.B. ≥ 90 %) oder überschreitet die Grenze (603 €) → Warnung, keine Sperre

Warnungen sind **Hinweise, kein Zwang** – der Nutzer entscheidet.

### 7. xlsx-Export (PEP-Layout)
Siehe Abschnitt unten. Alle Werte vorberechnet.

### 8. Teilen
WhatsApp-Share via **Web Share API** (wie in den anderen Modulen), Fallback Download.

---

## GfB-Finanzlogik & Zuschläge

**Zuschläge (gelten für alle MA, anteilig für die Minuten im Band):**
- 18:30–20:00 → +20 % (Spätzuschlag)
- ab 20:00 bis Ladenschluss → +50 % (Nachtzuschlag)
- Bänder in `ep_profile.zuschlaege` konfigurierbar.

**Verdienstberechnung pro GfB (Modus „voll rechnen" – alle Zuschläge zählen):**
```
schichtVerdienst =
   std_normal * lohn
 + std_1830_2000 * lohn * 1.20
 + std_ab2000 * lohn * 1.50
```
- `lohn` = `mitarbeiter.stundenlohn` (Default 13.90).
- Schichtstunden auf die Zuschlagsbänder aufteilen (Pausen vorher abziehen), alles in JS vorberechnen.

**Monatslogik:**
- Verdienst + Std pro GfB **je Kalendermonat** aufsummieren.
- Eine KW kann zwei Monate berühren (z.B. KW 31 = Juli + August) → jeden Tag dem richtigen Monat zuordnen.
- Laufsumme über **alle gespeicherten Wochen** dieses Monats bilden (nicht nur die aktuelle Woche).
- Vergleich gegen `verdienstgrenze` (Default 603 €). Nur **Monatssicht** (keine Jahresprüfung).
- Ergebnis: **Warnung** bei Annäherung/Überschreitung – **keine Sperre**, der Nutzer entscheidet.

**Wichtig:** Zuschläge betreffen nur die **GfB-Verdienstgrenze**. Das **Filialbudget bleibt in Stunden** und wird von Zuschlägen nicht berührt. Der PEP-Export zeigt bei Aushilfen weiterhin **Stunden** (Juli/August); die €-Rechnung ist rein intern für die Warnung.

---

## Export-Layout (nach echtem Netto-PEP)

- **Querformat.**
- Zeile 1 (Titel): `Personaleinsatzplanung KW {kw}/{jahr}`
- Zeile 2 (Subtitel): `Filiale {nummer} – {adresse} – {bereich}`
- Kopf: Spalte A = **Mitarbeiter**; danach 6 Tagesblöcke **Mo–Sa**, je Block 2 Spalten **Zeit | Std**. Tagesüberschrift = Wochentag + Datum (z.B. „Montag 27. Juli").
- Pro MA-Block:
  - Zeile Name + Funktion
  - `Wochenstunden {vertrag als HH:MM}` und `davon verplant {summe HH:MM}`
  - **Bei GfB/Aushilfe**: statt Wochenstunden → `Juli davon verplant` und `August davon verplant` (monatlich)
- Pro Tageszelle:
  - Arbeit → Zeile `A {von} - {bis}` mit Std `{HH:MM}`, Zeile `P` mit Pause `{HH:MM}`. Ist der MA in dieser Schicht **Vertreter**, zusätzlich Markierung **V** (im Original blau hervorgehoben).
  - Status → Kürzel (U/F/K/FT/BV/Kur/SCH)
- **Aushilfen** in eigenem Abschnitt „- Aushilfe" (eigener Sheet-Bereich/Block, wie im Original Seite 3), inkl. Reinigungskraft.
- Fußzeile: `Ausdruck durch {nummer} vom {datum} um {uhrzeit}`
- Zeiten als **Text** „HH:MM", deutsches Format, deutsches Dezimal-Komma wo Zahlen erscheinen.
- **Keine Formeln.**
- Dateiname (anpassbar): `Personaleinsatzplanung {nummer} KW {kw}-{jahr} Pusch.xlsx`

**Auf iPad beim ersten Export prüfen:** Spaltenbreiten/Merges, HH:MM-Darstellung, Dezimal-Komma, Aushilfe-Block.

---

## Phase B (SPÄTER – nur Datenmodell berücksichtigen, nicht bauen)

Auto-Vorschlags-Engine, greedy + Prüf-Layer, schreibt Vorschläge in denselben `plan` (Phase-A-Editor bleibt zum Nachbearbeiten):

1. Abwesenheiten sperren.
2. Pro Tag benötigte Schicht-Slots aus Öffnungszeiten + Kassen-Peaks + Sondertagen erzeugen.
3. Pflicht-Rollen zuerst besetzen: je Schicht **einen Vertreter (V)** aus den schlüsselträger-qualifizierten MA, morgens **1 Bäcker**, Kassen 1–2.
4. Greedy zuweisen: nur verfügbare MA, Budget-Rest beachten, keine Regel brechen (Ruhezeit, Max h/Tag, Azubi, Pausen). Pausen abziehen.
5. Objective: **Budget = harte Obergrenze**; Festangestellte ≥ Vertragsstunden (Überschreitung erlaubt, wenn Abdeckung es braucht); **GfB als Puffer** für Peaks/Liefertage, dabei **GfB-Monatsverdienst möglichst unter der Grenze** halten (weiche Nebenbedingung – Spätschichten bei GfB sparsam, da Zuschläge die Grenze schneller füllen).
6. Nicht lösbare Konflikte (Unterdeckung, Budget < Summe Vertragsstunden, kein Schlüsselträger/Bäcker frei) **markieren + auflisten**, nie still einen unzulässigen Plan ausgeben.
7. Ergebnis = editierbarer Entwurf.

---

## Prinzipien (projektweit)
- Kein Backend, alles localStorage, alles auf dem Gerät.
- Keine Excel-Formeln – alles in JS vorberechnen.
- Mobile-first, schnell bedienbar, wenige Taps.
- Erst nutzbares Tool (Phase A), dann verfeinern (Phase B).
