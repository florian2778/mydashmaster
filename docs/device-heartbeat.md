# Device Heartbeat Specification

## Goal

Define one clear heartbeat model for device presence so the admin UI can later show:
- `online`
- `offline`
- `last seen`

without overloading existing fields such as `lastConnectedAt`.

This document is intentionally narrow:
- no auth redesign
- no websocket/SSE
- no push channel
- polling remains the source of truth

---

## Why A Separate Heartbeat Field Is Needed

Current fields already mean something else:

- `lastConnectedAt`
  - last successful authorized device access
  - not continuous presence
  - should keep its current meaning

- `lastRejectedAt`
  - last rejected access attempt
  - diagnostic only

These fields are useful, but they are not a good basis for an `online` badge.

Reason:
- a device may stay open and poll continuously without performing a new authorized page load
- a device may have loaded successfully long ago, but no longer be active now
- an `online` badge needs a dedicated liveness signal

---

## Proposed Field

Store a dedicated heartbeat timestamp in:

Path:
- `data/device-auth/{deviceCode}.json`

Field:
- `lastStatusAt` (string, optional)

Meaning:
- timestamp of the last accepted device status poll
- represents recent liveness/contact
- used for operational presence display only

Format:
- ISO timestamp string

Example:

```json
{
  "deviceCode": "demo-device",
  "secretHash": "hashed-value",
  "lastConnectedAt": "2026-04-15T12:00:00Z",
  "lastStatusAt": "2026-04-15T12:00:20Z",
  "updatedAt": "2026-04-15T12:00:20Z"
}
```

---

## Update Rule

`lastStatusAt` should be updated only by the normal status polling path.

Recommended source:
- `GET /api/device/{deviceCode}/status`

Update condition:
- request is for a known device
- request belongs to the normal trusted device flow
- device access state is meaningful for polling

Recommended MVP-safe rule:

Update `lastStatusAt` when:
- device exists
- request reaches the status endpoint successfully
- device is in one of these access-relevant states:
  - `authorized`
  - `pending`
  - `not_paired`
  - `auth_mismatch`
  - `revoked`

Do not update it for:
- `unknown`
- malformed requests
- unrelated endpoints

Reason:
- `lastStatusAt` should mean “the device/browser is still polling”
- not “a random request mentioning this device code happened”

---

## Relationship To Authorization

Important rule:
- heartbeat is not a trust factor
- heartbeat is not authentication
- heartbeat is not approval

`lastStatusAt` is operational metadata only.

It must not:
- grant access
- extend sessions
- bypass lifecycle rules
- override `accessState`

---

## Online Badge Semantics

Recommended derived status:

- `online`
  - `lastStatusAt` is recent enough

- `offline`
  - `lastStatusAt` is older than the threshold
  - or missing

Recommended threshold rule:

- `online` if:
  - `now - lastStatusAt <= 3 * DEVICE_POLL_INTERVAL_MS`

With current default polling:
- `DEVICE_POLL_INTERVAL_MS = 10000`
- recommended online threshold:
  - `30s`

Reason:
- allows minor jitter and short network delays
- avoids flapping on one missed poll

---

## UI Meaning

Admin UI may later show:

- `Seen: 12s`
  - derived from `lastStatusAt`

- `Online`
  - only when the threshold rule is satisfied

Recommended display priority:
1. keep `Last access` based on `lastConnectedAt`
2. keep `Seen` based on `lastStatusAt`
3. only then derive a small `Online` badge if desired

This avoids collapsing two different meanings into one label.

---

## Device State Interaction

The heartbeat should remain separate from device lifecycle state.

Examples:

- `pending` + recent `lastStatusAt`
  - device/browser is active
  - but not yet authorized

- `auth_mismatch` + recent `lastStatusAt`
  - device/browser is active
  - but in the wrong browser/session

- `revoked` + recent `lastStatusAt`
  - browser is still polling
  - device is not allowed to access layout

Therefore:
- `online` must never imply `authorized`

---

## Admin UI Recommendation

For MVP:
- add `Seen` first
- postpone a strong `Online` badge until the heartbeat field exists and is stable

If an `Online` badge is later added:
- keep it subtle
- show it only as a derived operational state
- do not mix it into pairing/auth status

---

## Implementation Guidance

Minimal implementation sequence:

1. Add `lastStatusAt` as an optional field in device-auth validation/docs
2. Update the device status endpoint to write it on accepted status polls
3. Expose it in admin device listing data
4. Show `Seen` based on `lastStatusAt`
5. Optionally derive `Online` from the threshold rule

This keeps the rollout incremental and avoids misleading UI.

---

## Non-Goals

This document does not require:
- precise network reachability detection
- websocket presence
- multi-tab/browser session counting
- historical heartbeat logs
- cluster/multi-instance coordination

The goal is only:
- honest, simple liveness information for the existing single-instance polling model
