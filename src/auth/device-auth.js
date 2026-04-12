const crypto = require("crypto");

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

function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0]
      : null;
  const rawIp = forwardedIp || req.ip || req.socket?.remoteAddress || "";

  return rawIp.replace(/^::ffff:/, "");
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

function setDeviceSessionCookie(req, res, deviceCode, secretHash) {
  res.cookie(DEVICE_SESSION_COOKIE, createSessionToken(deviceCode, secretHash), {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/",
    sameSite: "lax",
    secure: req.secure
  });
}

function clearDeviceSessionCookie(res, deviceCode) {
  res.clearCookie(DEVICE_SESSION_COOKIE, {
    httpOnly: true,
    path: "/",
    sameSite: "lax"
  });
}

module.exports = {
  clearDeviceSessionCookie,
  getRequestIp,
  hashDeviceSecret,
  hasValidDeviceSession,
  setDeviceSessionCookie
};
