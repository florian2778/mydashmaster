# MVP Scope

## Included

### Layouts
- create/edit layouts
- HTML template
- detect boxes via `data-box`
- configure:
  - URL per box
  - zoom per box

---

### Devices
- create/edit devices
- assign layout
- manage status

---

### Device Access
- route: `/d/{deviceCode}`
- pending state
- manual approval required
- token-based authentication

---

### Rendering
- iFrame per box
- apply zoom per box

---

### Polling
- periodic status check
- reload on change

---

### Admin
- login required
- manage layouts
- manage devices

---

## Not Included

- buttons
- video integrations
- drag & drop editor
- multi-user roles
- websocket updates
- layout sharing links

---

## Constraints

- JSON storage only
- no database
- minimal dependencies
- clear structure

