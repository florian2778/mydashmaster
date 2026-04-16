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
- timestamp of the last accepted official device heartbeat
- represents recent liveness/contact of the paired active client
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

`lastStatusAt` is the timestamp of the official device heartbeat.

The official device heartbeat is the device-level liveness signal used for:
- `Seen`
- `Online`

`lastStatusAt` should be updated only by the normal status polling path.

Recommended source:
- `GET /api/device/{deviceCode}/status`

Update condition:
- request is for a known device
- request reaches the status endpoint successfully
- request belongs to the paired active client

Rule:
- ONLY the paired active client updates `lastStatusAt`

This means:
- `lastStatusAt` is device-level truth
- `lastStatusAt` is not a counter of all browsers polling for the same `deviceCode`

Do not update it for:
- `unknown`
- malformed requests
- unrelated endpoints
- additional unpaired client activity

Reason:
- `lastStatusAt` should mean “the paired active client is still polling”
- not “any browser mentioning this device code is still polling”

---

## Device-Level Heartbeat vs Client Activity

Two concepts must stay separate:

- official device heartbeat
  - represented by `lastStatusAt`
  - updated only by the paired active client
  - drives `Seen` and `Online`

- client activity
  - diagnostic observation of browser activity for one `deviceCode`
  - may include the paired active client and additional unpaired clients
  - must not redefine device-level truth

Client identity rule:
- client activity is tracked per `clientId`
- `clientId` is generated server-side
- `clientId` is stored in a browser cookie
- `clientId` survives reloads
- `clientId` is browser-profile scoped, not tab-scoped
- `clientId` is used only for client activity tracking, not as an auth factor by itself

Authenticated browser session rule:
- a valid device session cookie represents an authenticated browser session
- authenticated browser session is separate from `clientId`
- authenticated browser session is separate from explicit admin pairing
- a browser may have a valid authenticated browser session and still remain `not_paired`
- only a browser that is both:
  - authenticated via valid device session
  - explicitly paired as the paired active client
  may contribute the official device heartbeat

Paired active client rule:
- a paired active client is the single official client context for one `deviceCode`
- exactly one client may have `isPairedClient = true` per `deviceCode`
- when a new client becomes the paired active client, the previous one must lose `isPairedClient = true` immediately

Important rule:
- unpaired clients MUST NOT affect Seen or Online

This includes:
- pending client activity
- auth_mismatch client activity
- revoked client activity
- not_paired client activity
- additional unpaired client activity

Client activity update rule:
- update `clients[].lastSeenAt` only for:
  - known `deviceCode`
  - syntactically valid request
  - real device status endpoint request
  - `accessState` in:
    - `authorized`
    - `pending`
    - `auth_mismatch`
    - `revoked`
    - `not_paired`
- do not update it for:
  - unknown device
  - malformed request
  - unrelated endpoints

Post-reset recovery rule:
- after reset pairing, no client is the paired active client
- `lastStatusAt` must stop advancing until a new paired active client exists
- a fresh browser may authenticate again and establish a valid device session
- that browser still remains `not_paired` until explicit admin pairing
- `auth_mismatch` must only mean:
  - another paired active client already exists

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

Formatting rule:
- timestamps remain stored as full ISO timestamps
- formatting is a UI concern only
- Device Overview shows official `Seen` as relative time
  - e.g. `Seen just now`
  - e.g. `Seen 12s ago`
  - e.g. `Seen 3m ago`
- Device Detail may show the paired active client `Seen` as relative time with an absolute timestamp as secondary information
- additional unpaired client activity should show `lastSeenAt` as an absolute timestamp by default

Important rule:
- `Seen` always refers to the official device heartbeat
- `Seen` must never be derived from additional unpaired client activity

---

## Device State Interaction

The heartbeat should remain separate from device lifecycle state.

Examples:

- paired active client + recent `lastStatusAt`
  - official device heartbeat is current
  - device may be shown as recently seen / online

- additional unpaired client activity in `pending`
  - browser activity exists
  - but `Seen` and `Online` remain unchanged

- additional unpaired client activity in `auth_mismatch`
  - browser activity exists
  - but `Seen` and `Online` remain unchanged

- additional unpaired client activity in `revoked`
  - browser activity exists
  - but `Seen` and `Online` remain unchanged

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
2. Add optional `clients[]` tracking for client activity
3. Update the device status endpoint to:
   - write the official device heartbeat for the paired active client only
   - write client activity for valid status requests only
4. Expose `lastStatusAt` in admin device listing data
5. Show `Seen` based on `lastStatusAt`
6. Optionally derive `Online` from the threshold rule

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
