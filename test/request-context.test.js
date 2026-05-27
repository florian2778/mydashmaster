const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getRequestIp,
  normalizeIpAddress
} = require("../src/http/request-context");

function createRequest({
  forwarded,
  forwardedFor,
  realIp,
  remoteAddress = "172.19.0.1",
  reqIp,
  reqIps,
  trustProxy = 1
} = {}) {
  return {
    app: {
      get(name) {
        if (name === "trust proxy") {
          return trustProxy;
        }

        return undefined;
      }
    },
    headers: {
      ...(forwarded ? { forwarded } : {}),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(realIp ? { "x-real-ip": realIp } : {})
    },
    ip: reqIp,
    ips: reqIps,
    socket: {
      remoteAddress
    }
  };
}

test("normalizeIpAddress strips docker ipv6 mapping, ports, and brackets", () => {
  assert.equal(normalizeIpAddress("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeIpAddress("203.0.113.7:443"), "203.0.113.7");
  assert.equal(normalizeIpAddress("[2001:db8::5]:443"), "2001:db8::5");
});

test("getRequestIp prefers Express trusted proxy ips when available", () => {
  const req = createRequest({
    reqIp: "198.51.100.20",
    reqIps: ["198.51.100.20"]
  });

  assert.equal(getRequestIp(req), "198.51.100.20");
});

test("getRequestIp falls back to standard Forwarded header behind trusted proxy", () => {
  const req = createRequest({
    forwarded: 'for=203.0.113.8;proto=https;by=172.19.0.1',
    reqIp: "172.19.0.1"
  });

  assert.equal(getRequestIp(req), "203.0.113.8");
});

test("getRequestIp falls back to X-Forwarded-For and X-Real-IP behind trusted proxy", () => {
  const forwardedForReq = createRequest({
    forwardedFor: "203.0.113.9, 172.19.0.1",
    reqIp: "172.19.0.1"
  });
  const realIpReq = createRequest({
    realIp: "203.0.113.10",
    reqIp: "172.19.0.1"
  });

  assert.equal(getRequestIp(forwardedForReq), "203.0.113.9");
  assert.equal(getRequestIp(realIpReq), "203.0.113.10");
});

test("getRequestIp does not trust forwarded headers when trust proxy is disabled", () => {
  const req = createRequest({
    forwardedFor: "203.0.113.11",
    reqIp: "172.19.0.1",
    trustProxy: false
  });

  assert.equal(getRequestIp(req), "172.19.0.1");
});
