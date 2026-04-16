
# Device Heartbeat / Client Activity – Spec Update Proposal

## Ziel

Diese Ergänzung präzisiert das Modell rund um Heartbeat, Seen und mehrere Browser/Clients pro `deviceCode`.

Wichtig:
- Ein `deviceCode` steht fachlich für genau ein vorgesehenes Device
- Technisch können dennoch mehrere Browser dieselbe Device-URL aufrufen
- Diese zusätzlichen Browser dürfen den offiziellen Device-Zustand nicht verfälschen

---

## Begriffe

### Official Device Heartbeat
Der offizielle Heartbeat eines Devices.

Bedeutung:
- stammt nur vom aktuell gepairten und autorisierten Client
- ist die Grundlage für:
  - `lastStatusAt`
  - `Seen`
  - später optional `Online`

### Client Activity
Aktivität eines konkreten Browsers / Clients, der mit einem `deviceCode` interagiert.

Bedeutung:
- kann auch von nicht gepairten / nicht autorisierten Clients stammen
- dient Diagnose und Transparenz
- darf nicht den offiziellen Device-Heartbeat überschreiben

### Paired Active Client
Der aktuell gültige, gepairte und autorisierte Client eines Devices.

Nur dieser Client darf:
- den offiziellen Heartbeat aktualisieren
- `lastConnectedAt` aktualisieren
- `lastStatusAt` aktualisieren

### Additional Unpaired Client Activity
Zusätzliche Aktivität weiterer Browser/Clients mit demselben `deviceCode`, die nicht der aktuell gepairte Client sind.

Beispiele:
- zweiter Browser mit gleicher URL
- alte Session
- Testbrowser
- Browser mit `auth_mismatch`
- Browser im `pending`-Zustand

Diese Aktivität darf sichtbar sein, aber nicht als offizieller Device-Zustand zählen.

---

## Fachregel

Ein `deviceCode` hat genau einen offiziellen aktiven Client-Kontext.

Das bedeutet:
- es kann mehrere anfragende Clients geben
- aber nur ein Client ist der offizielle gepairte Client
- nur dieser offizielle Client zählt für Device-Heartbeat und Seen

---

## Datenmodell-Vorschlag

## Device-level Daten

Bleiben am Device / Device-Auth-Kontext:

- `lastConnectedAt`
- `lastStatusAt`
- Pairing-/Auth-Kontext des offiziellen Clients

Semantik:

### `lastConnectedAt`
- letzter erfolgreicher autorisierter Zugriff des offiziellen gepairten Clients
- nicht: letzter beliebiger Aufruf mit passendem `deviceCode`

### `lastStatusAt`
- letzter akzeptierter Status-Poll des offiziellen gepairten Clients
- Grundlage für `Seen`
- später Grundlage für optionales `Online`

---

## Client-level Aktivität

Zusätzliche Client-Aktivität soll separat gehalten werden.

### Empfehlung

Im vorhandenen Device-Auth-Kontext ein Array ergänzen, statt einen komplett neuen globalen Ordner einzuführen.

Pfad:
- `data/device-auth/{deviceCode}.json`

Vorschlag:

```json
{
  "deviceCode": "demo-device",
  "secretHash": "hashed-value",
  "lastConnectedAt": "2026-04-15T12:00:00Z",
  "lastStatusAt": "2026-04-15T12:00:20Z",
  "clients": [
    {
      "clientId": "abc123",
      "lastSeenAt": "2026-04-15T12:00:20Z",
      "accessState": "authorized",
      "isPairedClient": true,
      "userAgent": "Mozilla/5.0 ..."
    },
    {
      "clientId": "xyz789",
      "lastSeenAt": "2026-04-15T12:00:18Z",
      "accessState": "auth_mismatch",
      "isPairedClient": false,
      "userAgent": "Mozilla/5.0 ..."
    }
  ],
  "updatedAt": "2026-04-15T12:00:20Z"
}
```

---

## Felder im Client-Array

### `clientId`
- eindeutige Kennung eines Browser-/Client-Kontexts
- nur intern
- nicht für Nutzerführung gedacht

### `lastSeenAt`
- letzter Status-Poll dieses konkreten Clients
- rein diagnostisch
- nicht identisch mit offiziellem Device-Heartbeat

### `accessState`
- aktueller Lifecycle-/Access-Zustand dieses Clients
- z. B.:
  - `authorized`
  - `pending`
  - `auth_mismatch`
  - `revoked`
  - `not_paired`

### `isPairedClient`
- `true` genau für den einen aktuell offiziellen gepairten Client
- `false` für alle weiteren

### `userAgent`
- optional, aber empfohlen
- dient zur Diagnose / Wiedererkennung
- kann später im Admin angezeigt werden

---

## Update-Logik

## Fall A – offizieller gepairter Client

Wenn der Status-Request vom aktuell gepairten und autorisierten Client kommt:

- Client-Level:
  - `clients[].lastSeenAt` dieses Clients aktualisieren
  - `accessState = authorized`
  - `isPairedClient = true`
- Device-Level:
  - `lastStatusAt` aktualisieren
- optional:
  - `lastConnectedAt` nur bei erfolgreichem initialen autorisierten Device-Load aktualisieren

Dieser Fall erzeugt den offiziellen Device-Heartbeat.

---

## Fall B – Device bekannt, aber Client nicht offiziell gepairt

Wenn ein weiterer Browser dieselbe URL aufruft:

- Client-Level:
  - `clients[].lastSeenAt` aktualisieren
  - `accessState` entsprechend setzen
  - `isPairedClient = false`
- Device-Level:
  - `lastStatusAt` NICHT aktualisieren
  - `lastConnectedAt` NICHT aktualisieren

Damit bleibt der offizielle Device-Zustand sauber.

---

## Fall C – unbekanntes Device oder ungültiger Request

- keine Heartbeat-Aktualisierung
- keine Device-Level-Aktualisierung
- kein diagnostischer Client-Eintrag erforderlich

---

## Seen / Online

## Offizielles Seen

`Seen` im Admin bezieht sich auf:
- den offiziellen gepairten Client
- abgeleitet aus `lastStatusAt`

Empfehlung:
- `Seen: 12s ago`
- oder relativ aktualisierte Anzeige

## Online

`Online` darf später nur bedeuten:
- offizieller gepairter Client hat kürzlich gepollt

Empfohlene Regel:
- `online`, wenn:
  - `now - lastStatusAt <= 3 * DEVICE_POLL_INTERVAL_MS`

Wichtig:
- kein unautorisierter Client darf ein Device auf „online“ halten

---

## Admin-UI Bedeutung

## Device-Übersicht

In der kompakten Übersicht:

anzeigen:
- offizielles `Seen`
- optional später `Online`
- keine Darstellung zusätzlicher unautorisierter Clients nötig

Die Übersicht soll ruhig und fokussiert bleiben.

## Device-Detailseite

Hier darf unterschieden werden zwischen:

### Official Paired Client
- offizieller Zustand
- `Seen`
- `lastConnectedAt`
- User-Agent optional

### Additional Unpaired Client Activity
- weitere aktive oder kürzlich aktive Clients
- Status je Client
- letzter Seen-Zeitpunkt je Client
- optional User-Agent

Das ist der richtige Ort für Diagnose.

---

## Aufbewahrung / Bereinigung

Alte Client-Aktivitäten sollen nicht unbegrenzt sichtbar bleiben.

Empfehlung:
- Clients, die länger als 48 Stunden nicht gesehen wurden, aus dem `clients[]`-Array entfernen
- alternativ nur im UI ausblenden

MVP-Empfehlung:
- Bereinigung beim Schreiben / Polling opportunistisch durchführen

---

## Locate / Identify Funktion

### Empfehlung für MVP
Locate-Funktion nur für den offiziellen gepairten Client vorsehen.

Verhalten:
- Admin löst „Locate“ aus
- offizieller Client zeigt:
  - Popup
  - Overlay
  - kurze Markierung

Nicht für unautorisierte Clients als Pflicht vorsehen.

Begründung:
- klarer Nutzen
- geringes Risiko
- keine unnötige Ansprache fremder Sessions

---

## User-Agent

Empfehlung:
- User-Agent im Client-Level speichern
- für offiziellen Client optional auch prominent im Device-Detail anzeigbar
- nicht als Sicherheitsmerkmal behandeln
- nur Diagnose / Transparenz

---

## Erforderliche Dokumentänderungen

### `docs/device-heartbeat.md`
ergänzen:
- offizieller Heartbeat vs. Client Activity
- nur gepairter Client aktualisiert `lastStatusAt`
- zusätzliche Clients dürfen sichtbar sein, aber nicht offiziell zählen

### `docs/device-access-lifecycle.md`
ergänzen:
- mehrere Clients pro `deviceCode` möglich
- nur ein offizieller gepairter Client zählt
- weitere Clients sind Diagnosezustände, keine Konkurrenz zum offiziellen Zustand

### `docs/data-model.md`
ergänzen:
- optionales `clients[]` im Device-Auth-Kontext
- Felder:
  - `clientId`
  - `lastSeenAt`
  - `accessState`
  - `isPairedClient`
  - `userAgent`

### `docs/admin_ui_spec.md`
ergänzen:
- Device overview zeigt nur offiziellen Zustand
- Device detail darf offizielle und zusätzliche Client-Aktivität trennen

### `docs/architecture.md`
ergänzen:
- Status-Endpunkt aktualisiert sowohl offiziellen Heartbeat als auch Client-Aktivität
- nur offizieller Client beeinflusst Device-Level-Liveness

---

## Kurzfazit

Die richtige Linie ist:

- ein offizieller gepairter Client pro Device
- zusätzliche Client-Aktivitäten werden separat sichtbar
- offizieller Device-Heartbeat bleibt sauber
- `Seen` / `Online` beruhen nur auf dem offiziellen Heartbeat
- Diagnose zu weiteren Clients gehört in die Device-Detailseite, nicht in die Übersicht
