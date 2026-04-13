const express = require("express");

const {
  clearDeviceSessionCookie,
  getRequestIp,
  hasValidDeviceSession
} = require("../auth/device-auth");
const { buildDeviceLayoutViewModel } = require("../device/layout-render");
const {
  recordDeviceActivity,
  recordDeviceRejection,
  readDevice,
  readDeviceAuth
} = require("../storage/json-store");

const router = express.Router();

function renderAccessState(res, deviceCode, accessState) {
  const states = {
    auth_mismatch: {
      message: "Access not available in this browser",
      note:
        "This device is already linked to another browser session. Re-linking requires an admin action.",
      pageTitle: "Access not available",
      shouldBootstrap: false,
      shouldPoll: true
    },
    not_paired: {
      message: "Device not paired",
      note: null,
      pageTitle: "Device not paired",
      shouldBootstrap: true,
      shouldPoll: true
    },
    pending: {
      message: "Access pending",
      note: null,
      pageTitle: "Access pending",
      shouldBootstrap: true,
      shouldPoll: true
    },
    revoked: {
      message: "Access revoked",
      note:
        "This device no longer has access. Please contact an administrator.",
      pageTitle: "Access revoked",
      shouldBootstrap: false,
      shouldPoll: true
    }
  };
  const state = states[accessState];

  return res.render("pages/device-pending", {
    accessState,
    deviceCode,
    message: state.message,
    note: state.note,
    pageTitle: state.pageTitle,
    shouldBootstrap: state.shouldBootstrap,
    shouldPoll: state.shouldPoll
  });
}

router.get("/:deviceCode", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const device = await readDevice(deviceCode);

    if (!device) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(404).render("pages/device-unknown", {
        pageTitle: "Unknown device",
        deviceCode
      });
    }

    if (device.status === "revoked") {
      clearDeviceSessionCookie(req, res, deviceCode);
      return renderAccessState(res, deviceCode, "revoked");
    }

    if (device.status === "pending") {
      clearDeviceSessionCookie(req, res, deviceCode);
      return renderAccessState(res, deviceCode, "pending");
    }

    const deviceAuth = await readDeviceAuth(deviceCode);

    if (!deviceAuth?.secretHash) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return renderAccessState(res, deviceCode, "not_paired");
    }

    if (!hasValidDeviceSession(req, deviceCode, deviceAuth.secretHash)) {
      await recordDeviceRejection(
        deviceCode,
        getRequestIp(req),
        "auth_mismatch"
      );
      clearDeviceSessionCookie(req, res, deviceCode);
      return renderAccessState(res, deviceCode, "auth_mismatch");
    }

    await recordDeviceActivity(deviceCode, getRequestIp(req));
    const layoutViewModel = await buildDeviceLayoutViewModel(device);

    res.render("pages/device", {
      deviceCode,
      pageTitle: `Device ${deviceCode}`,
      reloadVersion: deviceAuth.reloadVersion || 0,
      ...layoutViewModel
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
