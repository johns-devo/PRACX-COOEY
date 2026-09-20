import assert from "node:assert/strict";
import test from "node:test";

/** Mirror of OperationsWorkspace buildReviewOfSystemsText for focused regression coverage. */
function buildReviewOfSystemsText(document) {
  const normals = (document.rosNormalSystems || []).map((system) => `${system.replaceAll("_", " ")}: Normal.`);
  const findings = (document.rosSelections || []).map((item) => `${item.system.replaceAll("_", " ")}: ${item.status === "negative" ? "Denies" : "Reports"} ${item.symptom.toLowerCase()}${item.note ? ` (${item.note})` : ""}.`);
  return [...normals, ...findings].join("\n");
}

function applySymptomFinding(document, system, selection) {
  const nextSelections = [...(document.rosSelections || []).filter((item) => item.id !== selection.id), selection];
  const nextNormals = (document.rosNormalSystems || []).filter((item) => item !== system);
  return { rosSelections: nextSelections, rosNormalSystems: nextNormals };
}

test("ROS text keeps normals and findings together", () => {
  const text = buildReviewOfSystemsText({
    rosNormalSystems: ["constitutional", "eyes"],
    rosSelections: [{ id: "cough", system: "respiratory", symptom: "Cough", status: "positive", note: "dry" }],
  });
  assert.match(text, /constitutional: Normal\./i);
  assert.match(text, /eyes: Normal\./i);
  assert.match(text, /respiratory: Reports cough \(dry\)\./i);
});

test("selecting a finding clears the matching system-normal flag", () => {
  const next = applySymptomFinding(
    {
      rosNormalSystems: ["respiratory", "eyes"],
      rosSelections: [],
    },
    "respiratory",
    { id: "wheeze", system: "respiratory", symptom: "Wheezing", status: "positive" },
  );
  assert.deepEqual(next.rosNormalSystems, ["eyes"]);
  assert.equal(next.rosSelections.length, 1);
  const text = buildReviewOfSystemsText(next);
  assert.doesNotMatch(text, /respiratory: Normal/i);
  assert.match(text, /respiratory: Reports wheezing/i);
});
