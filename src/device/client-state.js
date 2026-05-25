const DEFAULT_DEVICE_POLL_INTERVAL_MS = 10000;
const ACTIVATABLE_ACTIVITY_MULTIPLIER = 5;

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
  deriveDeviceAccessState,
  deriveClientState,
  getClient,
  getPairedClient,
  hasAuthenticationMismatch,
  hasCurrentAuthentication
};
