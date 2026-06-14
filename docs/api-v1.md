# Simple API v1

This document specifies the first planned expansion stage for a simple
Dashmaster API. It is intended as the implementation basis for a small,
file-backed API that can be used by StreamDeck, Companion, and similar
automation tools.

No implementation is included in this document. The scope is deliberately
small and avoids changes to deployment, versioning, or release processes.

## Goals

- Provide a simple HTTP API under `/api/v1`.
- Authenticate requests with a static API key in `X-API-Key`.
- Store API keys as JSON files on disk.
- Return the devices and layouts that a key is allowed to access.
- Prepare a small permission model for later control endpoints.
- Keep authorization data centralized in API-key files.

## Non-Goals

The first expansion stage does not include:

- API-key creation through the GUI
- API-key deletion through the GUI
- Bearer tokens
- OAuth
- user accounts
- role models
- field-level permissions
- write API operations
- webhooks
- rate limiting
- audit logging
- multi-level permission hierarchies

## API Versioning

Version 1 uses this entry point:

```text
/api/v1
```

Rules:

- Smaller additions within v1 must remain backward-compatible.
- Incompatible changes must use a new major API version, for example `/api/v2`.
- Clients may rely on `/api/v1` remaining stable.
- New v1 endpoints may be added as long as they do not break existing v1 clients.

## Endpoint Structure

The API entry point for this version is `/api/v1`.

The proposed first endpoint is:

```http
GET /api/v1/list
```

This is acceptable for the first implementation because it is simple and
describes the response shape directly. A slightly more REST-like alternative
would be:

```http
GET /api/v1/resources
```

Recommended first implementation:

```http
GET /api/v1/list
```

Reasoning:

- It is easy to call from tools like StreamDeck and Companion.
- It avoids introducing multiple endpoints before there is more API surface.
- It can later remain as a compatibility alias if more REST-like endpoints are
  added.

Future API expansion may introduce resource-specific endpoints under `/api/v1`,
such as `/api/v1/devices`, `/api/v1/layouts`, or `/api/v1/devices/{key}/...`.

## Authentication

API requests must include an API key in this header:

```http
X-API-Key: abc123
```

No other authentication mechanism is planned for this stage.

Authentication behavior:

- Missing header: reject the request.
- Unknown key: reject the request.
- Key present in more than one API-key file: reject the request as a
  configuration conflict.
- The key value must never be returned in API responses.
- The key value must not be logged.

Recommended status codes:

| Case | Status | Response code |
| --- | ---: | --- |
| Missing `X-API-Key` | `401 Unauthorized` | `api_key_missing` |
| Unknown API key | `401 Unauthorized` | `api_key_unknown` |
| API key found more than once | `500 Internal Server Error` | `api_key_conflict` |

Recommended error response shape:

```json
{
  "error": {
    "code": "api_key_missing",
    "message": "API key is required."
  }
}
```

## API-Key Storage

API keys are stored as JSON files under:

```text
data/apikeys/
```

This location is recommended because:

- it matches the existing file-backed runtime data model
- it belongs to persisted application state
- it keeps API permissions separate from device and layout records
- it does not require deployment or release-process changes

`data/apikeys/` contains runtime data. API-key files contain secrets and must not be committed to Git. If the path is not ignored yet, a later implementation step must ensure that `data/apikeys/` is excluded through `.gitignore` or equivalent deployment policy.

The directory should be created by the application or deployment process when
needed. Missing directory should be treated as "no API keys configured", not as
a startup failure.

Recommended filename convention:

```text
data/apikeys/streamdeck-office.json
```

Filename rules:

- lowercase letters, digits, and hyphens are recommended
- `.json` suffix is required
- file names should be stable and human-readable
- the file name is not the authorization identity

## API-Key Loading and Cache

API-key files should be loaded and validated when the application starts.

Architecture recommendation:

- The application may cache parsed API-key metadata in memory.
- API requests should not need to read all JSON files from disk on every call.
- A missing `data/apikeys/` directory should produce an empty cache, not a startup failure.
- Invalid files should be detected during loading and reported as configuration errors.
- Invalid API-key files must not prevent Dashmaster from starting.
- Affected API keys are not usable while their files are invalid.
- If the API-key configuration cannot be loaded reliably, the API subsystem should respond with controlled error responses.
- The dashboard itself must remain available even when API-key configuration is broken.
- Later implementations may add explicit reload behavior or a file watcher.
- The concrete reload mechanism is intentionally left open for this stage.

This keeps frequent API calls cheap while preserving the file-backed configuration model.

## API-Key File Format

Example:

```json
{
  "name": "streamdeck-office",
  "key": "abc123",
  "mode": "control",
  "allowedDevices": ["main-dashboard"],
  "allowedLayouts": ["office", "monitoring"]
}
```

Fields:

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Display name and technical identifier for the API key. |
| `key` | yes | Actual API key value expected in `X-API-Key`. |
| `mode` | yes | Permission mode. Supported values: `readonly`, `control`. |
| `allowedDevices` | yes | List of allowed device `key` values. |
| `allowedLayouts` | yes | List of allowed layout `key` values. |

Validation rules:

- `name` must be a non-empty string.
- `key` must be a non-empty string.
- `mode` must be `readonly` or `control`.
- `allowedDevices` must be an array of strings.
- `allowedLayouts` must be an array of strings.
- Duplicate `name` values should be treated as a configuration error.
- Duplicate `key` values must be treated as a configuration error.
- Unknown fields may be ignored for forward compatibility.
- No `active` field is planned for this stage. Activation and deactivation are controlled by file presence: remove, move, or rename the file so it is no longer loaded as `*.json`. This avoids additional state logic. An `active` field can be added later if real API-key management is introduced.

Empty permission lists are restrictive:

```json
{
  "allowedDevices": [],
  "allowedLayouts": []
}
```

This means access to no devices and no layouts. It does not mean access to all resources. Security takes priority over convenience.

Security notes:

- API-key files contain secrets and must not be committed.
- `data/apikeys/` must be treated as runtime data and excluded from Git.
- The containing directory should be part of persistent runtime data.
- File permissions should restrict access to the application user and
  administrators.

## Name vs. Filename

The GUI and API should use the `name` field as the logical identifier. `name` is the identity of an API key. GUI assignments are based on `name`, not on the file name. Changing `name` is an identity change and must be done deliberately.

The filename should be treated as a storage detail because:

- filenames may need technical escaping or renaming
- `name` can remain stable even if the file is moved or renamed
- API responses should not expose filesystem details

Implementation requirement:

- When loading API-key files, validate that every `name` is unique.
- If two files contain the same `name`, treat this as a configuration error.
- GUI changes that update permissions should locate the API-key file by unique
  `name`.
- If the `name` does not map to exactly one file, the GUI must reject the
  operation.

## Permission Modes

### `readonly`

Readonly keys may only use read-only API actions. The `mode` describes the allowed API action, not only the HTTP method.

The first implementation may enforce this primarily through HTTP methods. For the first stage this means:

```http
GET
```

The following methods are forbidden:

```http
POST
PUT
PATCH
DELETE
```

Recommended response:

```http
403 Forbidden
```

Recommended error code:

```text
mode_forbids_method
```

### `control`

Control keys may use read-only API actions and future control actions. Long-term, each endpoint should declare the minimum mode required for that action.

In the first stage the only practical endpoint is still:

```http
GET /api/v1/list
```

The mode exists now so later endpoints can distinguish read-only integrations
from trusted control integrations without changing the API-key file format.

Examples of future action mapping:

```text
GET /api/v1/list
-> readonly

POST /api/v1/layouts/{key}/activate
-> control
```

### Unknown Modes

An unknown `mode` is a configuration error.

Expected behavior:

- log a configuration error without logging the API key value
- reject requests that match the affected API-key file
- return `500 Internal Server Error`

Recommended error code:

```text
api_key_config_invalid
```

## First Endpoint

```http
GET /api/v1/list
```

The endpoint authenticates the request and returns the devices and layouts
allowed for the matching API key.

Only existing devices and layouts should be returned. Missing references should
be logged as configuration warnings and omitted from the response.

### Request

```http
GET /api/v1/list HTTP/1.1
Host: dashmaster.example.org
X-API-Key: abc123
```

### Response

```json
{
  "apiKey": "streamdeck-office",
  "mode": "control",
  "devices": [
    {
      "key": "main-dashboard",
      "name": "Main Dashboard"
    }
  ],
  "layouts": [
    {
      "key": "office",
      "name": "Office"
    },
    {
      "key": "monitoring",
      "name": "Monitoring"
    }
  ]
}
```

Response fields:

| Field | Description |
| --- | --- |
| `apiKey` | API-key `name`, not the secret key value. |
| `mode` | Effective permission mode. |
| `devices` | Existing devices allowed for this key. |
| `devices[].key` | Device `key`. |
| `devices[].name` | Device name if available, otherwise the device `key`. |
| `layouts` | Existing layouts allowed for this key. |
| `layouts[].key` | Layout `key`. |
| `layouts[].name` | Layout name if available, otherwise the layout `key`. |

Ordering:

- Preserve the order from `allowedDevices` and `allowedLayouts` where possible.
- Omit references that no longer exist.

## HTTP Status Codes

| Status | Meaning |
| ---: | --- |
| `200 OK` | Request succeeded. |
| `401 Unauthorized` | API key is missing or unknown. |
| `403 Forbidden` | Authenticated key is not allowed to use the method or endpoint. |
| `404 Not Found` | Endpoint does not exist. |
| `405 Method Not Allowed` | Endpoint exists, but the HTTP method is unsupported. |
| `500 Internal Server Error` | API-key configuration is unreadable, invalid, or ambiguous. |

## Error Cases

### API Key Missing

Condition:

- `X-API-Key` header is missing or empty.

Response:

```http
401 Unauthorized
```

```json
{
  "error": {
    "code": "api_key_missing",
    "message": "API key is required."
  }
}
```

Logging:

- optional low-level debug/info log
- do not log request cookies or other secrets

### API Key Unknown

Condition:

- `X-API-Key` does not match any loaded API-key file.

Response:

```http
401 Unauthorized
```

```json
{
  "error": {
    "code": "api_key_unknown",
    "message": "API key is not valid."
  }
}
```

Logging:

- log the event without logging the key value
- include request IP and user agent if available

### API Key Multiple Times

Condition:

- the same `key` value appears in more than one API-key file.

Response:

```http
500 Internal Server Error
```

```json
{
  "error": {
    "code": "api_key_conflict",
    "message": "API key configuration is ambiguous."
  }
}
```

Logging:

- log affected file names and API-key names if available
- never log the secret key value

### Damaged JSON File

Condition:

- a file under `data/apikeys/*.json` cannot be parsed as JSON.

Response:

```http
500 Internal Server Error
```

```json
{
  "error": {
    "code": "api_key_config_invalid",
    "message": "API key configuration is invalid."
  }
}
```

Startup behavior:

- Dashmaster must continue to start.
- The affected API-key file is ignored or marked unusable.
- If the API subsystem cannot build a reliable key cache, API requests should fail with controlled configuration errors.
- Dashboard pages should remain available.

Logging:

- log file path and parse error message
- do not log file contents

### Invalid JSON Shape

Condition:

- JSON is valid, but required fields are missing or invalid.

Response:

```http
500 Internal Server Error
```

```json
{
  "error": {
    "code": "api_key_config_invalid",
    "message": "API key configuration is invalid."
  }
}
```

Logging:

- log file path and validation errors
- do not log the `key` value

### Unknown Mode

Condition:

- `mode` is not `readonly` or `control`.

Response:

```http
500 Internal Server Error
```

```json
{
  "error": {
    "code": "api_key_config_invalid",
    "message": "API key configuration is invalid."
  }
}
```

Logging:

- log file path, API-key `name`, and invalid mode

### Referenced Device Missing

Condition:

- an entry in `allowedDevices` references a device that does not exist.

Response:

```http
200 OK
```

Behavior:

- omit the missing device from `devices`
- keep processing other devices and layouts

Logging:

- log warning with API-key `name` and missing device `key`

### Referenced Layout Missing

Condition:

- an entry in `allowedLayouts` references a layout that does not exist.

Response:

```http
200 OK
```

Behavior:

- omit the missing layout from `layouts`
- keep processing other devices and layouts

Logging:

- log warning with API-key `name` and missing layout `key`

## Future API Expansion

These endpoints do not exist in the first expansion stage. They are documented only as orientation for later API development.

The current implementation target remains exclusively:

```http
GET /api/v1/list
```

Possible future endpoints:

```http
GET  /api/v1/list
POST /api/v1/layouts/{key}/activate
POST /api/v1/devices/{key}/action
```

Future control endpoints should declare their required mode explicitly. A readonly key should continue to work for existing readonly v1 endpoints.

## Recommended Implementation Shape

Suggested modules for the later implementation:

```text
src/api/api-key-store.js
src/routes/simple-api.js
```

Suggested responsibilities:

| Module | Responsibility |
| --- | --- |
| `api-key-store.js` | Read, validate, and resolve API-key files. |
| `simple-api.js` | Express router for `/api/v1/list` and future simple API endpoints. |

The API-key store should expose functions similar to:

```js
async function listApiKeys();
async function findApiKeyBySecret(secret);
async function addAllowedDevice(apiKeyName, deviceKey);
async function removeAllowedDevice(apiKeyName, deviceKey);
async function addAllowedLayout(apiKeyName, layoutKey);
async function removeAllowedLayout(apiKeyName, layoutKey);
```

These names are illustrative. The important boundary is that all permission
updates write back to API-key files, not to devices or layouts.

## Admin GUI Extension

The existing device and layout admin pages should later show and edit which
API keys have access to the current resource.

Central rule:

- Authorization data remains stored only in API-key files.
- Devices do not store API-key permissions.
- Layouts do not store API-key permissions.

### Device Assignment

On the device detail page, the GUI should support:

1. Show API keys that currently include the current device `key` in `allowedDevices`.
2. Add an API key by `name`.
3. Remove an API key.

Save behavior:

- Add: append the current device `key` to the selected key's
  `allowedDevices` list.
- Remove: remove the current device `key` from the selected key's
  `allowedDevices` list.
- Do not modify the device record.

### Layout Assignment

On the layout detail page, the GUI should support:

1. Show API keys that currently include the current layout `key` in `allowedLayouts`.
2. Add an API key by `name`.
3. Remove an API key.

Save behavior:

- Add: append the current layout `key` to the selected key's
  `allowedLayouts` list.
- Remove: remove the current layout `key` from the selected key's
  `allowedLayouts` list.
- Do not modify the layout record.

### GUI Error Handling

If an entered API-key name has no matching JSON file:

- show a validation error
- do not create a new API-key file implicitly
- do not modify any existing file

If an API-key file is invalid:

- show an admin-visible configuration error
- avoid partial writes
- include the filename or API-key name if known
- do not show the secret `key` value

If an API-key file cannot be read:

- show an admin-visible read error
- keep the current permission state unchanged
- log the filesystem error server-side

If an API-key name is duplicated:

- reject the GUI operation
- show an ambiguity/configuration error
- require manual file correction

## File Update Semantics

API-key files are runtime state. Later implementation should use the same care
as other JSON-backed state:

- read the current file
- validate the full document
- update the requested list
- avoid duplicate entries
- write the file atomically where practical
- preserve stable formatting

Concurrent GUI edits are not part of this first API stage, but write behavior
should avoid obvious partial-file corruption.

## Logging Guidelines

Log useful operational details:

- missing or invalid API-key configuration
- duplicate `name`
- duplicate `key`
- unknown mode
- missing referenced device or layout
- denied write method for readonly mode

Do not log:

- raw API-key values
- cookies
- session tokens
- secret hashes
- full request bodies unless they are known to contain no secrets

## Implementation Tests

The later implementation should include tests for:

- missing `X-API-Key` returns `401`
- unknown API key returns `401`
- valid key returns allowed devices and layouts
- response never includes the secret `key`
- readonly key can call `GET /api/v1/list`
- readonly key is denied for non-GET methods
- duplicate key value returns `500`
- duplicate `name` returns a configuration error
- damaged JSON returns `500`
- invalid JSON shape returns `500`
- unknown `mode` returns `500`
- missing device references are omitted and do not fail the request
- missing layout references are omitted and do not fail the request
- GUI assignment updates API-key files and not device/layout files

## Example API-Key File

```json
{
  "name": "streamdeck-office",
  "key": "abc123",
  "mode": "control",
  "allowedDevices": ["main-dashboard"],
  "allowedLayouts": ["office", "monitoring"]
}
```

## Example API Call

```bash
curl -sSf \
  -H "X-API-Key: abc123" \
  https://dashmaster.example.org/api/v1/list
```

Expected response:

```json
{
  "apiKey": "streamdeck-office",
  "mode": "control",
  "devices": [
    {
      "key": "main-dashboard",
      "name": "Main Dashboard"
    }
  ],
  "layouts": [
    {
      "key": "office",
      "name": "Office"
    },
    {
      "key": "monitoring",
      "name": "Monitoring"
    }
  ]
}
```
