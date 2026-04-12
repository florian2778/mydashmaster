const express = require("express");

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
  if (!device) {
    return {
      authorized: false,
      deviceCode,
      layoutId: null,
      status: "unknown"
    };
  }

  if (device.status !== "approved") {
    return {
      authorized: false,
      deviceCode,
      layoutId: device.layoutId || null,
      status: device.status
    };
  }

  return {
    authorized: Boolean(
      deviceAuth?.secretHash && hasValidDeviceSession(req, deviceCode, deviceAuth.secretHash)
    ),
    deviceCode,
    layoutId: device.layoutId || null,
    status: device.status
  };
}

router.get("/:deviceCode/status", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const device = await readDevice(deviceCode);
    const deviceAuth = device ? await readDeviceAuth(deviceCode) : null;
    const payload = buildStatusPayload(req, deviceCode, device, deviceAuth);

    if (!device) {
      clearDeviceSessionCookie(res, deviceCode);
      return res.status(404).json(payload);
    }

    return res.json(payload);
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
      clearDeviceSessionCookie(res, deviceCode);
      return res.status(404).json({ status: "unknown_device" });
    }

    const secretHash = hashDeviceSecret(deviceSecret);
    const requestIp = getRequestIp(req);

    if (device.status === "pending" || device.status === "revoked") {
      await registerCandidateSecret(deviceCode, secretHash);
      await recordDeviceActivity(deviceCode, requestIp);
      clearDeviceSessionCookie(res, deviceCode);
      return res.json({ status: "pending" });
    }

    const deviceAuth = await readDeviceAuth(deviceCode);

    if (!deviceAuth?.secretHash || deviceAuth.secretHash !== secretHash) {
      clearDeviceSessionCookie(res, deviceCode);
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
