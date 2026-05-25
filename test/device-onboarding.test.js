const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const app = require("../src/app");
const { hashAdminPassword } = require("../src/auth/admin-auth");
const { hashDeviceSecret } = require("../src/auth/device-auth");
const {
  activateDeviceClient,
  listDeviceCodes,
  recordDeviceClientActivity,
  readDevice,
  readDeviceAuth,
  updateDeviceAuth,
  writeDevice
} = require("../src/storage/json-store");

const devicesDir = path.join(__dirname, "..", "data", "devices");
const deviceAuthDir = path.join(__dirname, "..", "data", "device-auth");
const layoutsDir = path.join(__dirname, "..", "data", "layouts");
const adminEnvDefaults = {
  ADMIN_PASSWORD_HASH: hashAdminPassword("admin-pass"),
  ADMIN_SESSION_SECRET: "test-admin-session-secret",
  ADMIN_USERNAME: "admin"
};

async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function withServer(run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function withAdminEnv(run) {
  const previous = {
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME
  };

  Object.assign(process.env, adminEnvDefaults);

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function getSetCookieValues(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const headerValue = response.headers.get("set-cookie");

  if (!headerValue) {
    return [];
  }

  return headerValue.split(/,(?=[^;,\s]+=[^;]+)/);
}

function getCookiePair(response, cookieName) {
  for (const cookieHeader of getSetCookieValues(response)) {
    const match = cookieHeader.match(
      new RegExp(`${cookieName}=([^;]+)`)
    );

    if (match) {
      return `${cookieName}=${match[1]}`;
    }
  }

  return null;
}

function getCookieHeader(response, cookieNames) {
  return cookieNames
    .map((cookieName) => getCookiePair(response, cookieName))
    .filter(Boolean)
    .join("; ");
}

function getCookieValue(cookiePair) {
  return cookiePair.split("=")[1];
}

async function loginAsAdmin(baseUrl) {
  const response = await fetch(`${baseUrl}/admin/login`, {
    body: new URLSearchParams({
      password: "admin-pass",
      username: "admin"
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    redirect: "manual"
  });

  assert.equal(response.status, 302);

  const cookieHeader = getCookiePair(response, "mydashmaster_admin");

  assert.match(cookieHeader, /mydashmaster_admin=/);

  return cookieHeader;
}

test("unknown device page does not create a device record", async () => {
  const deviceCode = "zzzzzzzx";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/d/${deviceCode}`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.match(body, /Unknown device/);
  });

  await assert.rejects(fs.access(deviceFilePath));
  await assert.rejects(fs.access(deviceAuthFilePath));
});

test("true pending page keeps bootstrap and status checks active", async () => {
  const deviceCode = "pending01";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "pending"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /Access pending/);
      assert.match(body, /waiting for admin approval/i);
      assert.match(body, /\/api\/device\/pending01\/auth/);
      assert.match(body, /\/api\/device\/pending01\/status/);
      assert.match(body, /const currentClientState = "pending"/);
      assert.match(body, /setInterval\(checkPendingState, pollIntervalMs\)/);
      assert.match(body, /typeof statusPayload\.accessState !== "string"/);
      assert.match(body, /if \(true && shouldAttemptAuth\(lastSeenAccessState\)\)/);
      assert.match(body, /currentCanAttemptBootstrapAuth = true/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("pending page uses scoped device secret storage with guarded legacy migration", async () => {
  const deviceCode = "scopekey";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "pending"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`);
      const body = await response.text();
      const persistMatches = body.match(/persistScopedDeviceSecret\(/g) || [];
      const scopedReadIndex = body.indexOf(
        "const scopedDeviceSecret = window.localStorage.getItem("
      );
      const legacyReadIndex = body.indexOf(
        "const legacyDeviceSecret = window.localStorage.getItem("
      );
      const legacySuccessIndex = body.indexOf(
        "if (secretCandidate.source === \"legacy\") {"
      );
      const errorBranchIndex = body.indexOf("authRetryBlocked = true;");

      assert.equal(response.status, 200);
      assert.match(body, /function getScopedDeviceSecretKey\(currentDeviceCode\)/);
      assert.match(body, /function getLegacyDeviceSecretKey\(\)/);
      assert.match(body, /function readDeviceSecretCandidate\(currentDeviceCode\)/);
      assert.match(body, /function persistScopedDeviceSecret\(currentDeviceCode, deviceSecret\)/);
      assert.match(body, /function generateDeviceSecret\(\)/);
      assert.ok(body.includes('return `mydashmaster-device-secret:${currentDeviceCode}`;'));
      assert.ok(scopedReadIndex >= 0);
      assert.ok(legacyReadIndex >= 0);
      assert.ok(scopedReadIndex < legacyReadIndex);
      assert.match(body, /persistScopedDeviceSecret\(currentDeviceCode, newDeviceSecret\);/);
      assert.ok(legacySuccessIndex >= 0);
      assert.match(body, /persistScopedDeviceSecret\(deviceCode, secretCandidate\.secret\);/);
      assert.ok(errorBranchIndex > legacySuccessIndex);
      assert.equal(persistMatches.length, 3);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("different pending device pages embed different scoped secret contexts", async () => {
  const deviceCodeA = "scopea01";
  const deviceCodeB = "scopeb01";
  const deviceFilePathA = path.join(devicesDir, `${deviceCodeA}.json`);
  const deviceAuthFilePathA = path.join(deviceAuthDir, `${deviceCodeA}.json`);
  const deviceFilePathB = path.join(devicesDir, `${deviceCodeB}.json`);
  const deviceAuthFilePathB = path.join(deviceAuthDir, `${deviceCodeB}.json`);

  await removeIfExists(deviceFilePathA);
  await removeIfExists(deviceAuthFilePathA);
  await removeIfExists(deviceFilePathB);
  await removeIfExists(deviceAuthFilePathB);

  try {
    await writeDevice(deviceCodeA, {
      deviceCode: deviceCodeA,
      status: "pending"
    });
    await writeDevice(deviceCodeB, {
      deviceCode: deviceCodeB,
      status: "pending"
    });

    await withServer(async (baseUrl) => {
      const responseA = await fetch(`${baseUrl}/d/${deviceCodeA}`);
      const bodyA = await responseA.text();
      const responseB = await fetch(`${baseUrl}/d/${deviceCodeB}`);
      const bodyB = await responseB.text();

      assert.equal(responseA.status, 200);
      assert.equal(responseB.status, 200);
      assert.match(bodyA, /const deviceCode = "scopea01"/);
      assert.match(bodyB, /const deviceCode = "scopeb01"/);
      assert.doesNotMatch(bodyA, /const deviceCode = "scopeb01"/);
      assert.doesNotMatch(bodyB, /const deviceCode = "scopea01"/);
    });
  } finally {
    await removeIfExists(deviceFilePathA);
    await removeIfExists(deviceAuthFilePathA);
    await removeIfExists(deviceFilePathB);
    await removeIfExists(deviceAuthFilePathB);
  }
});

test("device without active client shows pending activation state", async () => {
  const deviceCode = "notpair1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`);
      const body = await response.text();
      const clientId = getCookieValue(
        getCookiePair(response, "mydashmaster_device_client")
      );

      assert.equal(response.status, 200);
      assert.match(body, /Preparing activation/);
      assert.match(body, /Client ID/);
      assert.match(body, new RegExp(clientId));
      assert.match(body, /\/api\/device\/notpair1\/auth/);
      assert.match(body, /\/api\/device\/notpair1\/status/);
      assert.match(body, /const currentClientState = "pending"/);
      assert.match(body, /establishing access in the background/i);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("approved device without active client stays pending even without a valid session", async () => {
  const deviceCode = "mismatch";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      deviceCode,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          "X-Forwarded-For": "203.0.113.44"
        }
      });
      const body = await response.text();
      const clientId = getCookieValue(
        getCookiePair(response, "mydashmaster_device_client")
      );

      assert.equal(response.status, 200);
      assert.match(body, /Preparing activation/);
      assert.match(body, /Client ID/);
      assert.match(body, new RegExp(clientId));
      assert.match(body, /\/api\/device\/mismatch\/status/);
      assert.match(body, /const currentClientState = "pending"/);
      assert.match(body, /establishing access in the background/i);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("revoked device shows distinct revoked state", async () => {
  const deviceCode = "revoked1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "revoked"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /Access revoked/);
      assert.match(body, /This device no longer has access/);
      assert.match(body, /const currentAccessState = "revoked"/);
      assert.match(body, /if \(false && shouldAttemptAuth\(lastSeenAccessState\)\)/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin reset activation clears active assignment and opens a new client selection cycle", async () => {
  const deviceCode = "resetpair";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      candidateSecretHash: "b".repeat(64),
      clients: [
        {
          clientId: "paired-client",
          isPairedClient: true,
          lastAuthenticatedAt: "2026-04-12T00:00:00.000Z",
          lastSeenAt: "2026-04-12T00:00:00.000Z",
          sessionSecretHash: hashDeviceSecret("secret-alpha"),
          userAgent: "Client/1.0"
        },
        {
          clientId: "other-client",
          isPairedClient: false,
          lastAuthenticatedAt: "2026-04-12T00:00:00.000Z",
          lastSeenAt: "2026-04-12T00:00:00.000Z",
          sessionSecretHash: hashDeviceSecret("secret-alpha"),
          userAgent: "Other/1.0"
        }
      ],
      deviceCode,
      lastStatusAt: "2026-04-12T00:00:00.000Z",
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reset-pairing`,
          {
            headers: {
              Cookie: adminCookie
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(response.status, 302);
      });
    });

    const device = await readDevice(deviceCode);
    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(device.status, "approved");
    assert.equal(deviceAuth.secretHash, undefined);
    assert.equal(deviceAuth.lastStatusAt, undefined);
    assert.equal(deviceAuth.candidateSecretHash, undefined);
    assert.equal(
      deviceAuth.clients.every((client) => client.isPairedClient === false),
      true
    );
    assert.equal(
      deviceAuth.clients.every((client) => typeof client.lastAuthenticatedAt === "string"),
      true
    );
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin device detail shows Activate again after reset for recent authenticated clients", async () => {
  const deviceCode = "resetdetail";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const now = new Date().toISOString();
  const secretHash = hashDeviceSecret("secret-alpha");

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          clientId: "client-a",
          isPairedClient: true,
          lastAuthenticatedAt: now,
          lastSeenAt: now,
          sessionSecretHash: secretHash,
          userAgent: "ClientA/1.0"
        },
        {
          clientId: "client-b",
          isPairedClient: false,
          lastAuthenticatedAt: now,
          lastSeenAt: now,
          sessionSecretHash: secretHash,
          userAgent: "ClientB/1.0"
        }
      ],
      deviceCode,
      secretHash,
      updatedAt: now
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const resetResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reset-pairing`,
          {
            headers: {
              Cookie: adminCookie
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(resetResponse.status, 302);

        const detailResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}`,
          {
            headers: {
              Cookie: adminCookie
            }
          }
        );
        const detailHtml = await detailResponse.text();
        const deviceAuth = await readDeviceAuth(deviceCode);

        assert.equal(detailResponse.status, 200);
        assert.equal(
          deviceAuth.clients.every((client) => client.isPairedClient === false),
          true
        );
        assert.match(detailHtml, /No official client/);
        assert.match(detailHtml, /A client is ready below\. Activate it to make this device operational\./);
        assert.match(detailHtml, /value="client-a"/);
        assert.match(detailHtml, /value="client-b"/);
        assert.equal((detailHtml.match(/>Activate</g) || []).length, 2);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("pending device can authenticate without auto-activation", async () => {
  const deviceCode = "repair01";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-repair" }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json();
      const cookieHeader = getCookieHeader(response, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      const clientId = getCookieValue(
        getCookiePair(response, "mydashmaster_device_client")
      );

      assert.equal(response.status, 200);
      assert.deepEqual(payload, { status: "approved" });
      assert.match(cookieHeader, /mydashmaster_device=/);

      const statusResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/status`, {
        headers: {
          Cookie: cookieHeader
        }
      });

      assert.deepEqual(await statusResponse.json(), {
        accessState: "pending_activation",
        authorized: false,
        canAttemptBootstrapAuth: false,
        canAttemptReauth: false,
        clientState: "pending",
        deviceCode,
        hasActiveClient: false,
        hasCurrentAuthentication: true,
        hasValidSession: false,
        isActiveClient: false,
        isAuthenticated: true,
        isActivatable: true,
        layoutId: null,
        reloadVersion: 0,
        status: "approved"
      });

      const deviceAuth = await readDeviceAuth(deviceCode);
      const client = deviceAuth.clients.find((entry) => entry.clientId === clientId);

      assert.equal(client.isPairedClient, false);
      assert.match(client.lastAuthenticatedAt, /^\d{4}-\d{2}-\d{2}T/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin device cards show formatted fields and filtered actions", async () => {
  const deviceCode = "cardview1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const layoutId = "card-layout";
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);
  await removeIfExists(layoutFilePath);

  try {
    await fs.writeFile(
      layoutFilePath,
      JSON.stringify(
        {
          description: "Operations board",
          layoutId,
          layoutVersion: 1,
          options: {
            showHeader: false,
            showLayoutTitle: false,
            showStatus: false
          },
          structure: {
            type: "row",
            children: [
              {
                type: "box",
                box: "box1",
                size: "100%"
              }
            ]
          },
          boxes: [
            {
              name: "box1",
              url: "https://example.com/card",
              zoom: 1
            }
          ]
        },
        null,
        2
      )
    );

    await writeDevice(deviceCode, {
      deviceCode,
      layoutId,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          clientId: "paired-client",
          isPairedClient: true,
          lastSeenAt: new Date().toISOString(),
          userAgent: "CardViewClient/1.0"
        }
      ],
      deviceCode,
      lastConnectedAt: "2026-04-13T00:00:00.000Z",
      lastKnownIp: "203.0.113.99",
      lastStatusAt: new Date().toISOString(),
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: new Date().toISOString()
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/devices`, {
          headers: {
            Cookie: adminCookie
          }
        });
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /Layout: <strong>Operations board<\/strong>/);
        assert.match(body, /device-overview-secondary-label"[^>]*>Seen</);
        assert.match(body, /device-overview-secondary-value"[^>]*>(just now|\d+s ago|\d+m ago|\d+h ago|\d+d ago)</);
        assert.match(body, new RegExp(`href="/admin/devices/${deviceCode}"`));
        assert.match(body, new RegExp(`href="/d/${deviceCode}"`));
        assert.match(body, /device-overview-status-bubble--online/);
        assert.doesNotMatch(body, /IP: 203\.0\.113\.99/);
        assert.doesNotMatch(body, />Reload</);
        assert.doesNotMatch(body, />Reset activation</);
        assert.doesNotMatch(body, />Revoke</);
        assert.doesNotMatch(body, />Delete</);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
    await removeIfExists(layoutFilePath);
  }
});

test("admin device detail page shows summary, official active client, and additional client activity", async () => {
  const deviceCode = "detail01";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const layoutId = "detail-layout";
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);
  const now = new Date();
  const lastConnectedAt = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const pairedSeenAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const additionalSeenAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const lastStatusAt = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);
  await removeIfExists(layoutFilePath);

  try {
    await fs.writeFile(
      layoutFilePath,
      JSON.stringify(
        {
          description: "Lobby split",
          layoutId,
          layoutVersion: 1,
          options: {
            showHeader: false,
            showLayoutTitle: false,
            showStatus: false
          },
          structure: {
            type: "row",
            children: [
              {
                type: "box",
                box: "box1",
                size: "100%"
              }
            ]
          },
          boxes: [
            {
              name: "box1",
              url: "https://example.com/detail",
              zoom: 1
            }
          ]
        },
        null,
        2
      )
    );

    await writeDevice(deviceCode, {
      description: "North lobby panel",
      deviceCode,
      layoutId,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          clientId: "client-alpha-1234",
          isPairedClient: true,
          lastAuthenticatedAt: pairedSeenAt,
          lastKnownIp: "203.0.113.7",
          lastSeenAt: pairedSeenAt,
          userAgent: "PairedClient/1.0"
        },
        {
          clientId: "client-bravo-5678",
          isPairedClient: false,
          lastAuthenticatedAt: additionalSeenAt,
          lastKnownIp: "203.0.113.8",
          lastSeenAt: additionalSeenAt,
          userAgent: "SpareBrowser/2.0"
        }
      ],
      deviceCode,
      lastConnectedAt,
      lastKnownIp: "203.0.113.7",
      lastStatusAt,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: lastStatusAt
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/devices/${deviceCode}`, {
          headers: {
            Cookie: adminCookie
          }
        });
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /North lobby panel/);
        assert.match(body, /Summary/);
        assert.match(body, /Official client IP/);
        assert.match(body, /Lobby split/);
        assert.match(body, /Official Client/);
        assert.match(body, /Active · Offline/);
        assert.match(body, /<span class="admin-device-status-pill admin-device-status-pill--fresh">Active<\/span>/);
        assert.match(body, /<span class="admin-device-status-pill admin-device-status-pill--aged">Offline<\/span>/);
        assert.match(body, /Seen (just now|\d+s ago|\d+m ago|\d+h ago|\d+d ago)/);
        assert.match(body, /PairedClient\/1\.0/);
        assert.match(body, /203\.0\.113\.7/);
        assert.match(body, /Other Clients/);
        assert.match(body, /client-b\.\.\./);
        assert.match(body, /Blocked/);
        assert.match(body, new RegExp(additionalSeenAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(body, /SpareBrowser\/2\.0/);
        assert.match(body, new RegExp(`full clientId<\\/strong> <code>client-bravo-5678<\\/code>`));
        assert.doesNotMatch(body, /name="clientId" value="client-bravo-5678"/);
        assert.doesNotMatch(body, /name="clientId" value="client-alpha-1234"/);
        assert.match(body, /Another client is currently active\./);
        assert.match(body, /window\.setInterval\(\(\) => \{/);
        assert.match(body, /window\.location\.reload\(\)/);
        assert.match(body, /detailPollIntervalMs/);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
    await removeIfExists(layoutFilePath);
  }
});

test("admin device detail page shows no active client empty state after reset", async () => {
  const deviceCode = "detail02";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      layoutId: "layout-1",
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          clientId: "client-a",
          isPairedClient: true,
          lastSeenAt: "2026-04-13T10:00:00.000Z",
          userAgent: "BrowserA/1.0"
        },
        {
          clientId: "client-b",
          isPairedClient: false,
          lastSeenAt: "2026-04-13T10:05:00.000Z",
          userAgent: "BrowserB/1.0"
        }
      ],
      deviceCode,
      lastStatusAt: "2026-04-13T10:10:00.000Z",
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-13T10:10:00.000Z"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const resetResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reset-pairing`,
          {
            body: new URLSearchParams({
              returnTo: "detail"
            }),
            headers: {
              Cookie: adminCookie,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(resetResponse.status, 302);
        assert.equal(
          resetResponse.headers.get("location"),
          `/admin/devices/${deviceCode}`
        );

        const detailResponse = await fetch(`${baseUrl}/admin/devices/${deviceCode}`, {
          headers: {
            Cookie: adminCookie
          }
        });
        const detailBody = await detailResponse.text();

        assert.equal(detailResponse.status, 200);
        assert.match(detailBody, /No official client/);
        assert.doesNotMatch(detailBody, /admin-device-status-pill--fresh">Active<\/span>/);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("device page layout title prefers description over layoutId", async () => {
  const deviceCode = "layoutttl";
  const layoutId = "device-title-layout";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);
  await removeIfExists(layoutFilePath);

  try {
    await fs.writeFile(
      layoutFilePath,
      JSON.stringify(
        {
          description: "South wall display",
          layoutId,
          layoutVersion: 1,
          options: {
            showHeader: false,
            showLayoutTitle: true,
            showStatus: false
          },
          structure: {
            type: "row",
            children: [
              {
                type: "box",
                box: "box1",
                size: "100%"
              }
            ]
          },
          boxes: [
            {
              name: "box1",
              url: "https://example.org/title",
              zoom: 1
            }
          ]
        },
        null,
        2
      )
    );

    await writeDevice(deviceCode, {
      deviceCode,
      layoutId,
      status: "approved"
    });

    await withServer(async (baseUrl) => {
      const authResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });

      const cookieHeader = getCookieHeader(authResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);

      await fetch(`${baseUrl}/api/device/${deviceCode}/status`, {
        headers: {
          Cookie: cookieHeader
        }
      });

      await activateDeviceClient(
        deviceCode,
        getCookieValue(getCookiePair(authResponse, "mydashmaster_device_client"))
      );

      const pageResponse = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          Cookie: cookieHeader
        }
      });
      const pageBody = await pageResponse.text();

      assert.equal(pageResponse.status, 200);
      assert.match(pageBody, /South wall display/);
      assert.match(pageBody, new RegExp(`data-layout-id="${layoutId}"`));
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
    await removeIfExists(layoutFilePath);
  }
});

test("successful authorized device page access updates activity metadata and uses soft state protection", async () => {
  const deviceCode = "accessok1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });

    await withServer(async (baseUrl) => {
      const authResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.10"
        },
        method: "POST"
      });
      const authPayload = await authResponse.json();

      assert.equal(authResponse.status, 200);
      assert.deepEqual(authPayload, { status: "approved" });

      const cookieHeader = getCookieHeader(authResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      await activateDeviceClient(
        deviceCode,
        getCookieValue(getCookiePair(authResponse, "mydashmaster_device_client"))
      );

      assert.match(cookieHeader, /mydashmaster_device=/);

      const beforePageAccess = await readDeviceAuth(deviceCode);

      const pageResponse = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          Cookie: cookieHeader,
          "X-Forwarded-For": "198.51.100.20"
        }
      });
      const pageBody = await pageResponse.text();

      assert.equal(pageResponse.status, 200);
      assert.ok(pageBody.includes('id="device-layout-root"'));
      assert.ok(pageBody.includes('/layout-fragment'));
      assert.ok(pageBody.includes('if (isUpdatingLayout)'));
      assert.ok(pageBody.includes('let isUpdatingLayout = false'));
      assert.ok(pageBody.includes('let isReauthInProgress = false'));
      assert.ok(pageBody.includes('let reauthRetryBlocked = false'));
      assert.ok(pageBody.includes('let softFailureCount = 0'));
      assert.ok(pageBody.includes('function getScopedDeviceSecretKey(currentDeviceCode)'));
      assert.ok(pageBody.includes('function getLegacyDeviceSecretKey()'));
      assert.ok(pageBody.includes('function readDeviceSecretCandidate(currentDeviceCode)'));
      assert.ok(pageBody.includes('return null;'));
      assert.ok(pageBody.includes('async function requestReauth(deviceSecret)'));
      assert.ok(pageBody.includes('async function attemptSilentReauth()'));
      assert.ok(pageBody.includes('if (reauthRetryBlocked || isReauthInProgress)'));
      assert.ok(pageBody.includes('const secretCandidate = readDeviceSecretCandidate(currentState.deviceCode)'));
      assert.ok(pageBody.includes('if (!secretCandidate?.secret)'));
      assert.ok(pageBody.includes('const authResult = await requestReauth(secretCandidate.secret)'));
      assert.ok(pageBody.includes('if (secretCandidate.source === "legacy")'));
      assert.ok(pageBody.includes('persistScopedDeviceSecret(currentState.deviceCode, secretCandidate.secret)'));
      assert.ok(pageBody.includes('authResult.status === 401'));
      assert.ok(pageBody.includes('authResult.payload?.accessState === "auth_mismatch"'));
      assert.ok(pageBody.includes('function isHardAccessState(accessState)'));
      assert.ok(pageBody.includes('accessState === "revoked"'));
      assert.ok(pageBody.includes('accessState === "auth_mismatch"'));
      assert.ok(pageBody.includes('accessState === "blocked_by_other_client"'));
      assert.ok(pageBody.includes('function resetSoftFailureState()'));
      assert.ok(pageBody.includes('if (payload.accessState === "reauth_required")'));
      assert.ok(pageBody.includes('const reauthOutcome = await attemptSilentReauth()'));
      assert.ok(pageBody.includes('if (reauthOutcome === "hard_failure")'));
      assert.ok(pageBody.includes('if (reauthOutcome === "reauth_success")'));
      assert.ok(pageBody.includes('if (payload.accessState === "pending_activation")'));
      assert.ok(pageBody.includes('if (softFailureCount >= 2)'));
      assert.ok(pageBody.includes('if (isHardAccessState(payload.accessState))'));
      assert.ok(pageBody.includes('payload.reloadVersion !== currentState.reloadVersion'));
      assert.ok(pageBody.includes('requestedLayoutId !== latestExpectedLayoutId'));
      assert.ok(pageBody.includes('fragmentLayoutId !== latestExpectedLayoutId'));
      assert.ok(pageBody.includes('currentLayoutRoot.classList.add("device-layout-root--updating")'));
      assert.ok(!pageBody.includes('payload.accessState !== "active_authorized" || payload.authorized !== true'));

      const afterPageAccess = await readDeviceAuth(deviceCode);

      assert.equal(afterPageAccess.lastKnownIp, "198.51.100.20");
      assert.match(afterPageAccess.lastConnectedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.notEqual(
        afterPageAccess.lastConnectedAt,
        beforePageAccess.lastConnectedAt
      );
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("failed device page access does not update activity metadata", async () => {
  const deviceCode = "accessbad";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          clientId: "paired-client",
          isPairedClient: true,
          lastAuthenticatedAt: "2026-04-12T00:00:00.000Z",
          lastSeenAt: "2026-04-12T00:00:00.000Z",
          userAgent: "PairedClient/1.0"
        }
      ],
      deviceCode,
      lastConnectedAt: "2026-04-12T00:00:00.000Z",
      lastKnownIp: "198.51.100.30",
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          "X-Forwarded-For": "198.51.100.40"
        }
      });

      assert.equal(response.status, 200);
      assert.match(await response.text(), /This browser is not the active one/);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.lastKnownIp, "198.51.100.30");
    assert.equal(deviceAuth.lastConnectedAt, "2026-04-12T00:00:00.000Z");
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin logout clears the session cookie", async () => {
  await withAdminEnv(async () => {
    await withServer(async (baseUrl) => {
      const adminCookie = await loginAsAdmin(baseUrl);
      const response = await fetch(`${baseUrl}/admin/logout`, {
        headers: {
          Cookie: adminCookie
        },
        method: "POST",
        redirect: "manual"
      });

      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/admin/login");
      assert.match(response.headers.get("set-cookie"), /mydashmaster_admin=/);
      assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
    });
  });
});

test("admin delete removes both device and auth files", async () => {
  const deviceCode = "deltest1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "pending"
    });
    await updateDeviceAuth(deviceCode, {
      candidateSecretHash: "a".repeat(64),
      deviceCode,
      lastConnectedAt: "2026-04-12T00:00:00.000Z",
      lastKnownIp: "203.0.113.9",
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/devices/${deviceCode}/delete`, {
          headers: {
            Cookie: adminCookie
          },
          method: "POST",
          redirect: "manual"
        });

        assert.equal(response.status, 302);
      });
    });

    await assert.rejects(fs.access(deviceFilePath));
    await assert.rejects(fs.access(deviceAuthFilePath));
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});
