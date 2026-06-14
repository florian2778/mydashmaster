const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const app = require("../src/app");
const {
  FALLBACK_VERSION_INFO,
  appVersion,
  loadVersionInfo
} = require("../src/version");

async function withServer(run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = "http://127.0.0.1:" + address.port;

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

test("loadVersionInfo reads valid generated version metadata", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mydashmaster-version-"));
  const versionFilePath = path.join(tempDir, "version.json");

  await fs.writeFile(
    versionFilePath,
    JSON.stringify({
      displayVersion: "v1.2.3-abc1234",
      revision: "abc1234",
      version: "v1.2.3"
    })
  );

  assert.deepEqual(loadVersionInfo(versionFilePath), {
    displayVersion: "v1.2.3-abc1234",
    revision: "abc1234",
    version: "v1.2.3"
  });
});

test("loadVersionInfo falls back when version metadata is missing or invalid", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mydashmaster-version-"));
  const invalidFilePath = path.join(tempDir, "invalid-version.json");

  await fs.writeFile(invalidFilePath, "{not json");
  await fs.writeFile(
    path.join(tempDir, "incomplete-version.json"),
    JSON.stringify({ version: "v1.0.0" })
  );

  assert.deepEqual(
    loadVersionInfo(path.join(tempDir, "missing-version.json")),
    FALLBACK_VERSION_INFO
  );
  assert.deepEqual(loadVersionInfo(invalidFilePath), FALLBACK_VERSION_INFO);
  assert.deepEqual(
    loadVersionInfo(path.join(tempDir, "incomplete-version.json")),
    FALLBACK_VERSION_INFO
  );
});

test("/api/version returns the centrally loaded app version", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + "/api/version");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), appVersion);
  });
});
