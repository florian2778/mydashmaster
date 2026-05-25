# Security Model (MVP – Device Secret Based)

## Device Access

The security model separates three layers:
1. valid device code (routing only)
2. approved device + explicitly active client selection
3. valid browser session, established or refreshed via device secret

Layout access is granted only when all three layers align.
Technical authentication alone does not make a browser the active layout client.

---

## First Access

- device is unknown or has no valid authentication
- device is created or marked as pending
- no layout is shown

Display:

Device  
{deviceCode}  
Access pending

---

## Device Secret (Client)

- generated browser-side as needed (cryptographically strong random value)
- stored locally in browser storage
- never exposed in URL
- sent to server for authentication

Current browser storage model:
- primary key per device:
  - `mydashmaster-device-secret:{deviceCode}`
- legacy fallback key:
  - `mydashmaster-device-secret`
- legacy values may only be migrated to the scoped key after successful `/auth`
- a failed `/auth` with a legacy value must not silently create a replacement secret for that device

Note:
Using localStorage is an intentional MVP tradeoff. The secret is accessible via client-side JavaScript and therefore not as secure as hardware-bound storage, but acceptable for controlled device/kiosk environments.

---

## Pending State (Registration Phase)

- client sends deviceSecret to server
- server may store hash(deviceSecret) as candidateSecretHash in legacy approval flows
- device remains in status: pending
- no access is granted yet

---

## Approval

Admin must manually activate one authenticated client.

On approval:
- device becomes approved
- authenticated browser clients may become activation candidates
- one selected client becomes the active client
- that selected client defines the active `secretHash`
- only the active client may render the layout

---

## Authentication Flow

1. Device calls /d/{deviceCode}
2. Server checks:
   - device exists
   - device status
3. Browser may attempt /auth for technical authentication
4. If approved:
   - validate cookie if present
   - otherwise request deviceSecret from client
5. Server compares:
   - hash(deviceSecret) vs stored hash
6. Technical authentication succeeds only if:
   - device is approved or in a lifecycle path that still allows technical authentication buildup
   - secret matches the current allowed server-side hash context
7. Layout access is granted only if:
   - device is approved
   - this browser is the active client
   - the browser also has a valid current session cookie

If validation fails:
- no layout is shown
- fallback to the derived lifecycle state
- `auth_mismatch` is a hard stop for automatic recovery

---

## Token / Cookie (Session Layer)

- server issues authentication cookie after successful validation
- cookie represents a temporary validated session
- cookie does NOT replace deviceSecret authentication
- cookie can be revalidated or reissued using deviceSecret
- active devices may renew this cookie during successful authorized status polling

Cookie expectations (MVP):
- Secure (in HTTPS environments)
- SameSite=Lax (or Strict if compatible)
- HttpOnly where possible

---

## Revocation

- admin can revoke device access at any time
- stored secret hash is removed or invalidated
- device status changes to revoked or pending

Effects:
- device immediately loses access
- existing cookies become invalid because validation fails
- re-approval and re-pairing required

---

## Lost Device State

If client loses local storage (e.g. browser reset):
- device cannot authenticate anymore
- must be re-activated by admin

If the browser still has a mismatching old secret:
- it may fall into `auth_mismatch`
- this should not trigger endless automatic retries
- expected recovery is a conscious admin recovery step, e.g. reset activation or reconnect with the originally active browser

---

## Reset Activation

- admin can reset activation without revoking the device
- current active assignment is removed
- current `secretHash` is removed
- device remains approved

Effects:
- no client remains active
- known authenticated and recently seen browser clients may be activated again
- the next activated client defines the new active `secretHash`

---

## No Trust in URL

Device code alone is NOT sufficient for access.

---

## Device Page Exposure

The public non-layout page may show:
- device code
- derived access-state message
- in `pending_activation`, also the current `clientId` for admin-guided activation

It must not expose:
- plain deviceSecret
- secretHash
- candidateSecretHash
