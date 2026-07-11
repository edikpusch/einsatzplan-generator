# Claude Code Prompt – OCR-Mitarbeiterimport (EinsatzplanGenerator)

## Ziel

Mitarbeiter sollen nicht mehr per Hand angelegt werden, sondern durch **Scannen des Personalberichts** – exakt derselbe Ausdruck und derselbe Zwei-Bild-Flow wie im MehrstundenManager (Tesseract.js, offline). Der Code aus `edikpusch/mehrstunden-manager` → `OcrScan.jsx` dient als Basis und wird portiert.

**Scan-Quelle:** Personalbericht, zwei Bilder:
- **Bild 1:** Namensspalte
- **Bild 2:** Funktion + Stunden (separate Spalten im Ausdruck)

Beide werden per Y-Positions-Matching zusammengeführt. **Nicht der PEP** wird gescannt.

**Nicht neu erfinden:** Y-Positions-Matching, Funktions-Aliase und Worker-Konfiguration aus dem MehrstundenManager übernehmen.

---

## Übernehmen aus MehrstundenManager

- Tesseract.js mit `worker.recognize(img)` → `data.words[]` inkl. `bbox` (nicht die reine Text-API).
- **Y-Positions-Matching zwischen Bild 1 und Bild 2** statt Index-Matching: Y-Center pro Zeile, auf Bildhöhe normalisiert (0–1), Match wenn `|Δy| < 0.03`. Mehrzeilige Namen → Durchschnitts-Y. OCR-Rauschzeilen fallen automatisch raus. (Index-Matching bricht, sobald ein Name über zwei Zeilen läuft – bekannter Bug.)
- **Alias-Normalisierung** der OCR-Fehler: `ww→VK`, `sam→MLV`, `fin→ML`, `300→30.0h`. Liste erweiterbar halten.
- Offline: kein API-Call, keine Daten verlassen das Gerät.

---

## Anpassungen für den EinsatzplanGenerator

### Zielschema
Import schreibt nach `ep_mitarbeiter` (immer an die **aktuell gewählte Filiale** gebunden, `filialeId` setzen).

**Aus dem Scan befüllbar:**
- `name`, `vorname` (aus Bild 1)
- `funktion` + `vertragsstunden` (aus Bild 2, per Y-Position zugeordnet)
- `typ`: `"gfb"` bei Aushilfe/Reinigungskraft, sonst `"fest"`
- `azubi`: `true` wenn Funktion „Azubi" enthält

**Funktions-Mapping** (Kürzel im Personalbericht → `ep_mitarbeiter.funktion`):
`ML` → Filialverantwortlicher · `MLV` → 1. stellv. Filialverantwortlicher · `VK` → Verkäufer/in Lebensmittel · Azubi → Azubi Verkäufer/in · Aushilfe → Aushilfe Lebensmittel · Reinigung → Reinigungskraft Lebensmittel.
Mapping-Tabelle **zentral und erweiterbar** halten. Unbekannte Kürzel: MA anlegen, Funktion leer lassen, im Review-Screen rot markieren.

Vertragsstunden robust parsen: `37:30` → `37.5`, `30.0` → `30`, OCR-Artefakt `300` → `30.0`.

**NICHT aus dem Scan ableitbar – niemals überschreiben:**
`stundenlohn`, `verdienstgrenze`, `quali.{schluesseltraeger, baecker, kasse}`, `verfuegbarkeit`, `berufsschultage`

---

### KRITISCH: ID-Stabilität (Merge statt Replace)

`ep_wochen[*].plan` und `ep_wochen[*].abwesenheiten` referenzieren `maId`. Ein Rescan darf **niemals** neue IDs für bestehende MA erzeugen, sonst brechen alle gespeicherten Wochenpläne.

Merge-Algorithmus:
1. Normalisierter Match-Key: `nachname + vorname`, lowercase, Umlaute/Bindestriche/Leerzeichen entfernt.
2. **Bestehender MA (Key trifft):** ID **beibehalten**. Nur `funktion`, `vertragsstunden`, `typ`, `azubi` aktualisieren. Alle nicht-scanbaren Felder (siehe oben) **unverändert lassen**.
3. **Neuer MA:** neu anlegen, neue ID, Defaults setzen (`stundenlohn` = `ep_profile.mindestlohn`, bei GfB `verdienstgrenze` = `ep_profile.minijobGrenze`, alle Quali-Häkchen `false`).
4. **MA im Scan nicht mehr vorhanden:** **nicht automatisch löschen** (könnte OCR-Fehler oder Urlaub sein). Nur als „fehlt im Scan" markieren und zur Löschung vorschlagen.

---

### Review-Screen vor dem Speichern (Pflicht)

Nach dem Scan **nichts sofort speichern**. Erst Vorschau mit drei Gruppen:

- **Neu** (werden angelegt) – editierbar
- **Geändert** (Feld alt → neu, z.B. Vertragsstunden 30:00 → 32:00) – einzeln abwählbar
- **Fehlt im Scan** (bestehende MA ohne Treffer) – Default: behalten; Löschen nur mit Bestätigung

Jede Zeile vor dem Übernehmen manuell korrigierbar (Name, Funktion, Stunden, Typ). Erst „Übernehmen" schreibt nach localStorage.

Sonderfall anzeigen: MA mit `vertragsstunden = null` oder unplausibel (< 1 oder > 48) rot markieren.

---

### Nach dem Import

Hinweis einblenden: neu angelegte MA haben **keine Quali-Häkchen** (Schlüsselträger/Bäcker/Kasse) → direkt Link zur Mitarbeiter-Verwaltung, damit der Prüf-Layer nicht sofort „kein Vertreter/Bäcker möglich" meldet. Bei GfB zusätzlich Hinweis auf Stundenlohn prüfen (Default = Mindestlohn).

---

### UI

- Einstieg: in der Filial-Ansicht Button **„Mitarbeiter scannen"**.
- Geführter Zwei-Schritt-Flow: **Bild 1 (Namen)** aufnehmen → **Bild 2 (Funktion + Stunden)** aufnehmen → Auswertung. Kamera oder Galerie, Fortschrittsanzeige (Tesseract `progress`) je Bild.
- Hinweis im Flow: beide Bilder **im gleichen Ausschnitt/Maßstab** aufnehmen (gleiche Zeilenhöhe), sonst leidet das Y-Matching.
- Rotation um 90° anbieten, falls quer fotografiert wurde – Tesseract erkennt gedrehten Text schlecht.
- Mobile-first, wenige Taps.

---

## Testfälle
- Rescan ohne Änderungen → **keine** neuen IDs, gespeicherte Wochenpläne bleiben intakt.
- MA mit mehrzeiligem Namen (z.B. „Bruns Eike-Pierre-Benjamin") wird als **ein** MA erkannt und korrekt der richtigen Stunden-Zeile zugeordnet.
- Bild 2 hat mehr/weniger OCR-Zeilen als Bild 1 → Y-Matching gleicht das aus, kein Versatz.
- Aushilfe/Reinigungskraft → `typ: "gfb"`, keine Vertragsstunden, `verdienstgrenze` als Default gesetzt.
- Rescan nach manuellem Setzen der Quali-Häkchen → Häkchen bleiben erhalten.
- Vertragsstunden `37:30` → `37.5` (nicht `3730`); OCR-Artefakt `300` → `30.0`.
- Unbekanntes Funktions-Kürzel → MA angelegt, im Review rot markiert, App stürzt nicht ab.
