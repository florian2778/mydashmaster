const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACCESS_STATE_META,
  getAccessStateMeta,
  isHardAccessState,
  isRecoverableAccessState
} = require("../src/device/client-state");

test("every known access state exposes metadata", () => {
  const knownStates = [
    "pending_activation",
    "active_authorized",
    "reauth_required",
    "auth_mismatch",
    "blocked_by_other_client",
    "revoked",
    "unknown"
  ];

  for (const accessState of knownStates) {
    const meta = getAccessStateMeta(accessState);

    assert.equal(typeof meta.uiLabel, "string");
    assert.equal(typeof meta.severity, "string");
    assert.equal(typeof meta.recoverability, "string");
    assert.equal(typeof meta.adminHint, "string");
    assert.equal(typeof meta.isHardState, "boolean");
    assert.equal(meta, ACCESS_STATE_META[accessState]);
  }
});

test("unknown access states fall back to unknown metadata", () => {
  assert.equal(getAccessStateMeta("does_not_exist"), ACCESS_STATE_META.unknown);
  assert.equal(getAccessStateMeta(null), ACCESS_STATE_META.unknown);
});

test("isHardAccessState classifies hard and soft states correctly", () => {
  assert.equal(isHardAccessState("auth_mismatch"), true);
  assert.equal(isHardAccessState("blocked_by_other_client"), true);
  assert.equal(isHardAccessState("revoked"), true);
  assert.equal(isHardAccessState("pending_activation"), false);
  assert.equal(isHardAccessState("reauth_required"), false);
  assert.equal(isHardAccessState("active_authorized"), false);
});

test("isRecoverableAccessState classifies recoverability correctly", () => {
  assert.equal(isRecoverableAccessState("reauth_required"), true);
  assert.equal(isRecoverableAccessState("auth_mismatch"), true);
  assert.equal(isRecoverableAccessState("blocked_by_other_client"), true);
  assert.equal(isRecoverableAccessState("pending_activation"), true);
  assert.equal(isRecoverableAccessState("active_authorized"), false);
  assert.equal(isRecoverableAccessState("revoked"), false);
});
