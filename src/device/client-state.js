const DEFAULT_DEVICE_POLL_INTERVAL_MS = 10000;
const ACTIVATABLE_ACTIVITY_MULTIPLIER = 5;

const ACCESS_STATE_META = Object.freeze({
  pending_activation: Object.freeze({
    uiLabel: "Waiting for activation",
    severity: "warning",
    recoverability: "admin_action",
    adminHint: "Admin approval or activation is still required before this browser may show the layout.",
    isHardState: false
  }),
  active_authorized: Object.freeze({
    uiLabel: "Active",
    severity: "ok",
    recoverability: "none",
    adminHint: "No admin action is required while the active client remains authorized.",
    isHardState: false
  }),
  reauth_required: Object.freeze({
    uiLabel: "Reauthentication needed",
    severity: "warning",
    recoverability: "automatic",
    adminHint: "The browser should refresh its short-lived device session automatically.",
    isHardState: false
  }),
  auth_mismatch: Object.freeze({
    uiLabel: "Authentication mismatch",
    severity: "error",
    recoverability: "manual",
    adminHint: "The browser no longer matches the stored device secret and needs conscious admin recovery.",
    isHardState: true
  }),
  blocked_by_other_client: Object.freeze({
    uiLabel: "Blocked by other client",
    severity: "error",
    recoverability: "admin_action",
    adminHint: "Another browser is currently active for this device and must be switched explicitly by an admin.",
    isHardState: true
  }),
  revoked: Object.freeze({
    uiLabel: "Access revoked",
    severity: "error",
    recoverability: "none",
    adminHint: "Device access is revoked. No automatic recovery should run.",
    isHardState: true
  }),
  unknown: Object.freeze({
    uiLabel: "Unknown state",
    severity: "neutral",
    recoverability: "manual",
    adminHint: "The access state is unknown and should be treated conservatively.",
    isHardState: true
  })
});

function getAccessStateMeta(accessState) {
  if (typeof accessState !== "string") {
    return ACCESS_STATE_META.unknown;
  }

  return ACCESS_STATE_META[accessState] || ACCESS_STATE_META.unknown;
}

function getAccessStateLabel(accessState) {
  return getAccessStateMeta(accessState).uiLabel;
}

function isHardAccessState(accessState) {
  return getAccessStateMeta(accessState).isHardState === true;
}

function isRecoverableAccessState(accessState) {
  const { recoverability } = getAccessStateMeta(accessState);
  return recoverability === "automatic" || recoverability === "manual" || recoverability === "admin_action";
}

function getPairedClient(deviceAuth) {
  if (!Array.isArray(deviceAuth?.clients)) {
    return null;
  }

  return deviceAuth.clients.find((client) => client.isPairedClient) || null;
}

function getClient(deviceAuth, clientId) {
  if (!Array.isArray(deviceAuth?.clients) || typeof clientId !== "string") {
    return null;
  }

  return deviceAuth.clients.find((client) => client.clientId === clientId) || null;
}

function hasCurrentAuthentication(device, deviceAuth, client) {
  if (!device || device.status === "revoked") {
    return false;
  }

  if (!client?.lastAuthenticatedAt || !client?.sessionSecretHash) {
    return false;
  }

  if (!deviceAuth?.secretHash) {
    return true;
  }

  return client.sessionSecretHash === deviceAuth.secretHash;
}

function hasAuthenticationMismatch(device, deviceAuth, client) {
  if (!device || device.status === "revoked") {
    return false;
  }

  if (!client?.lastAuthenticatedAt || !client?.sessionSecretHash) {
    return false;
  }

  if (!deviceAuth?.secretHash) {
    return false;
  }

  return client.sessionSecretHash !== deviceAuth.secretHash;
}

function isRecentlySeen(client, now = Date.now()) {
  if (!client?.lastSeenAt) {
    return false;
  }

  const lastSeenAt = new Date(client.lastSeenAt).getTime();

  if (Number.isNaN(lastSeenAt)) {
    return false;
  }

  const configuredPollIntervalMs = Number.parseInt(
    process.env.DEVICE_POLL_INTERVAL_MS || "",
    10
  );
  const pollIntervalMs =
    Number.isInteger(configuredPollIntervalMs) && configuredPollIntervalMs > 0
      ? configuredPollIntervalMs
      : DEFAULT_DEVICE_POLL_INTERVAL_MS;

  return now - lastSeenAt <= pollIntervalMs * ACTIVATABLE_ACTIVITY_MULTIPLIER;
}

function deriveDeviceAccessState({
  device,
  deviceAuth,
  clientId,
  hasValidSession = false
}) {
  const client = getClient(deviceAuth, clientId);
  const activeClient = getPairedClient(deviceAuth);
  const hasCurrentAuth = hasCurrentAuthentication(device, deviceAuth, client);
  const hasAuthMismatch = hasAuthenticationMismatch(device, deviceAuth, client);
  const isRecentlyActive = isRecentlySeen(client);
  const hasActiveClient = Boolean(activeClient);
  const isActiveClient = Boolean(client?.isPairedClient);
  const approved = device?.status === "approved";
  let accessState = "pending_activation";
  let authorized = false;
  let canAttemptBootstrapAuth = false;
  let canAttemptReauth = false;

  if (device?.status === "revoked") {
    accessState = "revoked";
  } else if (!approved || !hasActiveClient) {
    accessState = "pending_activation";
    canAttemptBootstrapAuth = Boolean(!hasAuthMismatch && !hasCurrentAuth);
  } else if (!isActiveClient) {
    accessState = hasAuthMismatch ? "auth_mismatch" : "blocked_by_other_client";
  } else if (hasValidSession) {
    accessState = "active_authorized";
    authorized = true;
  } else if (hasAuthMismatch) {
    accessState = "auth_mismatch";
  } else {
    accessState = "reauth_required";
    canAttemptReauth = Boolean(
      approved &&
        isActiveClient &&
        deviceAuth?.secretHash &&
        (hasCurrentAuth || !client?.lastAuthenticatedAt)
    );
  }

  return {
    accessState,
    accessStateMeta: getAccessStateMeta(accessState),
    activeClient,
    authorized,
    canAttemptBootstrapAuth,
    canAttemptReauth,
    client,
    hasActiveClient,
    hasCurrentAuthentication: hasCurrentAuth,
    hasValidSession,
    isActiveClient,
    isActivatable:
      device?.status !== "revoked" &&
      accessState === "pending_activation" &&
      hasCurrentAuth &&
      isRecentlyActive,
    isAuthenticationMismatch: hasAuthMismatch,
    isRecentlyActive
  };
}

function deriveClientState({ device, deviceAuth, clientId, hasValidSession = false }) {
  // accessState is the canonical lifecycle model; clientState remains a compact admin/UI grouping.
  const derivedAccessState = deriveDeviceAccessState({
    clientId,
    device,
    deviceAuth,
    hasValidSession
  });

  let state = "pending";

  if (derivedAccessState.accessState === "active_authorized") {
    state = "active";
  } else if (derivedAccessState.accessState === "blocked_by_other_client") {
    state = "blocked";
  } else if (derivedAccessState.accessState === "revoked") {
    state = "revoked";
  }

  return {
    client: derivedAccessState.client,
    hasPairedClient: derivedAccessState.hasActiveClient,
    isAuthenticated: derivedAccessState.hasCurrentAuthentication,
    isActivatable: derivedAccessState.isActivatable,
    isRecentlyActive: derivedAccessState.isRecentlyActive,
    pairedClient: derivedAccessState.activeClient,
    state
  };
}

module.exports = {
  ACCESS_STATE_META,
  deriveDeviceAccessState,
  deriveClientState,
  getAccessStateLabel,
  getAccessStateMeta,
  getClient,
  getPairedClient,
  hasAuthenticationMismatch,
  hasCurrentAuthentication,
  isHardAccessState,
  isRecoverableAccessState
};
