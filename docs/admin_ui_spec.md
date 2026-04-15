
# Admin UI Specification – MyDashmaster

## Ziel

Diese Spezifikation beschreibt die Zielstruktur und Weiterentwicklung der Admin-Oberfläche von MyDashmaster.

Die Admin-UI soll:
- klar strukturiert
- minimalistisch
- produktionsnah
- technisch verlässlich

sein.

---

## Gesamtstruktur

Die Admin-Oberfläche besteht aus folgenden Bereichen:

1. Login
2. Admin Startseite
3. Layouts
4. Layout Detail
5. Devices Übersicht
6. Device Detail

---

## 1. Login

### Ziel
- Kein öffentlicher Einstieg mehr
- Keine Informationen nach außen

### Anforderungen
- `/` zeigt nur Login
- keine Titelzeile
- kein zusätzlicher Text
- nur Eingabefelder + Login-Button

---

## 2. Admin Startseite

### Ziel
Zentrale Navigation

### Inhalte
- Link zu Devices
- Link zu Layouts

### Zukunft
- später: Kennzahlen / Statusübersicht

---

## 3. Layouts Übersicht

### Ziel
Kompakte, übersichtliche Darstellung aller Layouts

### Darstellung
- Kachel-Layout
- 3–4 Kacheln pro Reihe
- eher quadratisch

### Inhalt pro Kachel
- oben: Layout-Preview
- darunter: layoutId
- Status (valid / warning / error)

### Anforderungen
- reduzierte Abstände
- kleinere Vorschau
- einheitliche Darstellung

---

## 4. Layout Detail (Modal oder Seite)

### Ziel
Bearbeitung und Analyse eines Layouts

### Inhalte
- layoutId
- Liste der Devices, die dieses Layout nutzen
- JSON-Konfiguration

### Funktionen
- Bearbeiten (Edit-Modus)
- Prüfen (Validierung)
- Speichern

### Anforderungen
- JSON sauber formatiert (Einrückung)
- klare Fehlermeldungen
- kein Speichern bei invalidem Zustand

---

## 5. Layout-Änderungen propagieren

### Ziel
Aktive Devices reagieren auf Layout-Änderungen

### Verhalten
- nach Änderung:
  - betroffene Devices erkennen Änderung
  - Layout wird neu geladen

### Umsetzungsidee
- Version / Timestamp pro Layout
- Devices prüfen regelmäßig (Polling)

---

## 6. Devices Übersicht

### Ziel
Schnelle Übersicht über alle Devices

### Darstellung
- Liste oder Kachelansicht

### Inhalte pro Device
- deviceCode
- Beschreibung (aus JSON)
- Layout
- Status:
  - online (grün)
  - waiting for approval (gelb)
- letzter Kontakt (Datum)

### Anforderungen
- Live-Updates im Hintergrund
- kein Seiten-Reload

---

## 7. Device Detail

### Ziel
Detailansicht eines einzelnen Devices

### Inhalte
- alle vorhandenen Informationen
- aktueller Status
- zugewiesenes Layout

### Funktionen
- Layout ändern
- Aktionen (noch zu definieren)

### Anforderungen
- laufende Aktualisierung
- Monitoring-Fähigkeit

---

## Offene Punkte

- Definition „online“ (Zeitfenster)
- Polling-Intervall
- Fehlerzustände von Devices
- Umfang der Aktionen im Device Detail

---

## Umsetzungsstrategie

### Phase A
- Login
- Admin Startseite
- Layout Übersicht

### Phase B
- Layout Detail
- Bearbeiten / Prüfen / Speichern
- Layout Reload

### Phase C
- Device Übersicht
- Live-Status
- Device Detail

---

## Prinzipien

- Einfachheit vor Komplexität
- klare Trennung Admin vs Device
- keine irreführenden Darstellungen
- Datenmodell ist die Referenz
