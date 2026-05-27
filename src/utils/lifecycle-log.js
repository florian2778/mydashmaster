const MAX_USER_AGENT_LENGTH = 120;
const SENSITIVE_KEYS = new Set([
  "deviceSecret",
  "secretHash",
  "candidateSecretHash",
  "sessionSecretHash",
  "cookie",
  "cookies",
  "sessionToken",
  "token",
  "MYDASHMASTER_SESSION_SECRET"
]);
const logCooldowns = new Map();

function shortenUserAgent(userAgent) {
  if (typeof userAgent !== "string") {
    return undefined;
  }

  const normalized = userAgent.trim();

  if (normalized === "") {
    return undefined;
  }

  if (normalized.length <= MAX_USER_AGENT_LENGTH) {
    return normalized;
  }

  return normalized.slice(0, MAX_USER_AGENT_LENGTH - 3) + "...";
}

function sanitizeLogValue(value, depth = 0) {
  if (depth > 4) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogValue(entry, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) {
      continue;
    }

    if (typeof entryValue === "undefined" || typeof entryValue === "function") {
      continue;
    }

    sanitized[key] = sanitizeLogValue(entryValue, depth + 1);
  }

  return sanitized;
}

function buildLifecycleLogPayload(event, context = {}) {
  const payload = {
    event,
    timestamp: new Date().toISOString()
  };

  if (typeof context.deviceCode === "string" && context.deviceCode !== "") {
    payload.deviceCode = context.deviceCode;
  }

  if (typeof context.clientId === "string" && context.clientId !== "") {
    payload.clientId = context.clientId;
  }

  if (typeof context.accessState === "string" && context.accessState !== "") {
    payload.accessState = context.accessState;
  }

  if (typeof context.ip === "string" && context.ip !== "") {
    payload.ip = context.ip;
  }

  const shortenedUserAgent = shortenUserAgent(context.userAgent);

  if (shortenedUserAgent) {
    payload.userAgent = shortenedUserAgent;
  }

  if (context.details && typeof context.details === "object") {
    const sanitizedDetails = sanitizeLogValue(context.details);

    if (Object.keys(sanitizedDetails).length > 0) {
      payload.details = sanitizedDetails;
    }
  }

  return payload;
}

function shouldEmitLifecycleLog(dedupeKey, cooldownMs) {
  if (!dedupeKey || !Number.isInteger(cooldownMs) || cooldownMs <= 0) {
    return true;
  }

  const now = Date.now();
  const lastLoggedAt = logCooldowns.get(dedupeKey) || 0;

  if (now - lastLoggedAt < cooldownMs) {
    return false;
  }

  logCooldowns.set(dedupeKey, now);
  return true;
}

function logLifecycleEvent(event, context = {}) {
  const level = context.level === "warn" ? "warn" : "info";

  if (!shouldEmitLifecycleLog(context.dedupeKey, context.cooldownMs)) {
    return false;
  }

  const payload = buildLifecycleLogPayload(event, context);
  console[level]("[lifecycle]", JSON.stringify(payload));
  return true;
}

module.exports = {
  buildLifecycleLogPayload,
  logLifecycleEvent,
  shortenUserAgent
};
