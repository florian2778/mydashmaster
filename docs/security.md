# Security Model (MVP – Device Secret Based)

## Device Access

Access requires:
1. valid device code (routing only)
2. approved device
3. valid device secret (validated via cookie or handshake)

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

- generated once on first access (cryptographically strong random value)
- stored locally on the device (e.g. localStorage)
- never exposed in URL
- sent to server for authentication

Note:
Using localStorage is an intentional MVP tradeoff. The secret is accessible via client-side JavaScript and therefore not as secure as hardware-bound storage, but acceptable for controlled device/kiosk environments.

---

## Pending State (Registration Phase)

- client sends deviceSecret to server
- server stores hash(deviceSecret) as candidateSecretHash
- device remains in status: pending
- no access is granted yet

---

## Approval

Admin must manually approve device.

On approval:
- candidateSecretHash becomes the active secret hash
- device status changes to approved
- only this registered secret is valid for future authentication

---

## Authentication Flow

1. Device calls /d/{deviceCode}
2. Server checks:
   - device exists
   - device status
3. If approved:
   - validate cookie if present
   - otherwise request deviceSecret from client
4. Server compares:
   - hash(deviceSecret) vs stored hash
5. Access granted only if:
   - device is approved
   - secret matches

If validation fails:
- no layout is shown
- fallback to pending / not authorized state

---

## Token / Cookie (Session Layer)

- server issues authentication cookie after successful validation
- cookie represents a temporary validated session
- cookie does NOT replace deviceSecret authentication
- cookie can be revalidated or reissued using deviceSecret

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
- must be re-approved and re-paired by admin

---

## No Trust in URL

Device code alone is NOT sufficient for access.

---

## Minimal Exposure

Pending page shows only:
- device code
- access pending

No additional information.
