# Device Heartbeat Specification

## Goal

Define one clear heartbeat model for device presence so the admin UI can show:
- `online`
- `offline`
- `last seen`

without overloading `lastConnectedAt` or the device access state.

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

Important rule:
- ONLY the client in `active_authorized` updates `lastStatusAt`

This means:
- `Seen` always refers to `lastStatusAt`
- client activity in `pending_activation`, `reauth_required`, `auth_mismatch`, `blocked_by_other_client`, or `revoked` must never affect `Seen`
- those client states must never affect `Online`

---

## Device-Level Truth vs Client Activity

Two concepts must stay separate:

- official device heartbeat
  - represented by `lastStatusAt`
  - written only by the active authorized client
  - device-level truth

- client activity
  - represented per `clientId` in `clients[]`
  - diagnostic observation only
  - may include the active client and additional non-active clients

Client activity fields:
- `lastSeenAt`
- `lastAuthenticatedAt`
- `userAgent`
- `lastKnownIp`
- `sessionSecretHash`

Important rule:
- `clients[].lastSeenAt` is diagnostic only
- `clients[].lastSeenAt` must not redefine `Seen`

---

## Access States and Heartbeat

The device lifecycle distinguishes these access states:
- `pending_activation`
- `active_authorized`
- `reauth_required`
- `auth_mismatch`
- `blocked_by_other_client`
- `revoked`

Heartbeat rule:
- only `active_authorized` may advance `lastStatusAt`

Consequences:
- `reauth_required` stops the official heartbeat until session recovery succeeds
- an expired session cookie does not change admin approval by itself
- `blocked_by_other_client` remains diagnostic only
- `auth_mismatch` remains diagnostic only

---

## Status Endpoint Responsibility

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
  - the resolved access state is `active_authorized`
  - `authorized === true`

`POST /api/device/{deviceCode}/auth` must:
- validate the secret
- establish or refresh the device session cookie
- update `lastAuthenticatedAt` for the requesting client
- not write `lastStatusAt`
- not activate the client

---

## Session Recovery Interaction

A short-lived session cookie is allowed.

If the browser still has:
- a stable `clientId`
- a matching stored `sessionSecretHash`
- and local `deviceSecret`

but the session cookie is missing or expired, the correct access state is:
- `reauth_required`

In that state:
- the browser should automatically retry `/auth`
- `lastStatusAt` remains stopped until reauth succeeds
- no manual admin re-activation should be required

---

## Online Badge Semantics

Recommended threshold:
- `online` if `now - lastStatusAt <= 3 * DEVICE_POLL_INTERVAL_MS`

With current default polling:
- `DEVICE_POLL_INTERVAL_MS = 10000`
- recommended threshold: `30s`

`online` must never imply pairing or authentication.

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
- Additional Client Activity:
  - `lastSeenAt` absolute by default

Important rule:
- `Seen` always refers to `lastStatusAt`
- non-official client activity remains diagnostic only
