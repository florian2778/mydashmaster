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

function deriveClientState({ device, deviceAuth, clientId }) {
  const client = getClient(deviceAuth, clientId);
  const pairedClient = getPairedClient(deviceAuth);
  const isAuthenticated = hasCurrentAuthentication(device, deviceAuth, client);
  const isRecentlyActive = isRecentlySeen(client);
  const hasPairedClient = Boolean(pairedClient);
  const isPairedClient = Boolean(client?.isPairedClient);

  let state = "pending";

  if (isPairedClient) {
    state = "active";
  } else if (hasPairedClient) {
    state = "blocked";
  }

  return {
    client,
    hasPairedClient,
    isAuthenticated,
    isActivatable:
      device?.status !== "revoked" &&
      state === "pending" &&
      isAuthenticated &&
      isRecentlyActive,
    isRecentlyActive,
    pairedClient,
    state
  };
}

module.exports = {
  deriveClientState,
  getClient,
  getPairedClient,
  hasCurrentAuthentication
};
