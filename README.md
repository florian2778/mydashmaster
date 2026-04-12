# MyDashmaster

MyDashmaster is a lightweight dashboard system for displaying web-based content on fixed devices (e.g. Raspberry Pi, Waveshare displays).

The system allows:
- managing layouts
- embedding URLs via iFrames
- assigning layouts to devices
- controlling devices centrally
- secure device authorization

---

## 🚀 Core Concepts

### Layout
A layout defines the structure of the screen and contains multiple **boxes**.

Each box:
- has a name (e.g. `box1`, `box2`)
- contains a URL
- has a zoom factor

---

### Device
A device is a display endpoint that loads a layout via a fixed URL:
/d/{deviceCode}

Devices:
- must be approved before use
- are authenticated via a token (cookie)
- automatically reload when layout changes

---

### Security Model
- Device access is not granted by URL alone
- first access → **pending**
- manual approval required
- persistent device token via cookie
- tokens stored as hash on server

---

## 🧱 Tech Stack

- Node.js
- Express
- EJS (server-side rendering)
- JSON-based storage (MVP)
- Cookie-based authentication (devices)
- Polling for updates

---

## 📁 Project Structure

See `/docs/architecture.md`

---

## 📌 MVP Scope

See `/docs/mvp.md`

---

## 🔐 Security

See `/docs/security.md`

---

## 🚧 Status

MVP in development.

---

## 💡 Notes for Codex

- Follow MVP scope strictly
- Use JSON files for persistence
- Keep implementation simple
- Do not introduce unnecessary frameworks
- Prefer clarity over abstraction
