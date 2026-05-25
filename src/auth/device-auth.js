const crypto = require("crypto");
const {
  getRequestIp,
  shouldUseSecureCookies
} = require("../http/request-context");

const DEVICE_CLIENT_COOKIE = "mydashmaster_device_client";
const DEVICE_SESSION_COOKIE = "mydashmaster_device";

function getSessionSecret() {
  return process.env.MYDASHMASTER_SESSION_SECRET || "mydashmaster-dev-session-secret";
}

function hashDeviceSecret(deviceSecret) {
  return crypto.createHash("sha256").update(deviceSecret).digest("hex");
}

function createSessionToken(deviceCode, secretHash) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(`${deviceCode}:${secretHash}`)
    .digest("hex");
}

function createClientId() {
  return crypto.randomBytes(16).toString("hex");
}

function parseCookies(headerValue) {
  if (!headerValue) {
    return {};
  }

  return headerValue.split(";").reduce((cookies, chunk) => {
    const [rawName, ...rawValue] = chunk.trim().split("=");

    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function hasValidDeviceSession(req, deviceCode, secretHash) {
  if (!secretHash) {
    return false;
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[DEVICE_SESSION_COOKIE];

  if (!token) {
    return false;
  }

  const expectedToken = createSessionToken(deviceCode, secretHash);
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedToken);

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

function readDeviceClientId(req) {
  const cookies = parseCookies(req.headers.cookie);
  const clientId = cookies[DEVICE_CLIENT_COOKIE];

  if (typeof clientId !== "string" || clientId.trim() === "") {
    return null;
  }

  return clientId;
}

function ensureDeviceClientId(req, res) {
  const existingClientId = readDeviceClientId(req);

  if (existingClientId) {
    return existingClientId;
  }

  const clientId = createClientId();

  res.cookie(DEVICE_CLIENT_COOKIE, clientId, {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookies(req)
  });

  return clientId;
}

function setDeviceSessionCookie(req, res, deviceCode, secretHash) {
  res.cookie(DEVICE_SESSION_COOKIE, createSessionToken(deviceCode, secretHash), {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookies(req)
  });
}

function renewDeviceSessionCookie(req, res, deviceCode, secretHash) {
  setDeviceSessionCookie(req, res, deviceCode, secretHash);
}

function clearDeviceSessionCookie(req, res, deviceCode) {
  res.clearCookie(DEVICE_SESSION_COOKIE, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookies(req)
  });
}

module.exports = {
  clearDeviceSessionCookie,
  ensureDeviceClientId,
  getRequestIp,
  hashDeviceSecret,
  hasValidDeviceSession,
  readDeviceClientId,
  renewDeviceSessionCookie,
  setDeviceSessionCookie
};
