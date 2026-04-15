# Production Deployment Notes

## Intended Topology

MyDashmaster is intended to run:

- as a single Node.js application instance
- behind one direct reverse proxy hop
- with TLS terminated at the reverse proxy

Recommended proxy:

- Traefik

The application assumes:

- external traffic reaches Traefik over HTTPS
- Traefik forwards requests to MyDashmaster over private internal networking
- Express trusts exactly one direct proxy hop

---

## Proxy Trust

The application uses:

- `app.set("trust proxy", 1)`

This is the intended setting for:

- one direct Traefik instance in front of the app

Effects:

- `req.secure` reflects `X-Forwarded-Proto`
- `req.ip` reflects the forwarded client IP from the trusted proxy chain
- secure cookie handling works correctly behind TLS termination

If the deployment topology changes to more than one trusted proxy hop, this setting must be reviewed.

---

## Required Persistent Storage

The following directories must persist across restarts:

- `data/layouts`
- `data/devices`
- `data/device-auth`

Optional / future:

- `data/users`

With the current JSON/file-based architecture, these folders are application state and must be stored on persistent disk or mounted volume.

---

## Single-Instance Recommendation

The current architecture is designed for:

- single-instance deployment

Reason:

- device state is stored in local JSON files
- auth state is stored in local JSON files
- no distributed locking or shared-write coordination exists

Do not run multiple writable app replicas unless shared storage semantics and write-coordination are designed explicitly later.

---

## Environment Variables

Required for admin access:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_SESSION_SECRET`

Recommended for production:

- `MYDASHMASTER_SESSION_SECRET`

Runtime configuration:

- `PORT`
- `DEVICE_POLL_INTERVAL_MS`

Use `.env` or deployment-managed environment variables to provide these values.

---

## Cookie Behavior Behind Traefik

Both cookies:

- `mydashmaster_admin`
- `mydashmaster_device`

use proxy-aware secure-cookie handling through `req.secure`.

When Traefik terminates TLS and forwards `X-Forwarded-Proto: https`, the application will mark these cookies as:

- `Secure`
- `HttpOnly`
- `SameSite=Lax`

This is the intended production behavior.

---

## Header Assumptions

The app relies on the trusted proxy / Express request model for:

- `X-Forwarded-Proto`
- `X-Forwarded-For`
- `X-Forwarded-Host`

In practice:

- `req.secure` should be derived through trusted proxy handling
- `req.ip` should be used as diagnostic client IP

IP values are diagnostic only.
They must not be treated as identity or authorization factors.

---

## Responsibility Split

### In-app responsibilities

- admin login
- device authentication
- lifecycle and access-state handling
- cookie/session validation
- device/layout rendering

### Traefik / edge responsibilities

- HTTPS termination
- HTTP to HTTPS redirect
- security headers
- optional rate limiting for `/admin/login`
- optional IP restrictions for `/admin`

Routing note:
- `/` may redirect to `/admin/login`
- security policies should still target the canonical admin namespace:
  - `/admin`
  - `/admin/login`

Traefik should strengthen the deployment edge, but it does not replace the app’s own authentication and lifecycle logic.

---

## Recommended Production Posture

Use:

- Traefik in front
- HTTPS at the edge
- one MyDashmaster instance
- persistent mounted `data/` storage
- explicit production secrets via environment variables

This keeps the architecture simple while remaining suitable for productive internet deployment.

---

## Docker Compose Deployment

The repository now includes:

- `Dockerfile`
- `compose.yaml`
- `.dockerignore`

Intended usage:

- build directly on the target host
- run one container instance only
- keep `./data` mounted into the container as persistent application state

Compose mount:

- `./data:/app/data`

This preserves:

- layouts
- devices
- device-auth state

The compose setup assumes:

- Traefik already exists
- the external Docker network already exists
- hostname and Traefik network are provided through environment variables

---

## Traefik Deployment Checklist

Expected shared external Docker network:

- `proxy`

MyDashmaster must join that same external Docker network as Traefik or Traefik will not be able to reach the container.

Required env values before first start:

- `MYDASHMASTER_HOST`
- `TRAEFIK_NETWORK`
- `TRAEFIK_CERTRESOLVER`
- `MYDASHMASTER_SESSION_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_SESSION_SECRET`

Recommended validation before `docker compose up -d --build`:

- run `docker compose config`
- confirm the shared network exists: `docker network inspect proxy`
- confirm the rendered Traefik labels use the expected host, network, and certresolver

ACME / TLS expectations:

- the router should use `Host(${MYDASHMASTER_HOST})`, entrypoint `websecure`, TLS enabled, a configured certresolver, and service port `3000`
- after correcting a bad host, network, or certresolver setting, a container and/or router restart may be needed before a fresh ACME attempt succeeds
