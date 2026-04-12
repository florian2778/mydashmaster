const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePreviewLayout,
  summarizePreviewTree
} = require("../src/admin/layout-preview");

function approxEqual(actual, expected, epsilon = 0.001) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

function getChild(node, index) {
  return node.children[index];
}

test("preview resolves 60% / 40% in a row", () => {
  const layout = resolvePreviewLayout(
    {
      type: "row",
      children: [
        { type: "box", box: "box1", size: "60%" },
        { type: "box", box: "box2", size: "40%" }
      ]
    },
    new Set(["box1", "box2"]),
    1000,
    500
  );

  approxEqual(getChild(layout, 0).rect.width, 600);
  approxEqual(getChild(layout, 1).rect.width, 400);
});

test("preview resolves 160px + 1fr after subtracting gap", () => {
  const layout = resolvePreviewLayout(
    {
      type: "row",
      gap: "10px",
      children: [
        { type: "box", box: "box1", size: "160px" },
        { type: "box", box: "box2", size: "1fr" }
      ]
    },
    new Set(["box1", "box2"]),
    1000,
    500
  );

  approxEqual(getChild(layout, 0).rect.width, 160);
  approxEqual(getChild(layout, 1).rect.x, 170);
  approxEqual(getChild(layout, 1).rect.width, 830);
});

test("preview resolves 35% + 65% in a row", () => {
  const layout = resolvePreviewLayout(
    {
      type: "row",
      children: [
        { type: "box", box: "box1", size: "35%" },
        { type: "box", box: "box2", size: "65%" }
      ]
    },
    new Set(["box1", "box2"]),
    1000,
    500
  );

  approxEqual(getChild(layout, 0).rect.width, 350);
  approxEqual(getChild(layout, 1).rect.width, 650);
});

test("preview resolves nested row/column recursively", () => {
  const layout = resolvePreviewLayout(
    {
      type: "row",
      children: [
        {
          type: "column",
          size: "70%",
          children: [
            { type: "box", box: "box1", size: "160px" },
            { type: "box", box: "box2", size: "1fr" }
          ]
        },
        { type: "box", box: "box3", size: "30%" }
      ]
    },
    new Set(["box1", "box2", "box3"]),
    1000,
    500
  );

  const leftColumn = getChild(layout, 0);
  const topBox = getChild(leftColumn, 0);
  const bottomBox = getChild(leftColumn, 1);

  approxEqual(leftColumn.rect.width, 700);
  approxEqual(topBox.rect.height, 160);
  approxEqual(bottomBox.rect.y, 160);
  approxEqual(bottomBox.rect.height, 340);
});

test("preview resolves px + % + fr in one container", () => {
  const layout = resolvePreviewLayout(
    {
      type: "row",
      children: [
        { type: "box", box: "box1", size: "200px" },
        { type: "box", box: "box2", size: "30%" },
        { type: "box", box: "box3", size: "1fr" }
      ]
    },
    new Set(["box1", "box2", "box3"]),
    1000,
    500
  );

  approxEqual(getChild(layout, 0).rect.width, 200);
  approxEqual(getChild(layout, 1).rect.width, 300);
  approxEqual(getChild(layout, 2).rect.width, 500);
});

test("preview summary detects overflow", () => {
  const layout = resolvePreviewLayout(
    {
      type: "row",
      children: [
        { type: "box", box: "box1", size: "700px" },
        { type: "box", box: "box2", size: "50%" }
      ]
    },
    new Set(["box1", "box2"]),
    1000,
    500
  );

  const summary = summarizePreviewTree(layout);

  assert.equal(summary.hasOverflow, true);
  assert.equal(summary.invalidBoxCount, 0);
});
