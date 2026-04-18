# Device Heartbeat Specification

## Goal

Define one clear heartbeat model for device presence so the admin UI can later show:
- `online`
- `offline`
- `last seen`

without overloading existing fields such as `lastConnectedAt`.

Polling remains the source of truth.

---

## Official Device Heartbeat

Store the official device heartbeat in:
- `data/device-auth/{deviceCode}.json`

Field:
- `lastStatusAt` (string, optional)

Meaning:
- timestamp of the last accepted official device heartbeat
- device-level liveness signal
- source of official `Seen`
- future source of `Online`

Format:
- full ISO timestamp string

Important rule:
- ONLY the active client updates `lastStatusAt`

This means:
- `Seen` always refers to `lastStatusAt`
- additional pending or blocked client activity must never affect `Seen`
- additional pending or blocked client activity must never affect `Online`

---

## Device-Level Truth vs Client Activity

Two concepts must stay separate:

- official device heartbeat
  - represented by `lastStatusAt`
  - written only by the active client
  - device-level truth

- client activity
  - represented per `clientId` in `clients[]`
  - diagnostic observation only
  - may include the active client and additional pending or blocked client activity

Client activity fields:
- `lastSeenAt`
- `lastAuthenticatedAt`
- `userAgent`
- `lastKnownIp`

Important rule:
- `clients[].lastSeenAt` is diagnostic only
- `clients[].lastSeenAt` must not redefine `Seen`

---

## Authentication and Pairing

Authentication remains required technically, but it is not a visible primary business state.

Three layers must stay separate:

- `clientId`
  - server-generated
  - stored in a browser cookie
  - browser-profile scoped
  - used only for client activity tracking

- authenticated browser session
  - represented by a valid device session cookie plus current-cycle auth evidence
  - technical prerequisite only

- active client
  - represented by `isPairedClient = true`
  - single official client context for one `deviceCode`

Exactly one client may have `isPairedClient = true` per `deviceCode`.

When a new client becomes active:
- the previous active client loses `isPairedClient = true` immediately

---

## Update Rules

`GET /api/device/{deviceCode}/status` is the central endpoint for:
- official device heartbeat
- client activity
- access checks
- reload / layout-change detection

Client activity update rule:
- update `clients[].lastSeenAt` only for:
  - known `deviceCode`
  - syntactically valid request
  - real device status endpoint request
- do not update it for:
  - unknown device
  - malformed request
  - unrelated endpoints

Official heartbeat update rule:
- update `lastStatusAt` only if:
  - the request is on the real status endpoint
  - the device is approved
  - the requesting client is the active client
  - the requesting browser session is technically valid for the current secret cycle

`POST /api/device/{deviceCode}/auth` must:
- validate the secret
- establish or refresh the device session cookie
- update `lastAuthenticatedAt` for the requesting client
- not write `lastStatusAt`
- not pair the client

---

## Reset Activation

Reset activation must:
- remove the current official active assignment
- keep the current technical authentication basis intact

After reset:
- no client is active
- all known clients derive to `pending`
- technically authenticated and recently seen clients may be activatable again immediately
- `lastStatusAt` must stop advancing until a new active client exists

---

## Online Badge Semantics

Recommended threshold:
- `online` if `now - lastStatusAt <= 3 * DEVICE_POLL_INTERVAL_MS`

With current default polling:
- `DEVICE_POLL_INTERVAL_MS = 10000`
- recommended threshold: `30s`

`online` must never imply authentication or pairing.

---

## UI Meaning

Formatting rule:
- timestamps remain stored as full ISO timestamps
- formatting is a UI concern only

Device Overview:
- official `Seen` must be relative
- examples:
  - `Seen just now`
  - `Seen 12s ago`
  - `Seen 3m ago`

Device Detail:
- Official Active Client:
  - `Seen` relative
  - absolute timestamp optional as secondary information
- Additional Pending / Blocked Client Activity:
  - `lastSeenAt` absolute by default

Important rule:
- `Seen` always refers to `lastStatusAt`
- additional pending or blocked client activity remains diagnostic only

## Device State Interaction

The heartbeat should remain separate from device lifecycle state.

Examples:

- active client + recent `lastStatusAt`
  - official device heartbeat is current
  - device may be shown as recently seen / online

- additional pending or blocked client activity in `pending`
  - browser activity exists
  - but `Seen` and `Online` remain unchanged

- additional pending or blocked client activity in `blocked`
  - browser activity exists
  - but `Seen` and `Online` remain unchanged

- additional pending or blocked client activity in `revoked`
  - browser activity exists
  - but `Seen` and `Online` remain unchanged

Therefore:
- `online` must never imply pairing or technical authentication

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
   - write the official device heartbeat for the active client only
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
