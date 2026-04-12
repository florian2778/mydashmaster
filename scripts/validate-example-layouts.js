const fs = require("fs/promises");
const path = require("path");

const { validateLayout } = require("../src/storage/validators");

async function main() {
  const examplesDir = path.join(__dirname, "..", "docs", "example-layouts");
  const entries = await fs.readdir(examplesDir);
  const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));

  for (const fileName of jsonFiles) {
    const filePath = path.join(examplesDir, fileName);
    const content = await fs.readFile(filePath, "utf8");
    const layout = JSON.parse(content);
    const result = validateLayout(layout);

    console.log(fileName);

    if (result.errors.length === 0) {
      console.log("  errors: none");
    } else {
      result.errors.forEach((error) => console.log(`  error: ${error}`));
    }

    if (result.warnings.length === 0) {
      console.log("  warnings: none");
    } else {
      result.warnings.forEach((warning) => console.log(`  warning: ${warning}`));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
