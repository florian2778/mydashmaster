const crypto = require("crypto");
const { shouldUseSecureCookies } = require("../http/request-context");

const ADMIN_SESSION_COOKIE = "mydashmaster_admin";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

function parseCookies(headerValue) {
  if (!headerValue) {
    return {};
  }

  return headerValue.split(";").reduce((cookies, part) => {
    const [name, ...valueParts] = part.trim().split("=");

    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(valueParts.join("="));
    return cookies;
  }, {});
}

function readAdminConfig() {
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;

  return {
    passwordHash,
    sessionSecret,
    username
  };
}

function hasAdminAuthConfig() {
  const { username, passwordHash, sessionSecret } = readAdminConfig();
  return Boolean(username && passwordHash && sessionSecret);
}

function hashAdminPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSessionPayload(payload, sessionSecret) {
  return crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("hex");
}

function createSessionValue(username, sessionSecret, now = Date.now()) {
  const expiresAt = now + SESSION_DURATION_MS;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${username}:${expiresAt}:${nonce}`;
  const signature = signSessionPayload(payload, sessionSecret);

  return `${payload}:${signature}`;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  parts.push(`Path=${options.path || "/"}`);
  parts.push(`SameSite=${options.sameSite || "Lax"}`);

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function setAdminSessionCookie(req, res, username, sessionSecret) {
  const value = createSessionValue(username, sessionSecret);

  res.setHeader(
    "Set-Cookie",
    serializeCookie(ADMIN_SESSION_COOKIE, value, {
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
      secure: shouldUseSecureCookies(req)
    })
  );
}

function clearAdminSessionCookie(req, res) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(ADMIN_SESSION_COOKIE, "", {
      maxAge: 0,
      secure: shouldUseSecureCookies(req)
    })
  );
}

function readAdminSession(req) {
  const { username, sessionSecret } = readAdminConfig();
  const cookieValue = parseCookies(req.headers.cookie)[ADMIN_SESSION_COOKIE];

  if (!username || !sessionSecret || !cookieValue) {
    return null;
  }

  const parts = cookieValue.split(":");

  if (parts.length !== 4) {
    return null;
  }

  const [cookieUsername, expiresAtValue, nonce, signature] = parts;
  const payload = `${cookieUsername}:${expiresAtValue}:${nonce}`;
  const expectedSignature = signSessionPayload(payload, sessionSecret);

  if (!timingSafeEqualString(signature, expectedSignature)) {
    return null;
  }

  const expiresAt = Number.parseInt(expiresAtValue, 10);

  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return null;
  }

  if (!timingSafeEqualString(cookieUsername, username)) {
    return null;
  }

  return {
    expiresAt,
    username: cookieUsername
  };
}

function verifyAdminLogin(username, password) {
  const config = readAdminConfig();

  if (!config.username || !config.passwordHash || !config.sessionSecret) {
    return { ok: false, reason: "missing_config" };
  }

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !timingSafeEqualString(username, config.username)
  ) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const passwordHash = hashAdminPassword(password);

  if (!timingSafeEqualString(passwordHash, config.passwordHash)) {
    return { ok: false, reason: "invalid_credentials" };
  }

  return { ok: true, username: config.username };
}

function requireAdminAuth(req, res, next) {
  if (req.path === "/login") {
    return next();
  }

  if (readAdminSession(req)) {
    return next();
  }

  return res.redirect("/admin/login");
}

function adminAuthViewModel(req) {
  const session = readAdminSession(req);

  return {
    isAdminAuthenticated: Boolean(session),
    adminUsername: session?.username || null
  };
}

module.exports = {
  adminAuthViewModel,
  clearAdminSessionCookie,
  hasAdminAuthConfig,
  hashAdminPassword,
  readAdminSession,
  requireAdminAuth,
  setAdminSessionCookie,
  verifyAdminLogin
};
