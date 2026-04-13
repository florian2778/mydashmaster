const express = require("express");

const { buildDeviceLayoutViewModel } = require("../device/layout-render");
const {
  clearDeviceSessionCookie,
  getRequestIp,
  hashDeviceSecret,
  hasValidDeviceSession,
  setDeviceSessionCookie
} = require("../auth/device-auth");
const {
  recordDeviceActivity,
  readDevice,
  readDeviceAuth,
  registerCandidateSecret,
  updateDeviceAuth
} = require("../storage/json-store");

const router = express.Router();

function buildStatusPayload(req, deviceCode, device, deviceAuth) {
  const reloadVersion = deviceAuth?.reloadVersion || 0;

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

  return {
    accessState: authorized ? "authorized" : "auth_mismatch",
    authorized,
    deviceCode,
    layoutId: device.layoutId || null,
    reloadVersion,
    status: "approved"
  };
}

router.get("/:deviceCode/status", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const device = await readDevice(deviceCode);
    const deviceAuth = device ? await readDeviceAuth(deviceCode) : null;
    const payload = buildStatusPayload(req, deviceCode, device, deviceAuth);

    if (!device) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(404).json(payload);
    }

    return res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/:deviceCode/layout-fragment", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const device = await readDevice(deviceCode);
    const deviceAuth = device ? await readDeviceAuth(deviceCode) : null;
    const payload = buildStatusPayload(req, deviceCode, device, deviceAuth);

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
      await recordDeviceActivity(deviceCode, requestIp);
      setDeviceSessionCookie(req, res, deviceCode, secretHash);

      return res.json({ status: "approved" });
    }

    if (deviceAuth.secretHash !== secretHash) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(401).json({ status: "unauthorized" });
    }

    await recordDeviceActivity(deviceCode, requestIp);
    setDeviceSessionCookie(req, res, deviceCode, deviceAuth.secretHash);

    return res.json({ status: "approved" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
