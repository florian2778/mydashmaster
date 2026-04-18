# Device Access Lifecycle & Admin UX

## Ziel

Saubere Definition der Zustände, Übergänge und Admin-Interaktionen für Device-Zugriffe.

---

## Device- und Client-Ebene

Es gibt zwei Ebenen:

- Device-Ebene
  - `device.status`: `pending`, `approved`, `revoked`
- Client-Ebene
  - sichtbarer Client-Zustand: `pending`, `active`, `blocked`

Mehrere Browser-Clients pro `deviceCode` sind möglich.

Wichtige Regel:
- genau EIN active client existiert
- weitere Browser sind client-level observations
- diese sind keine konkurrierenden Device-Zustände

---

## Sichtbare Client-Zustände

### pending

- dieser Client ist nicht aktiv
- aktuell existiert für dieses Device noch kein active client
- Bootstrap/Auth ist erlaubt
- ein erfolgreicher Auth-Aufbau macht den Client nur aktivierbar, nicht sofort offiziell

### active

- dieser Client ist der offizielle active client für das Device
- nur dieser Client darf das Layout sehen
- nur dieser Client darf den official device heartbeat fortschreiben

### blocked

- dieser Client ist nicht aktiv
- ein anderer Client ist bereits der active client
- kein Bootstrap/Re-Activation automatisch
- Recovery nur über Admin-Aktion

### revoked

- Device-Zugriff vollständig entzogen
- kein Bootstrap
- kein Zugriff

---

## Wichtige Regeln

- approved allein reicht nicht
- Layoutzugriff erfordert:
  - active client
  - gültige technische Authentifizierung für den aktuellen Secret-Zyklus
- Authentication ist technische Voraussetzung, nicht Hauptzustand
- Aktivierung ist immer eine explizite Admin-Entscheidung
- blocked darf nie automatisch re-aktivieren

---

## Mehrere Browser-Clients pro deviceCode

Mehrere Browser-Clients können gleichzeitig sichtbar sein.

Dabei gilt:
- genau ein Client darf `isPairedClient = true` haben
- wenn ein neuer Client aktiviert wird, verliert der bisherige Client `isPairedClient = true` sofort
- alle nicht aktiven Clients sind entweder:
  - `pending`, wenn noch kein offizieller Client existiert
  - `blocked`, wenn bereits ein offizieller Client existiert

Diese zusätzlichen Browser sind:
- additional pending or blocked client activity

Sie bleiben diagnostisch und dürfen nie:
- `Seen` verändern
- `Online` verändern
- offiziellen Device-Zustand redefinieren

---

## Waiting Page Verhalten

### Device pending

- Device ist noch nicht freigegeben
- Bootstrap aktiv
- Polling aktiv
- Approval allein darf noch keinen Wechsel ins Layout auslösen

### Client pending

- Device ist freigegeben
- aktuell gibt es keinen offiziellen aktiven Client
- Bootstrap/Auth ist erlaubt
- erfolgreicher Auth-Call:
  - setzt oder erneuert die Session
  - aktualisiert `lastAuthenticatedAt`
  - lässt den sichtbaren Zustand trotzdem `pending`
- offizieller Zugriff entsteht erst nach expliziter Admin-Aktivierung

### blocked

- anderer Client ist bereits offiziell aktiv
- kein Auto-Bootstrap
- Reload nur bei Zustandswechsel

---

## Reset Activation

Reset activation muss:
- den aktuellen offiziellen Aktivierungszustand entfernen
- für alle Clients:
  - `isPairedClient = false`

Nach Reset:
- kein Client ist aktiv
- alle bekannten Clients leiten zu `pending` ab
- das Layout verschwindet überall
- bekannte technisch authentifizierte Clients dürfen technisch authentifiziert bleiben
- solche Clients dürfen sofort wieder direkt aktiviert werden, wenn sie noch aktuell aktiv sind

---

## Activation Flow

Aktivierung bleibt explizit.

Empfohlener Ablauf:
1. Browser öffnet `/d/:deviceCode`
2. Browser authentifiziert sich technisch über `/api/device/:deviceCode/auth`
3. Browser bleibt sichtbar `pending`
4. Admin sieht diesen Client in der Detailansicht
5. Admin führt `Activate` aus
6. Der gewählte Client wird `active`
7. Alle anderen Clients werden `blocked`

---

## Admin Panel Anforderungen

Referenz für Heartbeat/Liveness:
- `docs/device-heartbeat.md`

Device Overview zeigt:
- Device-Status
- Aktivierungszustand auf Device-Ebene
- `Seen` aus dem official device heartbeat
- keine additional pending or blocked client activity

Device Detail trennt:
- Official Active Client
- Additional Pending / Blocked Client Activity

---

## Minimale Testfälle

1. Pending Device → technischer Auth-Aufbau → explizite Aktivierung
2. Active Client → Reset activation → alle Clients wieder `pending`
3. Zweiter Browser bei bestehender Aktivierung → `blocked`
4. Mehrere `pending` Clients → Admin wählt explizit einen aus
5. Nur active Client schreibt `lastStatusAt`
