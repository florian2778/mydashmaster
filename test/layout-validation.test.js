const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const { validateDevice, validateLayout } = require("../src/storage/validators");

const exampleLayoutsDir = path.join(__dirname, "..", "docs", "example-layouts");

function createBox(name) {
  return {
    name,
    url: `https://example.com/${name}`,
    zoom: 1
  };
}

function createValidLayout() {
  return {
    layoutId: "test-layout",
    options: {
      showHeader: false,
      showStatus: false,
      showLayoutTitle: true
    },
    structure: {
      type: "row",
      gap: "8px",
      children: [
        {
          type: "box",
          box: "box1",
          size: "50%"
        },
        {
          type: "box",
          box: "box2",
          size: "50%"
        }
      ]
    },
    boxes: [createBox("box1"), createBox("box2")]
  };
}

test("all example layouts pass without errors", async () => {
  const entries = await fs.readdir(exampleLayoutsDir);
  const fileNames = entries.filter((entry) => entry.endsWith(".json"));

  for (const fileName of fileNames) {
    const filePath = path.join(exampleLayoutsDir, fileName);
    const content = await fs.readFile(filePath, "utf8");
    const layout = JSON.parse(content);
    const result = validateLayout(layout);

    assert.deepEqual(
      result.errors,
      [],
      `${fileName} should have no validation errors`
    );
  }
});

test("revoked device status is allowed", () => {
  const result = validateDevice({
    deviceCode: "device-1",
    status: "revoked",
    layoutId: null
  });

  assert.deepEqual(result.errors, []);
});

test("invalid node type returns an error", () => {
  const layout = createValidLayout();
  layout.structure.type = "stack";

  const result = validateLayout(layout);

  assert.match(result.errors[0], /must be row, column, or box/);
});

test("invalid size format returns an error", () => {
  const layout = createValidLayout();
  layout.structure.children[0].size = "large";

  const result = validateLayout(layout);

  assert.match(result.errors[0], /must use %, px, or fr units/);
});

test("missing box reference returns an error", () => {
  const layout = createValidLayout();
  layout.structure.children[1].box = "missing-box";

  const result = validateLayout(layout);

  assert.match(result.errors[0], /references unknown box/);
});

test("box with children returns an error", () => {
  const layout = createValidLayout();
  layout.structure.children[0].children = [];

  const result = validateLayout(layout);

  assert.match(result.errors[0], /box nodes must not have children/);
});

test("row without children returns an error", () => {
  const layout = createValidLayout();
  layout.structure.children = [];

  const result = validateLayout(layout);

  assert.match(result.errors[0], /row nodes must have children/);
});

test("invalid options type returns an error", () => {
  const layout = createValidLayout();
  layout.options.showHeader = "no";

  const result = validateLayout(layout);

  assert.match(result.errors[0], /layout\.options\.showHeader: must be a boolean/);
});

test("invalid row gap format returns an error", () => {
  const layout = createValidLayout();
  layout.structure.gap = "1fr";

  const result = validateLayout(layout);

  assert.match(result.errors[0], /gap: must be a pixel value/);
});

test("box gap returns an error", () => {
  const layout = createValidLayout();
  layout.structure.children[0].gap = "8px";

  const result = validateLayout(layout);

  assert.match(result.errors[0], /box nodes must not define gap/);
});

test("percentage sum below 100% returns a warning", () => {
  const layout = createValidLayout();
  layout.structure.children[0].size = "40%";
  layout.structure.children[1].size = "40%";

  const result = validateLayout(layout);

  assert.equal(result.errors.length, 0);
  assert.match(result.warnings[0], /sum to 80% instead of 100%/);
});

test("percentage sum above 100% returns a warning", () => {
  const layout = createValidLayout();
  layout.structure.children[0].size = "70%";
  layout.structure.children[1].size = "50%";

  const result = validateLayout(layout);

  assert.equal(result.errors.length, 0);
  assert.match(result.warnings[0], /sum to 120% instead of 100%/);
});

test("unused boxes return a warning", () => {
  const layout = createValidLayout();
  layout.boxes.push(createBox("box3"));

  const result = validateLayout(layout);

  assert.equal(result.errors.length, 0);
  assert.match(result.warnings[0], /"box3" is unused/);
});
