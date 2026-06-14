const express = require("express");

const { deriveClientState, getAccessStateMeta, getPairedClient } = require("../device/client-state");
const {
  clearAdminSessionCookie,
  hasAdminAuthConfig,
  setAdminSessionCookie,
  verifyAdminLogin
} = require("../auth/admin-auth");
const {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  resolvePreviewLayout,
  summarizePreviewTree
} = require("../admin/layout-preview");
const {
  activateDeviceClient,
  createAdminDevice,
  createLayout,
  deleteLayout,
  duplicateLayout,
  deleteDevice,
  listDevices,
  listLayouts,
  readDevice,
  readDeviceAuth,
  readLayoutRecord,
  requestDeviceReload,
  resetDevicePairing,
  revokeDeviceAuth,
  updateDevice,
  writeLayout
} = require("../storage/json-store");
const { validateLayout } = require("../storage/validators");
const {
  addAllowedDevice,
  addAllowedLayout,
  ApiKeyStoreError,
  listApiKeys,
  removeAllowedDevice,
  removeAllowedLayout
} = require("../api/api-key-store");
const { logLifecycleEvent } = require("../utils/lifecycle-log");

const router = express.Router();
const DEFAULT_DEVICE_POLL_INTERVAL_MS = 10000;
const ONLINE_HEARTBEAT_MULTIPLIER = 3;

function formatDateOnly(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());

  return `${day}.${month}.${year}`;
}

function formatAbsoluteTimestamp(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toISOString();
}

function formatAbsoluteOverviewTimestamp(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatRelativeSeen(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const diffSeconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1000)
  );

  if (diffSeconds < 5) {
    return "just now";
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function shortenUserAgent(value, maxLength = 72) {
  if (typeof value !== "string" || value.trim() === "") {
    return "-";
  }

  const normalized = value.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function getConfiguredDevicePollIntervalMs() {
  const configuredPollIntervalMs = Number.parseInt(
    process.env.DEVICE_POLL_INTERVAL_MS || "",
    10
  );

  return Number.isInteger(configuredPollIntervalMs) && configuredPollIntervalMs > 0
    ? configuredPollIntervalMs
    : DEFAULT_DEVICE_POLL_INTERVAL_MS;
}

function isOfficialHeartbeatFresh(value, now = Date.now()) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return now - date.getTime() <= getConfiguredDevicePollIntervalMs() * ONLINE_HEARTBEAT_MULTIPLIER;
}

function shortenClientId(value) {
  if (typeof value !== "string" || value === "") {
    return "-";
  }

  return value.length <= 8 ? value : `${value.slice(0, 8)}...`;
}

function getLayoutDisplayName(layout) {
  if (!layout) {
    return "none";
  }

  return layout.description || layout.layoutId || "none";
}

function mapAssignableLayouts(layouts) {
  return getAssignableLayouts(layouts).map((layout) => ({
    ...layout,
    displayName: getLayoutDisplayName(layout)
  }));
}

function getOverviewStateLabel(overviewState) {
  const labels = {
    activatable: "Not activated",
    inactive: "Not activated",
    offline: "Offline",
    online: "Online"
  };

  return labels[overviewState] || "Not activated";
}

function getOverviewSecondaryMeta(device, overviewState) {
  if (overviewState === "online" || overviewState === "offline") {
    return {
      label: "Seen",
      value: formatRelativeSeen(device.lastStatusAt)
    };
  }

  return {
    label: "Last access",
    value: formatAbsoluteOverviewTimestamp(device.lastConnectedAt)
  };
}

async function mapDeviceCard(device, layoutLookup = new Map()) {
  const deviceAuth = await readDeviceAuth(device.deviceCode);
  const effectiveDeviceAuth = {
    clients: device.clients,
    secretHash: deviceAuth?.secretHash
  };
  const activeClient = getPairedClient(effectiveDeviceAuth);
  const hasActiveClient = Boolean(activeClient);
  const activeClientHeartbeatFresh =
    hasActiveClient && isOfficialHeartbeatFresh(device.lastStatusAt);
  const hasActivatableClient = Array.isArray(device.clients)
    ? device.clients.some((client) => {
      if (!client || client.isPairedClient) {
        return false;
      }

      const derivedState = deriveClientState({
        clientId: client.clientId,
        device,
        deviceAuth: effectiveDeviceAuth
      });

      return derivedState.isActivatable;
    })
    : false;

  let overviewState = "inactive";

  if (hasActiveClient) {
    overviewState = activeClientHeartbeatFresh ? "online" : "offline";
  } else if (hasActivatableClient) {
    overviewState = "activatable";
  }

  return {
    ...device,
    canReload: device.status === "approved",
    canResetPairing:
      device.hasSecret ||
      (Array.isArray(device.clients) && device.clients.length > 0),
    canRevoke: device.status === "approved",
    detailUrl: `/admin/devices/${device.deviceCode}`,
    devicePublicUrl: `/d/${device.deviceCode}`,
    displayLastAccessDate: formatDateOnly(device.lastConnectedAt),
    displayLastIp: device.lastKnownIp || "-",
    displayLayoutName: device.layoutId
      ? getLayoutDisplayName(layoutLookup.get(device.layoutId) || { layoutId: device.layoutId })
      : "none",
    displayLastSeen: formatRelativeSeen(device.lastStatusAt),
    displaySecondaryLabel: getOverviewSecondaryMeta(device, overviewState).label,
    displaySecondaryValue: getOverviewSecondaryMeta(device, overviewState).value,
    displayTitle: device.description || device.deviceCode,
    lastConnectedAt: device.lastConnectedAt || null,
    lastStatusAt: device.lastStatusAt || null,
    hasActiveClient,
    hasActivatableClient,
    activeClientHeartbeatFresh,
    overviewState,
    overviewStateLabel: getOverviewStateLabel(overviewState)
  };
}

async function buildDeviceOverviewCards(devices) {
  const layouts = await listLayouts();
  const layoutLookup = new Map(layouts.map((layout) => [layout.layoutId, layout]));
  return Promise.all(devices.map((device) => mapDeviceCard(device, layoutLookup)));
}

function buildDeviceOverviewPayload(devices) {
  return {
    devices: devices.map((device) => ({
      activeClientHeartbeatFresh: device.activeClientHeartbeatFresh,
      deviceCode: device.deviceCode,
      displaySecondaryLabel: device.displaySecondaryLabel,
      displaySecondaryValue: device.displaySecondaryValue,
      lastConnectedAt: device.lastConnectedAt,
      lastStatusAt: device.lastStatusAt,
      hasActiveClient: device.hasActiveClient,
      hasActivatableClient: device.hasActivatableClient,
      overviewState: device.overviewState,
      overviewStateLabel: device.overviewStateLabel
    }))
  };
}

function getAdminRecoveryHint(accessState) {
  const accessStateMeta = getAccessStateMeta(accessState);

  const recoveryHints = {
    pending_activation: "This device is still waiting for activation or an active client assignment.",
    active_authorized: "This client is currently authorized and no recovery action is required.",
    reauth_required: "This browser should recover automatically if its scoped secret is still valid.",
    auth_mismatch: "This browser no longer matches the current device secret cycle. Manual recovery may be required.",
    blocked_by_other_client: "Another browser is currently the official active client for this device.",
    revoked: "This device access has been revoked and requires explicit reactivation.",
    unknown: accessStateMeta.adminHint
  };

  return recoveryHints[accessState] || accessStateMeta.adminHint;
}

function buildClientDisplay(device, deviceAuth, client) {
  // accessState remains the canonical lifecycle model; clientState is only a compact admin/UI grouping.
  const derivedState = deriveClientState({
    clientId: client.clientId,
    device,
    deviceAuth
  });
  const accessStateMeta = getAccessStateMeta(derivedState.accessState);

  return {
    ...client,
    accessState: derivedState.accessState,
    accessStateAdminHint: getAdminRecoveryHint(derivedState.accessState),
    accessStateLabel: accessStateMeta.uiLabel,
    canActivate: derivedState.isActivatable,
    clientState: derivedState.state,
    clientStateLabel:
      derivedState.state === "active"
        ? "Active"
        : derivedState.state === "blocked"
          ? "Blocked"
          : "Pending",
    clientStateTone:
      derivedState.state === "active"
        ? "fresh"
        : derivedState.state === "blocked"
          ? "stale"
          : "aged",
    displayClientId: shortenClientId(client.clientId),
    displayLastAuthenticatedAt: formatAbsoluteTimestamp(client.lastAuthenticatedAt),
    displayLastKnownIp: client.lastKnownIp || "-",
    displayLastSeenAt: formatAbsoluteTimestamp(client.lastSeenAt),
    displayLastSeenRelative: formatRelativeSeen(client.lastSeenAt),
    displayUserAgentShort: shortenUserAgent(client.userAgent),
    isAuthenticated: derivedState.isAuthenticated,
    isRecentlyActive: derivedState.isRecentlyActive
  };
}

async function buildDeviceDetailViewModel(device, deviceAuth, layouts, options = {}) {
  const assignableLayouts = mapAssignableLayouts(layouts);
  const currentLayout =
    device.layoutId
      ? assignableLayouts.find((layout) => layout.layoutId === device.layoutId) || null
      : null;
  const activeClient = getPairedClient(deviceAuth);
  const additionalClients = Array.isArray(device.clients)
    ? device.clients
      .filter((client) => !client.isPairedClient)
      .map((client) => buildClientDisplay(device, deviceAuth, client))
    : [];
  const overviewDevice = await mapDeviceCard(device);
  const hasActivatableClients = additionalClients.some((client) => client.canActivate);
  const officialClientDisplay = activeClient
    ? {
      ...buildClientDisplay(device, deviceAuth, activeClient),
      displaySeen: formatRelativeSeen(device.lastStatusAt),
      lastConnectedAt: device.lastConnectedAt || null,
      displayLastConnectedAt: formatAbsoluteTimestamp(device.lastConnectedAt),
      activeStateLabel: "Active",
      activityStatusLabel: overviewDevice.activeClientHeartbeatFresh
        ? "Online"
        : "Offline",
      activityStatusTone: overviewDevice.activeClientHeartbeatFresh ? "fresh" : "aged",
      displayPrimaryIp: activeClient.lastKnownIp || device.lastKnownIp || "-"
    }
    : null;
  const displayStatusKey =
    device.status === "revoked"
      ? "revoked"
      : overviewDevice.hasActiveClient
        ? (overviewDevice.activeClientHeartbeatFresh ? "active-online" : "active-offline")
        : hasActivatableClients
          ? "waiting"
          : "no-active-client";
  const displayStatusConfig = {
    "active-online": {
      label: "Active · Online",
      tone: "fresh",
      note: "Official client is active and the heartbeat is current."
    },
    "active-offline": {
      label: "Active · Offline",
      tone: "aged",
      note: "Official client exists, but the heartbeat is no longer fresh."
    },
    waiting: {
      label: "Waiting for activation",
      tone: "aged",
      note: "No official client is active yet, but at least one client is ready."
    },
    "no-active-client": {
      label: "No active client",
      tone: "stale",
      note: "No official client is active and no current client is ready."
    },
    revoked: {
      label: "Revoked",
      tone: "stale",
      note: "Access is revoked until the device is approved and activated again."
    }
  };
  const displayStatus = displayStatusConfig[displayStatusKey];
  const primaryIp = officialClientDisplay?.displayPrimaryIp || device.lastKnownIp || "-";
  const groupedClients = {
    readyToActivate: additionalClients.filter((client) => client.canActivate),
    blocked: additionalClients.filter(
      (client) => !client.canActivate && client.clientState === "blocked"
    ),
    otherPending: additionalClients.filter(
      (client) => !client.canActivate && client.clientState !== "blocked"
    )
  };
  groupedClients.otherPending = groupedClients.otherPending.map((client) => ({
    ...client,
    displayHint:
      client.accessState === "auth_mismatch"
        ? getAdminRecoveryHint("auth_mismatch")
        : client.accessState === "revoked"
          ? getAdminRecoveryHint("revoked")
          : !client.isAuthenticated
            ? "Client has not completed authentication yet and is still waiting for activation."
            : !client.isRecentlyActive
              ? "Client authentication is present, but the activity window is no longer recent enough for activation."
              : getAdminRecoveryHint("pending_activation")
  }));
  groupedClients.blocked = groupedClients.blocked.map((client) => ({
    ...client,
    displayHint: getAdminRecoveryHint("blocked_by_other_client")
  }));
  groupedClients.readyToActivate = groupedClients.readyToActivate.map((client) => ({
    ...client,
    displayHint: "Ready to become the official client. No recovery action is required before activation."
  }));
  const publicDeviceUrl = `/d/${device.deviceCode}`;
  const publicDeviceUrlAbsolute = options.publicDeviceUrlAbsolute || publicDeviceUrl;
  const recoveryHints = [];

  if (device.status === "revoked") {
    recoveryHints.push(getAdminRecoveryHint("revoked"));
  } else if (officialClientDisplay?.accessState === "reauth_required") {
    recoveryHints.push(getAdminRecoveryHint("reauth_required"));
  } else if (!activeClient) {
    recoveryHints.push(getAdminRecoveryHint("pending_activation"));
  }

  if (groupedClients.blocked.length > 0) {
    recoveryHints.push(getAdminRecoveryHint("blocked_by_other_client"));
  }

  if (groupedClients.otherPending.some((client) => client.accessState === "auth_mismatch")) {
    recoveryHints.push(getAdminRecoveryHint("auth_mismatch"));
  }

  const uniqueRecoveryHints = Array.from(new Set(recoveryHints));

  return {
    actionErrorMessage: options.actionErrorMessage || null,
    apiAccess: await buildApiAccessViewModel(device.deviceCode, "allowedDevices", {
      errorMessage: options.apiAccessErrorMessage || null,
      successMessage: options.apiAccessSuccessMessage || null
    }),
    assignableLayouts,
    canActivateClients: device.status !== "revoked",
    device: {
      ...overviewDevice,
      currentLayoutDisplayName: currentLayout
        ? currentLayout.displayName
        : device.layoutId || "none",
      displayLastConnectedAt: formatAbsoluteTimestamp(device.lastConnectedAt),
      displayOfficialSeenAbsolute: formatAbsoluteTimestamp(device.lastStatusAt),
      displayActivationState:
        activeClient ? "active client" : "pending",
      displayStatusLabel: displayStatus.label,
      displayStatusTone: displayStatus.tone,
      displayStatusNote: displayStatus.note,
      displayOfficialClientIp: primaryIp,
      displayLayoutTechnicalId: device.layoutId || "-",
      displayTitle: device.description || device.deviceCode,
      publicDeviceUrl,
      publicDeviceUrlAbsolute
    },
    officialActiveClient: officialClientDisplay,
    groupedClients,
    hasActivatableClients,
    otherClientsCount: additionalClients.length,
    recoveryHints: uniqueRecoveryHints,
    technicalDetails: {
      deviceCode: device.deviceCode,
      status: device.status,
      layoutId: device.layoutId || null,
      lastStatusAt: device.lastStatusAt || null,
      lastConnectedAt: device.lastConnectedAt || null,
      lastKnownIp: device.lastKnownIp || null,
      reloadVersion: device.reloadVersion || 0,
      officialClient: officialClientDisplay
        ? {
          clientId: officialClientDisplay.clientId,
          lastAuthenticatedAt: officialClientDisplay.lastAuthenticatedAt || null,
          lastSeenAt: officialClientDisplay.lastSeenAt || null,
          lastKnownIp: officialClientDisplay.lastKnownIp || null,
          userAgent: officialClientDisplay.userAgent || null
        }
        : null,
      additionalClients: additionalClients.map((client) => ({
        clientId: client.clientId,
        clientState: client.clientState,
        lastAuthenticatedAt: client.lastAuthenticatedAt || null,
        lastSeenAt: client.lastSeenAt || null,
        lastKnownIp: client.lastKnownIp || null,
        userAgent: client.userAgent || null
      }))
    },
    pageTitle: device.deviceCode
  };
}

function getAssignableLayouts(layouts) {
  return layouts.filter((layout) => layout.status !== "error");
}

function getLayoutVersionDisplay(layoutRecord) {
  if (layoutRecord.layoutVersionState === "valid") {
    return String(layoutRecord.layoutVersion);
  }

  return "migration required";
}

function getLayoutVersionNote(layoutRecord) {
  if (layoutRecord.layoutVersionState === "missing") {
    return "layoutVersion is missing. This layout needs migration before normal save flow is reliable.";
  }

  if (layoutRecord.layoutVersionState === "invalid") {
    return "layoutVersion is invalid. Use edit mode to correct it before saving.";
  }

  return null;
}

function buildLayoutDraftValidation(jsonContent) {
  let parsedLayout = null;
  let parseError = null;
  let validation = {
    errors: [],
    warnings: []
  };

  try {
    parsedLayout = JSON.parse(jsonContent);
    validation = validateLayout(parsedLayout);
  } catch (error) {
    parseError = error.message;
    validation.errors.push(`Invalid JSON: ${error.message}`);
  }

  const status =
    validation.errors.length > 0
      ? "error"
      : validation.warnings.length > 0
        ? "warning"
        : "valid";

  return {
    jsonContent,
    parsedLayout,
    parseError,
    status,
    validation
  };
}

function buildLayoutUsageDevices(devices, layoutId) {
  return devices
    .filter((device) => device.layoutId === layoutId)
    .map((device) => ({
      description: device.description || null,
      deviceCode: device.deviceCode,
      status: device.status
    }));
}

function getApiAccessErrorMessage(error) {
  if (!(error instanceof ApiKeyStoreError)) {
    return "API access could not be updated.";
  }

  if (error.code === "api_key_name_required") {
    return "Select an API key before saving.";
  }

  if (error.code === "api_key_name_unknown") {
    return "Unknown API key name. Check data/apikeys/*.json.";
  }

  if (error.code === "api_key_config_write_failed") {
    return "API key file could not be written. Check filesystem permissions.";
  }

  if (error.code === "api_key_conflict") {
    return "API key configuration contains duplicate secrets. Fix data/apikeys/*.json before changing access.";
  }

  if (error.code === "api_key_config_invalid") {
    return "API key configuration is invalid. Fix data/apikeys/*.json before changing access.";
  }

  return error.message || "API access could not be updated.";
}

async function buildApiAccessViewModel(resourceKey, listField, options = {}) {
  const result = await listApiKeys();

  if (result.status !== "ok") {
    return {
      assignedApiKeys: [],
      availableApiKeys: [],
      configErrorMessage:
        result.status === "conflict"
          ? "API key configuration contains duplicate secrets. Fix data/apikeys/*.json before changing access."
          : "API key configuration is invalid. Fix data/apikeys/*.json before changing access.",
      errorMessage: options.errorMessage || null,
      successMessage: options.successMessage || null
    };
  }

  const sortedKeys = result.keys
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const assignedApiKeys = sortedKeys.filter((apiKey) =>
    Array.isArray(apiKey[listField]) && apiKey[listField].includes(resourceKey)
  );
  const assignedNames = new Set(assignedApiKeys.map((apiKey) => apiKey.name));

  return {
    assignedApiKeys: assignedApiKeys.map((apiKey) => ({
      mode: apiKey.mode,
      name: apiKey.name
    })),
    availableApiKeys: sortedKeys
      .filter((apiKey) => !assignedNames.has(apiKey.name))
      .map((apiKey) => ({
        mode: apiKey.mode,
        name: apiKey.name
      })),
    configErrorMessage: null,
    errorMessage: options.errorMessage || null,
    successMessage: options.successMessage || null
  };
}

function getReadableLayoutJson(layoutRecord) {
  if (!layoutRecord) {
    return "";
  }

  if (layoutRecord.layout) {
    return JSON.stringify(layoutRecord.layout, null, 2);
  }

  return layoutRecord.rawContent;
}

async function renderLayoutDetailPage(res, layoutId, options = {}) {
  const {
    apiAccessErrorMessage = null,
    apiAccessSuccessMessage = null,
    editMode = false,
    descriptionValue = null,
    draftResult = null,
    httpStatus = 200
  } = options;

  const [layoutRecord, devices] = await Promise.all([
    readLayoutRecord(layoutId),
    listDevices()
  ]);

  if (!layoutRecord) {
    return res.status(404).render("pages/admin-layout-not-found", {
      heading: "Unknown layout",
      layoutId,
      pageTitle: "Unknown layout"
    });
  }

  const validationSource = draftResult?.validation || layoutRecord.validation;
  const status = draftResult?.status || layoutRecord.status;

  return res.status(httpStatus).render("pages/admin-layout-detail", {
    apiAccess: await buildApiAccessViewModel(layoutRecord.layoutId, "allowedLayouts", {
      errorMessage: apiAccessErrorMessage,
      successMessage: apiAccessSuccessMessage
    }),
    draftJsonContent:
      draftResult?.jsonContent || getReadableLayoutJson(layoutRecord),
    descriptionValue:
      typeof descriptionValue === "string"
        ? descriptionValue
        : layoutRecord.layout?.description || "",
    editMode,
    heading: "Layout Detail",
    layout: layoutRecord,
    layoutUsageDevices: buildLayoutUsageDevices(devices, layoutRecord.layoutId),
    pageTitle: layoutRecord.layoutId,
    validationErrors: validationSource.errors,
    validationStatus: status,
    validationWarnings: validationSource.warnings,
    versionDisplay: getLayoutVersionDisplay(layoutRecord),
    versionNote: getLayoutVersionNote(layoutRecord)
  });
}

function renderLoginPage(res, options = {}) {
  const { configError = false, errorMessage = null, usernameValue = "" } = options;

  return res.status(configError ? 503 : 200).render("pages/admin-login", {
    configError,
    errorMessage,
    pageTitle: "Admin Login",
    usernameValue
  });
}

function getApiAccessSuccessMessage(req) {
  return req.query?.apiAccess === "updated" ? "API access updated." : null;
}

function buildAbsoluteDeviceUrl(req, deviceCode) {
  const protocol = req.protocol || "http";
  const host = req.get("host");

  if (!host) {
    return `/d/${deviceCode}`;
  }

  return `${protocol}://${host}/d/${deviceCode}`;
}

async function renderDeviceDetailPage(req, res, deviceCode, options = {}) {
  const {
    actionErrorMessage = null,
    apiAccessErrorMessage = null,
    apiAccessSuccessMessage = null,
    httpStatus = 200
  } = options;
  const [devices, layouts] = await Promise.all([listDevices(), listLayouts()]);
  const device = devices.find((entry) => entry.deviceCode === deviceCode);

  if (!device) {
    return res.status(404).render("pages/device-unknown", {
      pageTitle: "Unknown device",
      deviceCode
    });
  }

  const publicDeviceUrlAbsolute = buildAbsoluteDeviceUrl(req, deviceCode);
  const deviceAuth = (await readDeviceAuth(deviceCode)) || {
    clients: device.clients
  };

  return res.status(httpStatus).render(
    "pages/admin-device-detail",
    {
      ...(await buildDeviceDetailViewModel(device, deviceAuth, layouts, {
        actionErrorMessage,
        apiAccessErrorMessage,
        apiAccessSuccessMessage,
        publicDeviceUrlAbsolute
      })),
      detailPollIntervalMs: 10000
    }
  );
}

function redirectAfterDeviceAction(req, res, deviceCode) {
  if (req.body?.returnTo === "detail") {
    return res.redirect(`/admin/devices/${deviceCode}`);
  }

  return res.redirect("/admin/devices");
}

router.get("/login", (req, res) => {
  if (res.locals.isAdminAuthenticated) {
    return res.redirect("/admin");
  }

  return renderLoginPage(res, {
    configError: !hasAdminAuthConfig()
  });
});

router.post("/login", (req, res) => {
  const usernameValue =
    typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  const result = verifyAdminLogin(usernameValue, password);

  if (!result.ok) {
    return renderLoginPage(res, {
      configError: result.reason === "missing_config",
      errorMessage:
        result.reason === "missing_config"
          ? null
          : "Invalid username or password.",
      usernameValue
    });
  }

  setAdminSessionCookie(req, res, result.username, process.env.ADMIN_SESSION_SECRET);

  return res.redirect("/admin");
});

router.post("/logout", (req, res) => {
  clearAdminSessionCookie(req, res);
  res.redirect("/admin/login");
});

router.get("/", async (req, res, next) => {
  try {
    const devices = await listDevices();
    const layouts = await listLayouts();

    res.render("pages/admin", {
      pageTitle: "Admin",
      deviceCount: devices.length,
      heading: "Admin",
      layoutCount: layouts.length
    });
  } catch (error) {
    next(error);
  }
});

router.get("/layouts", async (req, res, next) => {
  try {
    const layouts = (await listLayouts()).map((layout) => ({
      ...layout,
      previewTree: resolvePreviewLayout(
        layout.structure,
        new Set((layout.boxes || []).map((box) => box.name)),
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT
      )
    })).map((layout) => ({
      ...layout,
      previewSummary: summarizePreviewTree(layout.previewTree)
    }));

    res.render("pages/admin-layouts", {
      pageTitle: "Layouts",
      heading: "Layouts",
      layouts
    });
  } catch (error) {
    next(error);
  }
});

router.post("/layouts/create", async (req, res, next) => {
  try {
    const layout = await createLayout();
    return res.redirect(
      `/admin/layouts/${encodeURIComponent(layout.layoutId)}?mode=edit`
    );
  } catch (error) {
    next(error);
  }
});

router.get("/layouts/:layoutId", async (req, res, next) => {
  try {
    const { layoutId } = req.params;
    const editMode = req.query.mode === "edit";

    await renderLayoutDetailPage(res, layoutId, {
      apiAccessSuccessMessage: getApiAccessSuccessMessage(req),
      editMode
    });
  } catch (error) {
    next(error);
  }
});

router.post("/layouts/:layoutId/api-access", async (req, res, next) => {
  try {
    const { layoutId } = req.params;
    const layoutRecord = await readLayoutRecord(layoutId);

    if (!layoutRecord) {
      return res.status(404).render("pages/admin-layout-not-found", {
        heading: "Unknown layout",
        layoutId,
        pageTitle: "Unknown layout"
      });
    }

    const apiKeyName =
      typeof req.body?.apiKeyName === "string" ? req.body.apiKeyName.trim() : "";
    const intent = typeof req.body?.intent === "string" ? req.body.intent : "";

    try {
      if (intent === "add") {
        await addAllowedLayout(apiKeyName, layoutId);
      } else if (intent === "remove") {
        await removeAllowedLayout(apiKeyName, layoutId);
      } else {
        throw new ApiKeyStoreError(
          "api_key_action_invalid",
          "Select a valid API access action."
        );
      }
    } catch (error) {
      if (error instanceof ApiKeyStoreError) {
        return renderLayoutDetailPage(res, layoutId, {
          apiAccessErrorMessage: getApiAccessErrorMessage(error),
          httpStatus: 400
        });
      }

      throw error;
    }

    return res.redirect(
      303,
      `/admin/layouts/${encodeURIComponent(layoutId)}?apiAccess=updated`
    );
  } catch (error) {
    next(error);
  }
});

router.post("/layouts/:layoutId", async (req, res, next) => {
  try {
    const { layoutId } = req.params;
    const intent =
      typeof req.body?.intent === "string" ? req.body.intent : "validate";
    const descriptionValue =
      typeof req.body?.description === "string" ? req.body.description.trim() : "";
    const jsonContent =
      typeof req.body?.jsonContent === "string" ? req.body.jsonContent : "";
    const layoutRecord = await readLayoutRecord(layoutId);

    if (!layoutRecord) {
      return res.status(404).render("pages/admin-layout-not-found", {
        heading: "Unknown layout",
        layoutId,
        pageTitle: "Unknown layout"
      });
    }

    if (intent === "cancel") {
      return res.redirect(`/admin/layouts/${encodeURIComponent(layoutId)}`);
    }

    const draftResult = buildLayoutDraftValidation(jsonContent);

    if (intent === "save") {
      if (draftResult.validation.errors.length > 0 || !draftResult.parsedLayout) {
        return renderLayoutDetailPage(res, layoutId, {
          descriptionValue,
          draftResult,
          editMode: true,
          httpStatus: 400
        });
      }

      const nextLayoutVersion = Number.isInteger(layoutRecord.layoutVersion)
        ? layoutRecord.layoutVersion + 1
        : draftResult.parsedLayout.layoutVersion;

      await writeLayout(layoutId, {
        ...draftResult.parsedLayout,
        description: descriptionValue || undefined,
        layoutId,
        layoutVersion: nextLayoutVersion
      });

      return res.redirect(`/admin/layouts/${encodeURIComponent(layoutId)}`);
    }

    return renderLayoutDetailPage(res, layoutId, {
      descriptionValue,
      draftResult,
      editMode: true
    });
  } catch (error) {
    next(error);
  }
});

router.post("/layouts/:layoutId/duplicate", async (req, res, next) => {
  try {
    const { layoutId } = req.params;
    const duplicatedLayout = await duplicateLayout(layoutId);

    if (!duplicatedLayout) {
      return res.status(404).render("pages/admin-layout-not-found", {
        heading: "Unknown layout",
        layoutId,
        pageTitle: "Unknown layout"
      });
    }

    return res.redirect(`/admin/layouts/${encodeURIComponent(duplicatedLayout.layoutId)}?mode=edit`);
  } catch (error) {
    next(error);
  }
});

router.post("/layouts/:layoutId/delete", async (req, res, next) => {
  try {
    const { layoutId } = req.params;
    const deleted = await deleteLayout(layoutId);

    if (!deleted) {
      return res.status(404).render("pages/admin-layout-not-found", {
        heading: "Unknown layout",
        layoutId,
        pageTitle: "Unknown layout"
      });
    }

    return res.redirect("/admin/layouts");
  } catch (error) {
    next(error);
  }
});

router.get("/devices", async (req, res, next) => {
  try {
    const [devices, layouts] = await Promise.all([listDevices(), listLayouts()]);
    const assignableLayouts = mapAssignableLayouts(layouts);
    const overviewDevices = await buildDeviceOverviewCards(devices);

    res.render("pages/admin-devices", {
      devices: overviewDevices,
      heading: "Devices",
      layouts: assignableLayouts,
      pageTitle: "Devices",
      overviewPollIntervalMs: 4000
    });
  } catch (error) {
    next(error);
  }
});

router.get("/devices/overview-data", async (req, res, next) => {
  try {
    const devices = await listDevices();
    const overviewDevices = await buildDeviceOverviewCards(devices);

    res.json(buildDeviceOverviewPayload(overviewDevices));
  } catch (error) {
    next(error);
  }
});

router.get("/devices/:deviceCode", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await renderDeviceDetailPage(req, res, deviceCode, {
      apiAccessSuccessMessage: getApiAccessSuccessMessage(req)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/api-access", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const device = await readDevice(deviceCode);

    if (!device) {
      return res.status(404).render("pages/device-unknown", {
        pageTitle: "Unknown device",
        deviceCode
      });
    }

    const apiKeyName =
      typeof req.body?.apiKeyName === "string" ? req.body.apiKeyName.trim() : "";
    const intent = typeof req.body?.intent === "string" ? req.body.intent : "";

    try {
      if (intent === "add") {
        await addAllowedDevice(apiKeyName, deviceCode);
      } else if (intent === "remove") {
        await removeAllowedDevice(apiKeyName, deviceCode);
      } else {
        throw new ApiKeyStoreError(
          "api_key_action_invalid",
          "Select a valid API access action."
        );
      }
    } catch (error) {
      if (error instanceof ApiKeyStoreError) {
        return renderDeviceDetailPage(req, res, deviceCode, {
          apiAccessErrorMessage: getApiAccessErrorMessage(error),
          httpStatus: 400
        });
      }

      throw error;
    }

    return res.redirect(
      303,
      `/admin/devices/${encodeURIComponent(deviceCode)}?apiAccess=updated`
    );
  } catch (error) {
    next(error);
  }
});

router.post("/devices", async (req, res, next) => {
  try {
    const layoutId =
      typeof req.body?.layoutId === "string" && req.body.layoutId.trim() !== ""
        ? req.body.layoutId.trim()
        : undefined;

    if (layoutId) {
      const layouts = await listLayouts();
      const assignableLayouts = getAssignableLayouts(layouts);
      const hasLayout = assignableLayouts.some(
        (layout) => layout.layoutId === layoutId
      );

      if (!hasLayout) {
        const existingDevices = await buildDeviceOverviewCards(await listDevices());

        return res.status(400).render("pages/admin-devices", {
          devices: existingDevices,
          heading: "Devices",
          layouts: mapAssignableLayouts(assignableLayouts),
          pageTitle: "Devices",
          overviewPollIntervalMs: 4000
        });
      }
    }

    const createdDevice = await createAdminDevice({ layoutId });

    res.redirect(`/admin/devices/${createdDevice.deviceCode}`);
  } catch (error) {
    next(error);
  }
});

router.get("/devices/:deviceCode/layout", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const [device, layouts] = await Promise.all([
      readDevice(deviceCode),
      listLayouts()
    ]);

    if (!device) {
      return res.status(404).render("pages/device-unknown", {
        pageTitle: "Unknown device",
        deviceCode
      });
    }

    res.render("pages/admin-device-layout", {
      device,
      currentLayoutDisplayName: device.layoutId
        ? getLayoutDisplayName(
          getAssignableLayouts(layouts).find((layout) => layout.layoutId === device.layoutId)
            || { layoutId: device.layoutId }
        )
        : "none",
      errorMessage: null,
      heading: "Assign Layout",
      layouts: mapAssignableLayouts(layouts),
      pageTitle: `Assign layout for ${deviceCode}`
    });
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/layout", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const nextLayoutId =
      typeof req.body?.layoutId === "string" && req.body.layoutId.trim() !== ""
        ? req.body.layoutId.trim()
        : undefined;
    const [device, layouts] = await Promise.all([
      readDevice(deviceCode),
      listLayouts()
    ]);

    if (!device) {
      return res.status(404).render("pages/device-unknown", {
        pageTitle: "Unknown device",
        deviceCode
      });
    }

    const assignableLayouts = getAssignableLayouts(layouts);

    if (nextLayoutId) {
      const hasLayout = assignableLayouts.some(
        (layout) => layout.layoutId === nextLayoutId
      );

      if (!hasLayout) {
        return res.status(400).render("pages/admin-device-layout", {
          device,
          currentLayoutDisplayName: device.layoutId
            ? getLayoutDisplayName(
              assignableLayouts.find((layout) => layout.layoutId === device.layoutId)
                || { layoutId: device.layoutId }
            )
            : "none",
          errorMessage: "Selected layout is not available.",
          heading: "Assign Layout",
          layouts: mapAssignableLayouts(assignableLayouts),
          pageTitle: `Assign layout for ${deviceCode}`
        });
      }
    }

    await updateDevice(deviceCode, {
      layoutId: nextLayoutId
    });

    redirectAfterDeviceAction(req, res, deviceCode);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/activate-client", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const clientId =
      typeof req.body?.clientId === "string" ? req.body.clientId.trim() : "";
    const requestIp = req.ip;
    const requestUserAgent = typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"]
      : undefined;

    if (!clientId) {
      return renderDeviceDetailPage(req, res, deviceCode, {
        actionErrorMessage: "Select a valid client before activation.",
        httpStatus: 400
      });
    }

    try {
      await activateDeviceClient(deviceCode, clientId);
    } catch (error) {
      if (error?.name === "ValidationError") {
        return renderDeviceDetailPage(req, res, deviceCode, {
          actionErrorMessage: error.message,
          httpStatus: 400
        });
      }

      throw error;
    }

    logLifecycleEvent("admin_device_client_activated", {
      clientId,
      details: { action: "activate_client" },
      deviceCode,
      ip: requestIp,
      level: "info",
      userAgent: requestUserAgent
    });

    return res.redirect(`/admin/devices/${deviceCode}`);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/revoke", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const requestIp = req.ip;
    const requestUserAgent = typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"]
      : undefined;

    await revokeDeviceAuth(deviceCode);
    await updateDevice(deviceCode, { status: "revoked" });
    logLifecycleEvent("admin_device_revoked", {
      details: { action: "revoke" },
      deviceCode,
      ip: requestIp,
      level: "info",
      userAgent: requestUserAgent
    });

    redirectAfterDeviceAction(req, res, deviceCode);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/reset-pairing", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const requestIp = req.ip;
    const requestUserAgent = typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"]
      : undefined;

    await resetDevicePairing(deviceCode);
    logLifecycleEvent("admin_device_pairing_reset", {
      details: { action: "reset_pairing" },
      deviceCode,
      ip: requestIp,
      level: "info",
      userAgent: requestUserAgent
    });

    redirectAfterDeviceAction(req, res, deviceCode);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/reload", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await requestDeviceReload(deviceCode);

    redirectAfterDeviceAction(req, res, deviceCode);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/delete", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await deleteDevice(deviceCode);

    res.redirect("/admin/devices");
  } catch (error) {
    next(error);
  }
});

module.exports = router;
