const fs = require("fs");
const path = require("path");

const FALLBACK_VERSION_INFO = Object.freeze({
  version: "dev",
  revision: "",
  displayVersion: "dev"
});
const VERSION_FILE_PATH = path.join(__dirname, "generated", "version.json");

function cloneFallbackVersionInfo() {
  return { ...FALLBACK_VERSION_INFO };
}

function normalizeVersionInfo(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const version =
    typeof candidate.version === "string" ? candidate.version.trim() : "";
  const revision =
    typeof candidate.revision === "string" ? candidate.revision.trim() : "";
  const displayVersion =
    typeof candidate.displayVersion === "string"
      ? candidate.displayVersion.trim()
      : "";

  if (!version || !displayVersion) {
    return null;
  }

  return {
    version,
    revision,
    displayVersion
  };
}

function loadVersionInfo(filePath = VERSION_FILE_PATH) {
  try {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const parsedContent = JSON.parse(rawContent);
    return normalizeVersionInfo(parsedContent) || cloneFallbackVersionInfo();
  } catch (error) {
    return cloneFallbackVersionInfo();
  }
}

const appVersion = Object.freeze(loadVersionInfo());

module.exports = {
  FALLBACK_VERSION_INFO,
  VERSION_FILE_PATH,
  appVersion,
  loadVersionInfo
};
