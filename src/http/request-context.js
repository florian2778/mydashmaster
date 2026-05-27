function normalizeIpAddress(rawIp) {
  if (typeof rawIp !== "string") {
    return "";
  }

  const trimmed = rawIp.trim().replace(/^"|"$/g, "");

  if (trimmed === "") {
    return "";
  }

  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    return trimmed.slice(1, trimmed.indexOf("]")).replace(/^::ffff:/, "");
  }

  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(trimmed)) {
    return trimmed.replace(/:\d+$/, "");
  }

  return trimmed.replace(/^::ffff:/, "");
}

function getTrustedForwardedIp(req) {
  const trustProxy = typeof req.app?.get === "function"
    ? req.app.get("trust proxy")
    : false;

  if (!trustProxy) {
    return "";
  }

  const remoteAddress = normalizeIpAddress(req.socket?.remoteAddress || "");
  const expressIp = normalizeIpAddress(req.ip || "");

  if (Array.isArray(req.ips) && req.ips.length > 0) {
    const firstTrustedIp = normalizeIpAddress(req.ips[0]);

    if (firstTrustedIp) {
      return firstTrustedIp;
    }
  }

  if (expressIp && expressIp !== remoteAddress) {
    return expressIp;
  }

  const forwardedHeader = req.headers?.forwarded;

  if (typeof forwardedHeader === "string") {
    const forwardedMatch = forwardedHeader.match(/for=(?:"?\[?)([^\]";,]+)/i);
    const forwardedIp = normalizeIpAddress(forwardedMatch?.[1] || "");

    if (forwardedIp) {
      return forwardedIp;
    }
  }

  const forwardedForHeader = req.headers?.["x-forwarded-for"];

  if (typeof forwardedForHeader === "string") {
    const forwardedForIp = normalizeIpAddress(forwardedForHeader.split(",")[0] || "");

    if (forwardedForIp) {
      return forwardedForIp;
    }
  }

  const realIpHeader = req.headers?.["x-real-ip"];

  if (typeof realIpHeader === "string") {
    const realIp = normalizeIpAddress(realIpHeader);

    if (realIp) {
      return realIp;
    }
  }

  return expressIp;
}

function getRequestIp(req) {
  return (
    getTrustedForwardedIp(req) ||
    normalizeIpAddress(req.ip || req.socket?.remoteAddress || "")
  );
}

function shouldUseSecureCookies(req) {
  return Boolean(req.secure);
}

module.exports = {
  getRequestIp,
  normalizeIpAddress,
  shouldUseSecureCookies
};
