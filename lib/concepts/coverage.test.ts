import assert from "node:assert/strict";
import test from "node:test";
import { validateConceptExtractCoverage } from "./coverage";

test("全入力 EvidenceRef に unit result が必須", () => {
  const ok = validateConceptExtractCoverage({
    evidenceRefs: ["M001:E01", "M001:E02"],
    units: [
      { evidenceRef: "M001:E01", disposition: "extracted", concepts: [{}] },
      { evidenceRef: "M001:E02", disposition: "skip", concepts: [] },
    ],
  });
  assert.equal(ok.ok, true);
});

test("missing Unit を検出する", () => {
  const result = validateConceptExtractCoverage({
    evidenceRefs: ["M001:E01", "M001:E02"],
    units: [
      { evidenceRef: "M001:E01", disposition: "skip", concepts: [] },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing_unit");
    assert.equal(result.detail, "M001:E02");
  }
});

test("duplicate Unit result を検出する", () => {
  const result = validateConceptExtractCoverage({
    evidenceRefs: ["M001:E01"],
    units: [
      { evidenceRef: "M001:E01", disposition: "skip", concepts: [] },
      { evidenceRef: "M001:E01", disposition: "uncertain", concepts: [] },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "duplicate_evidence_ref");
  }
});

test("unknown EvidenceRef を検出する", () => {
  const result = validateConceptExtractCoverage({
    evidenceRefs: ["M001:E01"],
    units: [
      { evidenceRef: "M001:E01", disposition: "skip", concepts: [] },
      { evidenceRef: "M099:E01", disposition: "skip", concepts: [] },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unknown_evidence_ref");
    assert.equal(result.detail, "M099:E01");
  }
});

test("extracted は 1〜3、skip / uncertain は Concept 0", () => {
  assert.equal(
    validateConceptExtractCoverage({
      evidenceRefs: ["M001:E01"],
      units: [{ evidenceRef: "M001:E01", disposition: "extracted", concepts: [] }],
    }).ok,
    false,
  );
  assert.equal(
    validateConceptExtractCoverage({
      evidenceRefs: ["M001:E01"],
      units: [
        {
          evidenceRef: "M001:E01",
          disposition: "extracted",
          concepts: [{}, {}, {}, {}],
        },
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateConceptExtractCoverage({
      evidenceRefs: ["M001:E01"],
      units: [
        { evidenceRef: "M001:E01", disposition: "skip", concepts: [{}] },
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateConceptExtractCoverage({
      evidenceRefs: ["M001:E01"],
      units: [
        { evidenceRef: "M001:E01", disposition: "uncertain", concepts: [{}] },
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateConceptExtractCoverage({
      evidenceRefs: ["M001:E01", "M001:E02", "M001:E03"],
      units: [
        { evidenceRef: "M001:E01", disposition: "extracted", concepts: [{}, {}] },
        { evidenceRef: "M001:E02", disposition: "skip", concepts: [] },
        { evidenceRef: "M001:E03", disposition: "uncertain", concepts: [] },
      ],
    }).ok,
    true,
  );
});
