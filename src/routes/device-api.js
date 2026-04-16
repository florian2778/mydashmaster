const express = require("express");

const { buildDeviceLayoutViewModel } = require("../device/layout-render");
const {
  clearDeviceSessionCookie,
  ensureDeviceClientId,
  getRequestIp,
  hashDeviceSecret,
  hasValidDeviceSession,
  setDeviceSessionCookie
} = require("../auth/device-auth");
const {
  recordAuthenticatedClientSession,
  recordDeviceClientActivity,
  recordDeviceActivity,
  readDevice,
  readDeviceAuth,
  registerCandidateSecret,
  updateDeviceAuth
} = require("../storage/json-store");

const router = express.Router();

function getRequestUserAgent(req) {
  return typeof req.headers["user-agent"] === "string"
    ? req.headers["user-agent"]
    : undefined;
}

function buildStatusPayload(req, deviceCode, device, deviceAuth, clientId) {
  const reloadVersion = deviceAuth?.reloadVersion || 0;
  const pairedClient = Array.isArray(deviceAuth?.clients)
    ? deviceAuth.clients.find((client) => client.isPairedClient) || null
    : null;

  if (!device) {
    return {
      accessState: "unknown",
      authorized: false,
      deviceCode,
      layoutId: null,
      reloadVersion,
      status: "unknown"
    };
  }

  if (device.status === "revoked") {
    return {
      accessState: "revoked",
      authorized: false,
      deviceCode,
      layoutId: device.layoutId || null,
      reloadVersion,
      status: "revoked"
    };
  }

  if (device.status !== "approved") {
    return {
      accessState: "pending",
      authorized: false,
      deviceCode,
      layoutId: device.layoutId || null,
      reloadVersion,
      status: device.status
    };
  }

  if (!deviceAuth?.secretHash) {
    return {
      accessState: "not_paired",
      authorized: false,
      deviceCode,
      layoutId: device.layoutId || null,
      reloadVersion,
      status: "approved"
    };
  }

  const authorized = hasValidDeviceSession(req, deviceCode, deviceAuth.secretHash);

  if (!pairedClient) {
    return {
      accessState: "not_paired",
      authorized: false,
      deviceCode,
      layoutId: device.layoutId || null,
      reloadVersion,
      status: "approved"
    };
  }

  const isPairedClient =
    authorized && pairedClient.clientId === clientId;

  return {
    accessState: isPairedClient ? "authorized" : "auth_mismatch",
    authorized: isPairedClient,
    deviceCode,
    layoutId: device.layoutId || null,
    reloadVersion,
    status: "approved"
  };
}

router.get("/:deviceCode/status", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const clientId = ensureDeviceClientId(req, res);
    const device = await readDevice(deviceCode);
    let deviceAuth = device ? await readDeviceAuth(deviceCode) : null;

    const payload = buildStatusPayload(req, deviceCode, device, deviceAuth, clientId);

    if (!device) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(404).json(payload);
    }

    await recordDeviceClientActivity(
      deviceCode,
      clientId,
      payload.accessState,
      getRequestUserAgent(req),
      getRequestIp(req)
    );

    return res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/:deviceCode/layout-fragment", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const clientId = ensureDeviceClientId(req, res);
    const device = await readDevice(deviceCode);
    let deviceAuth = device ? await readDeviceAuth(deviceCode) : null;

    const payload = buildStatusPayload(req, deviceCode, device, deviceAuth, clientId);

    if (!device) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(404).send("Unknown device");
    }

    if (payload.accessState !== "authorized") {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(403).send("Not authorized");
    }

    const layoutViewModel = await buildDeviceLayoutViewModel(device);

    res.set("Cache-Control", "no-store");
    res.set("X-Layout-Id", layoutViewModel.layoutId || "");
    return res.render("partials/device-layout-root", layoutViewModel);
  } catch (error) {
    next(error);
  }
});

router.post("/:deviceCode/auth", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const clientId = ensureDeviceClientId(req, res);
    const { deviceSecret } = req.body || {};

    if (typeof deviceSecret !== "string" || deviceSecret.trim() === "") {
      return res.status(400).json({ status: "invalid" });
    }

    const device = await readDevice(deviceCode);

    if (!device) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(404).json({ status: "unknown_device" });
    }

    const secretHash = hashDeviceSecret(deviceSecret);
    const requestIp = getRequestIp(req);

    if (device.status === "pending" || device.status === "revoked") {
      await registerCandidateSecret(deviceCode, secretHash);
      await recordDeviceActivity(deviceCode, requestIp);
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.json({ status: "pending" });
    }

    const deviceAuth = await readDeviceAuth(deviceCode);

    if (!deviceAuth?.secretHash) {
      await updateDeviceAuth(deviceCode, {
        ...deviceAuth,
        candidateSecretHash: undefined,
        secretHash,
        updatedAt: new Date().toISOString()
      });
      await recordAuthenticatedClientSession(
        deviceCode,
        clientId,
        "not_paired",
        getRequestUserAgent(req),
        requestIp
      );
      await recordDeviceActivity(deviceCode, requestIp);
      setDeviceSessionCookie(req, res, deviceCode, secretHash);

      return res.json({ status: "approved" });
    }

    if (deviceAuth.secretHash !== secretHash) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(401).json({ status: "unauthorized" });
    }
    const pairedClient = Array.isArray(deviceAuth.clients)
      ? deviceAuth.clients.find((client) => client.isPairedClient) || null
      : null;
    const accessState = pairedClient
      ? pairedClient.clientId === clientId
        ? "authorized"
        : "auth_mismatch"
      : "not_paired";

    await recordAuthenticatedClientSession(
      deviceCode,
      clientId,
      accessState,
      getRequestUserAgent(req),
      requestIp
    );

    await recordDeviceActivity(deviceCode, requestIp);
    setDeviceSessionCookie(req, res, deviceCode, deviceAuth.secretHash);

    return res.json({ status: "approved" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
