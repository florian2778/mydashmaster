# Admin UI Specification – MyDashmaster

## Ziel

Diese Spezifikation beschreibt die Zielstruktur und Weiterentwicklung der Admin-Oberfläche von MyDashmaster.

Wichtige Einordnung:
- dieses Dokument ist ein Plan für die Admin-UI
- es beschreibt gewünschte UI-Entwicklungen
- es darf keine stillen Widersprüche zu den bestehenden technischen Spezifikationen erzeugen

Darum enthält dieses Dokument:
- die gewünschte Admin-UI
- die Konflikte, die diese Ziel-UI mit anderen Dokumenten erzeugt
- die notwendigen Folgeänderungen in anderen Spezifikationen

Die Admin-UI soll:
- klar strukturiert
- minimalistisch
- produktionsnah
- technisch verlässlich

sein.

---

## Referenzdokumente

Diese Admin-UI ist gegen folgende Spezifikationen zu prüfen:

- `docs/data-model.md`
- `docs/device-access-lifecycle.md`
- `docs/device-heartbeat.md`
- `docs/device-layout-client-rerender.md`
- `docs/architecture.md`

Priorität bei Konflikten:

1. `data-model.md`
2. `device-access-lifecycle.md`
3. `device-heartbeat.md`
4. `device-layout-client-rerender.md`
5. `architecture.md`
6. `admin_ui_spec.md`

Das bedeutet:
- solange andere Dokumente nicht angepasst sind, darf dieses Dokument keine technisch falschen Annahmen erzwingen

---

## Gesamtstruktur

Die Ziel-Admin-Oberfläche besteht aus folgenden Bereichen:

1. Login
2. Admin Startseite
3. Layouts Übersicht
4. Layout Detail
5. Devices Übersicht
6. Device Detail

---

## 1. Login

### Ziel
- kein öffentlicher Admin-Einstieg mehr
- keine unnötigen Informationen nach außen

### Ziel-UI
- reduzierte Login-Seite
- keine unnötigen Erklärtexte
- nur:
  - Username
  - Passwort
  - Login-Button

### Technische Einordnung
- dies passt grundsätzlich zur aktuellen Architektur
- der bestehende Einstieg ist aktuell `/admin/login`

### Routing-Modell

Für Konsistenz und Bedienbarkeit gilt:

- kanonische Admin-Login-Route:
  - `/admin/login`
- Convenience-Verhalten:
  - `/` leitet auf `/admin/login` weiter

Wichtige Regel:
- `/` ist kein eigener zweiter Login-Flow
- `/` ist nur ein Redirect-Einstieg
- die eigentliche Admin-Login-Seite bleibt `/admin/login`

### Begründung

Dieses Modell:
- erhält die klare Trennung zwischen Admin Backend und Public Device Renderer
- erlaubt trotzdem einen einfachen Einstieg über die Root-URL
- vermeidet zwei semantisch gleichwertige Login-Routen

---

## 2. Admin Startseite

### Ziel
Zentrale Navigation

### Inhalte
- Link zu Devices
- Link zu Layouts

### Zukunft
- später: Kennzahlen / Statusübersicht

### Technische Einordnung
- konfliktfrei
- passt zur bestehenden Architektur

---

## 3. Layouts Übersicht

### Ziel
Kompakte, übersichtliche Darstellung aller Layouts

### Ziel-UI
- Kachel-Layout
- 3–4 Kacheln pro Reihe
- eher kompakte Vorschau

### Inhalt pro Kachel
- Layout-Preview
- `layoutId`
- Status:
  - `valid`
  - `warning`
  - `error`

### Anforderungen
- reduzierte Abstände
- kleinere Vorschau
- einheitliche Darstellung

### Technische Einordnung
- grundsätzlich konsistent mit:
  - `data-model.md`
  - `device-layout-client-rerender.md`
- die Preview muss dieselbe Struktursemantik respektieren:
  - `row`
  - `column`
  - `box`

### Erforderliche technische Präzisierung

Die Layout-Karte sollte zusätzlich definieren:
- ob `boxCount` angezeigt wird
- ob Warnungen und Fehler direkt sichtbar sind oder nur über Badge/Farbcode
- ob ein Klick direkt zum Layout Detail führt

### Empfehlung für Folgeänderungen in anderen Specs

Keine Pflichtänderung notwendig, aber optional sinnvoll:
- `docs/architecture.md`
  - kurzer Hinweis, dass Layout-Validation und Preview Teil des Admin Backends sind

---

## 4. Layout Detail

### Ziel
Bearbeitung und Analyse eines Layouts

### Ziel-UI
- `layoutId`
- Liste der Devices, die dieses Layout nutzen
- JSON-Konfiguration

### Funktionen
- Bearbeiten (Edit-Modus)
- Prüfen (Validierung)
- Speichern

### Anforderungen
- JSON sauber formatiert
- klare Fehlermeldungen
- kein Speichern bei invalidem Zustand

### Konflikt / Lücke

Diese Funktionen sind in den bestehenden technischen Spezifikationen noch nicht ausreichend beschrieben.

Aktuelle Lücken:
- `architecture.md` beschreibt Admin „managing layouts“, aber nicht den Save-/Validate-Workflow
- `data-model.md` beschreibt das Layoutformat, aber nicht den Admin-Schreibprozess

### Erforderliche Folgeänderungen in anderen Specs

Um dieses Ziel konsistent zu machen, sollten folgende Ergänzungen vorgenommen werden:

- `docs/architecture.md`
  - ergänzen:
    - Admin kann Layout-JSON laden
    - Admin kann Layout validieren
    - Persistenz erfolgt in `data/layouts/{layoutId}.json`
- optional `docs/data-model.md`
  - ergänzen:
    - Speichern ist nur bei erfolgreicher Validierung erlaubt

---

## 5. Layout-Änderungen propagieren

### Ziel
Aktive Devices reagieren auf Layout-Änderungen

### Zielverhalten
- nach Änderung:
  - betroffene Devices erkennen Änderung
  - Layout wird neu geladen oder neu gerendert

### Aktuelle Aussage im Plan
- Version / Timestamp pro Layout
- Devices prüfen regelmäßig (Polling)

### Konflikt

Diese Aussage ist aktuell nicht vollständig konsistent mit `docs/device-layout-client-rerender.md`.

Warum:
- die aktuelle Geräteaktualisierung muss sauber zwischen Layout-Wechsel und Lifecycle-Wechsel unterscheiden
- dafür ist ein echtes Modellfeld besser als ein rein impliziter Timestamp
- `layoutVersion` ist jetzt als echtes Layout-Feld vorgesehen

### Erforderliche Folgeänderungen in anderen Specs

Damit dieses Ziel konsistent ist, müssen andere Spezifikationen:

- `docs/data-model.md`
  - `layoutVersion` als echtes Feld definieren
- `docs/device-layout-client-rerender.md`
  - Trigger-Regeln auf Layout-Identität erweitern:
    - `layoutId`
    - `layoutVersion`
- `docs/architecture.md`
  - Update Mechanism auf `layoutId + layoutVersion` erweitern

### Empfehlung

Für Konsistenz jetzt:
- Layout-Änderungen müssen über Layout-Identität erkannt werden:
  - `layoutId`
  - `layoutVersion`
- gleiches `layoutId` mit höherem `layoutVersion` ist ein echter Update-Fall

### Migrationsanforderung

Für bestehende Installationen gilt:
- bestehende Layout-Dateien müssen auf `layoutVersion: 1` migriert werden
- danach ist `layoutVersion` verpflichtend

Die Admin-UI soll Migrationsabweichungen sichtbar machen.

Erforderliche Admin-Darstellung:
- fehlendes `layoutVersion`
  - als Fehler oder „migration required“
- ungültiges `layoutVersion`
  - als Fehler

Wichtige Regel:
- Runtime soll fehlende Versionen nicht stillschweigend erraten
- die Admin-UI soll solche Fälle früh sichtbar machen

---

## 6. Devices Übersicht

### Ziel
Schnelle Übersicht über alle Devices

### Ziel-UI
- Liste oder Kachelansicht

### Inhalte pro Device laut Wunschbild
- `deviceCode`
- Beschreibung (aus JSON)
- Layout
- Status:
  - online (grün)
  - waiting for approval (gelb)
- letzter Kontakt (Datum)

### Konflikte

#### `description (aus JSON)`

`description` ist jetzt als offizielles Device-Feld im Datenmodell vorgesehen.

Bedeutung:
- rein administratives Beschreibungsfeld
- nicht Teil von Authentifizierung oder Routing

Verwendung in der Devices Übersicht:
- optional sichtbar direkt unter `deviceCode`
- fallback, wenn leer:
  - keine Platzhalterpflicht
  - UI darf Feld weglassen oder neutral `-` anzeigen

#### Konflikt B: Status nur als `online / waiting for approval`

Diese Darstellung ist nicht konsistent mit dem Lifecycle-Modell.

Konflikt mit:
- `docs/device-access-lifecycle.md`
- `docs/device-heartbeat.md`

Dort existieren:
- `pending`
- `not_paired`
- `auth_mismatch`
- `authorized`
- `revoked`

Außerdem muss die UI zwischen Device-Ebene und Client-Ebene trennen:

- official device heartbeat
- client activity
- paired active client
- additional unpaired client activity

### Device Overview

Die Devices Übersicht zeigt nur Device-Level-Informationen.

Sie zeigt:
- `Seen` aus `lastStatusAt`
- optional `Online`, abgeleitet aus `lastStatusAt`

Formatierung:
- offizielles `Seen` in der Übersicht = relative Darstellung
- Beispiele:
  - `Seen just now`
  - `Seen 12s ago`
  - `Seen 3m ago`

Sie zeigt nicht:
- zusätzliche Browser-Clients
- additional unpaired client activity

Wichtige Regel:
- `Seen` bezieht sich immer auf den official device heartbeat
- unpaired Clients dürfen `Seen` und `Online` nicht beeinflussen

### Device Detail

Das Device Detail darf Client-Ebene getrennt darstellen.

Es muss trennen zwischen:
- Official Paired Client
- Additional Unpaired Client Activity

Darstellungsempfehlung:
- Official Paired Client:
  - `Seen`
  - `accessState`
  - optional `userAgent`
- Additional Unpaired Client Activity:
  - `lastSeen`
  - `accessState`
  - optional `userAgent`
  - optional Session-Status / letzter erfolgreicher Auth-Zeitpunkt

Formatierung:
- Official Paired Client:
  - `Seen` = relative Darstellung
  - absoluter Zeitstempel darf zusätzlich als Sekundärinformation angezeigt werden
- Additional Unpaired Client Activity:
  - `lastSeenAt` wird standardmäßig als absoluter Zeitstempel angezeigt
- zusätzliche client activity ist diagnostisch, nicht maßgeblich für `Seen` oder `Online`

Wichtige Regel:
- zusätzliche Clients sind diagnostisch
- sie sind keine konkurrierenden Device-Zustände
- `clientId` ist nur Client-Tracking
- gültige Browser-Session und explizites Admin-Pairing sind getrennte Schritte
- ein Client darf erst dann als pairbar gelten, wenn für ihn eine erfolgreiche Authentifizierung / Session-Etablierung dokumentiert wurde
- nach `Reset Pairing` ist bisherige Auth-/Session-Evidence ungültig und muss für jeden Browser neu aufgebaut werden
- `not_paired` bedeutet:
  - aktuell existiert kein paired active client
  - Browser darf sich authentifizieren und Session aufbauen
  - Browser bleibt bis zur expliziten Admin-Pairing-Aktion trotzdem `not_paired`
- `auth_mismatch` bedeutet:
  - ein anderer paired active client existiert bereits
  - Bootstrap/Auth-Recovery ist in diesem Zustand blockiert

Deshalb reicht die reduzierte Anzeige:
- online
- waiting for approval

nicht aus.

### Erforderliche Folgeänderung

Wenn dieses Dokument am einfachen Statusmodell festhalten würde, müsste `device-access-lifecycle.md` vereinfacht werden.
Das wäre fachlich falsch und wird nicht empfohlen.

### Empfehlung

Die Devices Übersicht sollte stattdessen spezifizieren:

- technische Hauptanzeige:
  - `status` aus Device JSON:
    - `pending`
    - `approved`
    - `revoked`
- zusätzliche Pairing-Anzeige:
  - `paired`
  - `not paired`
- Diagnosehinweise:
  - letzter Kontakt
  - letzte IP
  - letzte Ablehnung / Ablehnungsgrund

Wichtige Ergänzung:
- ein späteres `online`-Badge darf nicht aus `lastConnectedAt` abgeleitet werden
- dafür ist ein separates Heartbeat-Feld erforderlich
- siehe `docs/device-heartbeat.md`

### Weitere Lücke

Die Aussage:
- „Live-Updates im Hintergrund, kein Seiten-Reload“

ist für die Admin-UI noch nicht in anderen Specs beschrieben.

Das ist kein direkter Konflikt, aber eine fehlende technische Spezifikation.

### Erforderliche Folgeänderungen in anderen Specs

Wenn Live-Updates für die Admin-Seite verbindlich werden sollen, sollten ergänzt werden:

- `docs/architecture.md`
  - Admin Backend darf periodisches Polling für Admin-Seiten nutzen
- optional neues separates Admin-UX/Runtime-Kapitel
  - Polling-Intervall
  - welche Bereiche automatisch aktualisiert werden
  - ob es Full Page Refresh oder Fragment-Aktualisierung ist

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

### Konflikt / Lücke

„Aktionen (noch zu definieren)“ ist zu offen und steht im Konflikt mit dem bereits klareren Lifecycle-/Admin-Stand.

Denn aus `device-access-lifecycle.md` ergeben sich bereits konkrete Aktionen:
- Approve
- Reset Pairing
- Revoke
- Delete

Aus aktueller Admin-Planung zusätzlich:
- Change layout
- optional Reload

### Erforderliche Folgeänderungen in anderen Specs

Um Device Detail umsetzbar zu machen, sollten die Aktionen in anderen Specs expliziter werden:

- `docs/device-access-lifecycle.md`
  - Admin-Aktionen im Detailbereich explizit nennen:
    - Approve
    - Reset Pairing
    - Revoke
    - Delete
    - optional Reload
- `docs/architecture.md`
  - Admin Backend Responsibilities ergänzen:
    - device detail actions
    - layout reassignment

### Empfehlung

Das Device Detail sollte in diesem Dokument bereits als Zielaktionensatz definieren:
- Layout ändern
- Approve
- Reset Pairing
- Revoke
- Delete
- optional Reload

---

## Offene Punkte

- Definition „online“:
  - aktuell nicht im Modell definiert
  - müsste separat über Zeitfenster beschrieben werden
- Polling-Intervall der Admin-UI:
  - noch nicht spezifiziert
- Fehlerzustände von Devices:
  - müssen aus Lifecycle-Sicht genauer in die Admin-Anzeige übersetzt werden
- Umfang der Aktionen im Device Detail:
  - sollte verbindlich gemacht werden

---

## Konfliktmatrix

### 1. Root-Login auf `/`
- Status:
  - aufgelöst durch Redirect-Modell
- Änderung nötig in:
  - `architecture.md`
  - `mvp.md`
  - optional `production-deployment.md`

### 2. `description` im Device JSON
- Status:
  - kein Konflikt mehr
- Folgeänderung bereits erforderlich:
  - `data-model.md`
  - `architecture.md`

### 3. Device-Status nur als `online / waiting`
- Konflikt mit:
  - `device-access-lifecycle.md`
- Empfehlung:
  - nicht übernehmen
  - stattdessen Status + Pairing + Diagnose

### 4. Version / Timestamp pro Layout als Pflicht
- Status:
  - wird durch `layoutVersion` aufgelöst
- Änderung nötig in:
  - `data-model.md`
  - `device-layout-client-rerender.md`
  - `architecture.md`

### 5. Live-Updates in Admin ohne Reload
- direkter Konflikt:
  - nein
- aber technische Lücke:
  - ja
- Änderung sinnvoll in:
  - `architecture.md`

### 6. Device Detail Aktionen nicht definiert
- Konflikt mit:
  - aktuellem Lifecycle-Stand
- Änderung sinnvoll in:
  - `device-access-lifecycle.md`
  - `architecture.md`

---

## Umsetzungsstrategie

### Phase A
- Login
- Admin Startseite
- Devices Übersicht fachlich korrekt spezifizieren
- Layout Übersicht fachlich korrekt spezifizieren

### Phase B
- Layout Detail
- Bearbeiten / Prüfen / Speichern
- Device Detail
- Aktionssatz finalisieren

### Phase C
- optionale Admin-Live-Updates
- spätere Kennzahlen / Statusübersicht

---

## Änderungen, die andere Spezifikationen brauchen

### Änderungen an `docs/data-model.md`

Nur nötig, wenn diese UI-Ziele verbindlich werden:
- `layoutVersion` als echtes Layout-Feld

Zusätzliche Migrationsregel:
- bestehende Layout-Dateien auf `layoutVersion: 1` setzen

### Änderungen an `docs/device-access-lifecycle.md`

Sinnvoll zur Präzisierung:
- Device Detail Actions explizit nennen
- Admin-UI soll Lifecycle-Zustände vollständig anzeigen können
- Unterscheidung zwischen:
  - technischem Device-Status
  - Pairing-Zustand
  - Diagnosezustand

### Änderungen an `docs/device-layout-client-rerender.md`

Nötig:
- Trigger-Regeln um `layoutVersion` ergänzen
- Mismatch-Verhalten bei fehlendem oder ungültigem `layoutVersion` beschreiben

### Änderungen an `docs/architecture.md`

Sinnvoll / notwendig:
- klarere Admin-Routing-Aussagen, falls Root-Login gewünscht wird
- Device Model um `description` ergänzen
- Admin Layout Detail Workflow beschreiben
- Admin Device Detail Workflow beschreiben
- optionales Admin-Polling für Live-Updates erwähnen
- Update Mechanism um `layoutVersion` ergänzen

---

## Prinzipien

- Einfachheit vor Komplexität
- klare Trennung Admin vs Device
- keine irreführenden Darstellungen
- Datenmodell ist die Referenz
- Lifecycle-Zustände haben Vorrang vor UI-Vereinfachungen
