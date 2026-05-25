# Device Heartbeat / Client Activity – Archived Note

Diese frühere Zwischen-Spezifikation ist nicht mehr normativ.

Maßgeblich sind jetzt:
- `docs/device-heartbeat.md`
- `docs/device-access-lifecycle.md`
- `docs/data-model.md`
- `docs/admin_ui_spec.md`
- `docs/architecture.md`

Der aktuelle sichtbare Device-/Browser-Lifecycle arbeitet mit diesen Access States:
- `pending_activation`
- `active_authorized`
- `reauth_required`
- `auth_mismatch`
- `blocked_by_other_client`
- `revoked`

Authentication bleibt technische Voraussetzung und ist kein primärer sichtbarer Business-Zustand.

Die fachlich weiterhin gültigen Kernaussagen dieser Alt-Notiz sind:
- offizieller Heartbeat bleibt `lastStatusAt`
- nur der offizielle aktive und autorisierte Client darf `lastStatusAt` fortschreiben
- zusätzliche Client-Aktivität ist diagnostisch und darf `Seen`/`Online` nicht verfälschen
- mehrere Browser pro `deviceCode` sind möglich, aber genau ein aktiver Client definiert den offiziellen Device-Zustand

Die detaillierten Regeln werden inzwischen in den oben genannten Hauptdokumenten gepflegt.
