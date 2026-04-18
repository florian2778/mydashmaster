const express = require("express");

const { deriveClientState } = require("../device/client-state");
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
  readDeviceAuth
} = require("../storage/json-store");

const router = express.Router();

function getRequestUserAgent(req) {
  return typeof req.headers["user-agent"] === "string"
    ? req.headers["user-agent"]
    : undefined;
}

function buildStatusPayload(req, deviceCode, device, deviceAuth, clientId) {
  const reloadVersion = deviceAuth?.reloadVersion || 0;

  if (!device) {
    return {
      clientState: "unknown",
      authorized: false,
      deviceCode,
      isAuthenticated: false,
      isActivatable: false,
      layoutId: null,
      reloadVersion,
      status: "unknown"
    };
  }

  if (device.status === "revoked") {
    return {
      clientState: "revoked",
      authorized: false,
      deviceCode,
      isAuthenticated: false,
      isActivatable: false,
      layoutId: device.layoutId || null,
      reloadVersion,
      status: "revoked"
    };
  }

  const derivedState = deriveClientState({
    clientId,
    device,
    deviceAuth
  });
  const authorized =
    device.status === "approved" &&
    derivedState.state === "active" &&
    Boolean(deviceAuth?.secretHash) &&
    hasValidDeviceSession(req, deviceCode, deviceAuth.secretHash);

  return {
    clientState: derivedState.state,
    authorized,
    deviceCode,
    isAuthenticated: derivedState.isAuthenticated,
    isActivatable: derivedState.isActivatable,
    layoutId: device.layoutId || null,
    reloadVersion,
    status: device.status
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
      {
        isOfficialHeartbeat: payload.authorized === true
      },
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

    if (payload.authorized !== true || payload.clientState !== "active") {
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

    if (device.status === "revoked") {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.json({ status: "revoked" });
    }

    const deviceAuth = await readDeviceAuth(deviceCode);

    if (deviceAuth?.secretHash && deviceAuth.secretHash !== secretHash) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(401).json({ status: "unauthorized" });
    }

    await recordAuthenticatedClientSession(
      deviceCode,
      clientId,
      secretHash,
      getRequestUserAgent(req),
      requestIp
    );

    await recordDeviceActivity(deviceCode, requestIp);
    setDeviceSessionCookie(
      req,
      res,
      deviceCode,
      deviceAuth?.secretHash || secretHash
    );

    return res.json({ status: device.status });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
