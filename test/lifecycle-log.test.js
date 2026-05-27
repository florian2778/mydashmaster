const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLifecycleLogPayload,
  logLifecycleEvent,
  shortenUserAgent
} = require("../src/utils/lifecycle-log");

test("buildLifecycleLogPayload strips sensitive values and shortens user agent", () => {
  const payload = buildLifecycleLogPayload("device_auth_failed", {
    accessState: "auth_mismatch",
    clientId: "client-123",
    details: {
      candidateSecretHash: "b".repeat(64),
      nested: {
        MYDASHMASTER_SESSION_SECRET: "super-secret",
        reason: "secret_mismatch",
        secretHash: "a".repeat(64)
      },
      status: "unauthorized"
    },
    deviceCode: "dev12345",
    ip: "203.0.113.5",
    userAgent: "Browser/1.0 " + "x".repeat(200)
  });

  assert.equal(payload.event, "device_auth_failed");
  assert.equal(payload.deviceCode, "dev12345");
  assert.equal(payload.clientId, "client-123");
  assert.equal(payload.accessState, "auth_mismatch");
  assert.equal(payload.ip, "203.0.113.5");
  assert.ok(payload.userAgent.endsWith("..."));
  assert.ok(payload.userAgent.length <= 120);
  assert.deepEqual(payload.details, {
    nested: {
      reason: "secret_mismatch"
    },
    status: "unauthorized"
  });
});

test("logLifecycleEvent respects cooldown and omits sensitive fields from output", () => {
  const originalWarn = console.warn;
  const messages = [];
  console.warn = (...args) => messages.push(args);

  try {
    const loggedFirst = logLifecycleEvent("device_auth_failed", {
      clientId: "client-1",
      cooldownMs: 60000,
      dedupeKey: "device_auth_failed:dev1:client-1",
      details: {
        deviceSecret: "raw-secret",
        reason: "secret_mismatch",
        sessionSecretHash: "c".repeat(64)
      },
      deviceCode: "dev1",
      level: "warn",
      userAgent: "Agent/2.0"
    });
    const loggedSecond = logLifecycleEvent("device_auth_failed", {
      clientId: "client-1",
      cooldownMs: 60000,
      dedupeKey: "device_auth_failed:dev1:client-1",
      details: {
        reason: "secret_mismatch"
      },
      deviceCode: "dev1",
      level: "warn",
      userAgent: "Agent/2.0"
    });

    assert.equal(loggedFirst, true);
    assert.equal(loggedSecond, false);
    assert.equal(messages.length, 1);
    assert.equal(messages[0][0], "[lifecycle]");
    assert.doesNotMatch(messages[0][1], /raw-secret/);
    assert.doesNotMatch(messages[0][1], /sessionSecretHash/);
    assert.match(messages[0][1], /secret_mismatch/);
  } finally {
    console.warn = originalWarn;
  }
});

test("shortenUserAgent returns undefined for missing values and keeps short values intact", () => {
  assert.equal(shortenUserAgent(), undefined);
  assert.equal(shortenUserAgent("   "), undefined);
  assert.equal(shortenUserAgent("Browser/1.0"), "Browser/1.0");
});
