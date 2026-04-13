function normalizeIpAddress(rawIp) {
  if (typeof rawIp !== "string" || rawIp === "") {
    return "";
  }

  return rawIp.replace(/^::ffff:/, "");
}

function getRequestIp(req) {
  return normalizeIpAddress(req.ip || req.socket?.remoteAddress || "");
}

function shouldUseSecureCookies(req) {
  return Boolean(req.secure);
}

module.exports = {
  getRequestIp,
  shouldUseSecureCookies
};
