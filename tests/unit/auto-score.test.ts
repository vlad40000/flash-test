import { describe, expect, it } from 'vitest';
import { autoScore, combineAutoAndManualScores } from '@/lib/auto-score';
import type { EvidenceRecord } from '@/types';

const goodStyle = {
  style_family: 'illustrative',
  rendering_finish: 'flat graphic',
  line_system: {
    quality: 'crisp',
    outer_weight: 'thick',
    interior_weight: 'medium',
    hierarchy: 'heavy outer contours with lighter interior divisions',
    edge_treatment: 'hard',
  },
  fill_system: {
    fill_behavior: 'opaque flat fields with visible ear fades',
    color_separation: 'hard-separated',
    gradient_policy: 'minimal',
  },
  shading_system: { method: 'smooth', coverage: 'minimal', contrast: 'high' },
  shape_system: {
    geometry_bias: 'mixed',
    proportion_treatment: 'exaggerated graphic proportions',
    silhouette_behavior: 'jagged radiating perimeter',
  },
  detail_system: {
    density: 'moderate',
    texture: 'digital smooth',
    interior_vs_exterior: 'dense interior accents within a readable outer silhouette',
  },
  palette_system: {
    color_mode: 'full-color',
    breadth: 'limited',
    saturation: 'saturated',
    value_contrast: 'high',
    colors: ['black', 'red', 'pink', 'blue', 'orange', 'white'],
    black_density: 'heavy',
  },
  composition_system: {
    negative_space: 'broad open canvas around a compact silhouette',
    background_treatment: 'transparent-canvas',
  },
  visible_hand_characteristics: '[X]',
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    theme_schema_version: 'flash_theme_v4',
    suggested_title: 'Bold Graphic Symmetry',
    style: goodStyle,
    theme: {
      territory: 'dark folkloric high-contrast graphic iconography',
      era_cues: '[X]',
      mood: 'bold, ominous',
    },
    quarantine: {
      subject_roles: ['bat'],
      identity_features: [
        'pointed ears',
        'spiky fur',
        'fangs',
        'teeth',
        'red tongue',
        'red mouth contour',
        'tri-lobe blue nose',
        'black pupils',
        'white brow arcs',
        'pink-to-red inner ears',
        'whisker-like lateral projections',
      ],
      clothing: [],
      props: [],
      symbols_and_text: ['blue diamond forehead mark'],
      pose_and_action: ['front-facing pose', 'open mouth'],
      setting: [],
      decorative_motifs: ['concentric eye rings', 'inner-ear line markings'],
      source_specific_concepts: ['vampiric'],
    },
    ...overrides,
  };
}

function withStyle(overrides: Record<string, unknown>) {
  return response({ style: { ...goodStyle, ...overrides } });
}

function machineEvidence(pixelFacts: unknown, quarantineRequirements?: unknown): EvidenceRecord {
  return {
    filename: 'test.png',
    pixelFacts,
    visualFacts: undefined,
    quarantineRequirements,
    ownerSignOffState: 'machine_verified',
    reviewDecision: null,
  };
}

const batEvidence: EvidenceRecord = {
  filename: 'bat__tattoo_1.png',
  pixelFacts: {
    background_treatment: {
      required: 'transparent-canvas',
      severity_if_wrong: 'major',
    },
    gradient_policy: {
      forbidden: ['none'],
      expected: ['minimal'],
      severity_if_forbidden: 'major',
    },
    interior_weight: {
      forbidden: ['none'],
      severity_if_forbidden: 'major',
    },
    geometry_bias: {
      expected: ['mixed'],
      defensible: ['mixed'],
      severity_if_other: 'moderate',
    },
    density: {
      expected: ['moderate'],
      defensible: ['moderate', 'high'],
      severity_if_other: 'moderate',
    },
    edge_treatment: {
      expected: ['hard'],
      severity_if_other: 'minor',
    },
    color_mode: {
      required: 'full-color',
      severity_if_wrong: 'major',
    },
    colors_must_include: {
      terms: ['black', 'red', 'pink'],
    },
    black_density_range: {
      acceptable_words: ['heavy', 'dominant', 'high'],
      forbidden_numeric_below: 55,
      forbidden_numeric_above: 75,
      severity_if_wrong: 'minor',
    },
    visible_hand_characteristics: {
      expected: '[X]',
      severity_if_invented: 'moderate',
    },
    quarantine_inventory: {
      items: [
        'bat',
        'pointed ears',
        'spiky fur / jagged fur',
        'fangs',
        'teeth',
        'red tongue',
        'red mouth contour',
        'tri-lobe blue nose',
        'blue diamond forehead mark',
        'concentric eye rings',
        'black pupils',
        'white brow arcs',
        'inner-ear line markings',
        'pink-to-red inner ears',
        'whisker-like lateral projections',
        'front-facing pose',
        'open mouth',
      ],
      unsupported_concepts: ['halloween', 'nocturnal', 'spooky', 'demonic', 'gothic'],
      coverage_thresholds: { good: 0.6, weak: 0.35 },
    },
  },
  ownerSignOffState: 'machine_verified',
  reviewDecision: null,
};

describe('autoScore', () => {
  it('gives a complete high score to an evidence-aligned response', () => {
    const result = autoScore({ parsedJson: response(), schemaValid: true, evidence: batEvidence });
    expect(result.schemaClean).toBe(true);
    expect(result.autoTotal).toBe(80);
    expect(result.eligibleForRanking).toBe(true);
    expect(result.scores.visibleFactualAccuracy).toBe(20);
  });

  it('marks non-schema categories null/unscorable when JSON is unparseable', () => {
    const result = autoScore({ parsedJson: null, schemaValid: false, evidence: batEvidence });
    expect(result.scores.schemaContractCompliance).toBe(0);
    expect(result.scores.visibleFactualAccuracy).toBeNull();
    expect(result.scores.styleSystemAccuracy).toBeNull();
    expect(result.scores.quarantineQuality).toBeNull();
    expect(result.autoTotal).toBeNull();
    expect(result.autoMaxScored).toBe(20);
    expect(result.eligibleForRanking).toBe(false);
    expect(result.ledger[0]?.severity).toBe('fatal');
  });

  it('charges a visible gradient denial exactly once', () => {
    const bad = withStyle({
      fill_system: { ...goodStyle.fill_system, gradient_policy: 'none' },
      shading_system: { method: 'none', coverage: 'none', contrast: 'n-a' },
    });
    const result = autoScore({ parsedJson: bad, schemaValid: true, evidence: batEvidence });
    const gradientDeductions = result.ledger.filter((entry) =>
      entry.field.includes('gradient_policy') || entry.deductionKey.includes('gradient-policy'),
    );
    expect(gradientDeductions).toHaveLength(1);
    expect(result.scores.visibleFactualAccuracy).toBe(14);
  });

  it('supports array-valued color_mode_defensible facts', () => {
    const evidence = machineEvidence({
      color_mode_defensible: ['black-and-grey', 'monochrome'],
    });

    const accepted = autoScore({
      parsedJson: withStyle({
        palette_system: { ...goodStyle.palette_system, color_mode: 'black-and-grey' },
      }),
      schemaValid: true,
      evidence,
    });
    expect(accepted.scores.visibleFactualAccuracy).toBe(20);

    const moderateBoundaryError = autoScore({
      parsedJson: withStyle({
        palette_system: { ...goodStyle.palette_system, color_mode: 'full-color' },
      }),
      schemaValid: true,
      evidence,
    });
    expect(moderateBoundaryError.scores.visibleFactualAccuracy).toBe(17);
  });

  it('supports array-valued background_treatment_defensible facts', () => {
    const evidence = machineEvidence({
      background_treatment_defensible: ['neutral-flat-canvas', '[X]'],
    });

    const accepted = autoScore({
      parsedJson: withStyle({
        composition_system: { ...goodStyle.composition_system, background_treatment: '[X]' },
      }),
      schemaValid: true,
      evidence,
    });
    expect(accepted.scores.visibleFactualAccuracy).toBe(20);

    const rejected = autoScore({
      parsedJson: withStyle({
        composition_system: { ...goodStyle.composition_system, background_treatment: 'white-canvas' },
      }),
      schemaValid: true,
      evidence,
    });
    expect(rejected.scores.visibleFactualAccuracy).toBe(14);
  });

  it('hard-gates authored visual facts on owner approval', () => {
    const pending: EvidenceRecord = {
      filename: 'visual.png',
      pixelFacts: {},
      visualFacts: { gradient_policy: 'smooth' },
      ownerSignOffState: 'visual_pending_owner_signoff',
      reviewDecision: null,
    };
    const bad = withStyle({ fill_system: { ...goodStyle.fill_system, gradient_policy: 'none' } });

    const skipped = autoScore({ parsedJson: bad, schemaValid: true, evidence: pending });
    expect(skipped.scores.visibleFactualAccuracy).toBeNull();
    expect(skipped.notes.join(' ')).toContain('visual evidence skipped');

    const approved = autoScore({
      parsedJson: bad,
      schemaValid: true,
      evidence: { ...pending, reviewDecision: 'approved' },
    });
    expect(approved.scores.visibleFactualAccuracy).toBe(17);
  });

  it('does not let generic quarantine words prove inventory coverage', () => {
    const evidence = machineEvidence({}, ['red-black-white band pattern']);
    const bad = response({
      quarantine: {
        subject_roles: [],
        identity_features: [],
        clothing: [],
        props: [],
        symbols_and_text: [],
        pose_and_action: [],
        setting: [],
        decorative_motifs: ['pattern'],
        source_specific_concepts: [],
      },
    });
    const result = autoScore({ parsedJson: bad, schemaValid: true, evidence });
    expect(result.ledger.some((entry) => entry.deductionKey === 'quarantine:coverage')).toBe(true);
    expect(result.scores.quarantineQuality).toBe(14);
  });

  it('accepts a distinctive quarantine token group rather than requiring verbatim phrasing', () => {
    const evidence = machineEvidence({}, ['red-black-white band pattern']);
    const covered = response({
      quarantine: {
        subject_roles: [],
        identity_features: ['red black white banding'],
        clothing: [],
        props: [],
        symbols_and_text: [],
        pose_and_action: [],
        setting: [],
        decorative_motifs: [],
        source_specific_concepts: [],
      },
    });
    const result = autoScore({ parsedJson: covered, schemaValid: true, evidence });
    expect(result.ledger.some((entry) => entry.deductionKey === 'quarantine:coverage')).toBe(false);
    expect(result.scores.quarantineQuality).toBe(20);
  });

  it('implements style-family, breadth, interior-weight, and black-density checks', () => {
    const evidence: EvidenceRecord = {
      filename: 'style.png',
      pixelFacts: {
        interior_weight: { forbidden: ['none'], severity_if_forbidden: 'major' },
        black_density_range: {
          acceptable_words: ['heavy', 'dominant'],
          forbidden_numeric_below: 55,
          forbidden_numeric_above: 75,
          severity_if_wrong: 'minor',
        },
      },
      visualFacts: {
        style_family_defensible: ['traditional', 'neo-traditional'],
        breadth: 'limited',
      },
      reviewDecision: 'approved',
      ownerSignOffState: 'owner_reviewed',
    };

    const bad = withStyle({
      style_family: 'illustrative',
      line_system: { ...goodStyle.line_system, interior_weight: 'none' },
      palette_system: { ...goodStyle.palette_system, breadth: 'broad', black_density: '20%' },
    });
    const result = autoScore({ parsedJson: bad, schemaValid: true, evidence });
    expect(result.ledger.some((entry) => entry.field.endsWith('style_family'))).toBe(true);
    expect(result.ledger.some((entry) => entry.field.endsWith('interior_weight'))).toBe(true);
    expect(result.ledger.some((entry) => entry.field.endsWith('breadth'))).toBe(true);
    expect(result.ledger.some((entry) => entry.field.endsWith('black_density'))).toBe(true);
  });

  it('marks parsed schema-invalid responses ineligible for ranking', () => {
    const result = autoScore({ parsedJson: response(), schemaValid: false, evidence: batEvidence });
    expect(result.eligibleForRanking).toBe(false);
    expect(result.scores.schemaContractCompliance).toBe(14);
    expect(result.autoTotal).not.toBeNull();
    expect(result.rankingIneligibilityReasons).toContain('JSON Schema validation failed');
  });

  it('leaves non-schema categories unscorable when evidence is absent', () => {
    const result = autoScore({ parsedJson: response(), schemaValid: true, evidence: null });
    expect(result.scores.schemaContractCompliance).toBe(20);
    expect(result.scores.visibleFactualAccuracy).toBeNull();
    expect(result.scores.styleSystemAccuracy).toBeNull();
    expect(result.scores.quarantineQuality).toBeNull();
    expect(result.autoTotal).toBeNull();
  });
});

describe('combineAutoAndManualScores', () => {
  it('uses human theme/uncertainty and explicit manual overrides without averaging sources', () => {
    const auto = autoScore({ parsedJson: response(), schemaValid: true, evidence: batEvidence });
    const combined = combineAutoAndManualScores({
      auto,
      manualScores: {
        visibleFactualAccuracy: 18,
        themeAbstractionQuality: 14,
        uncertaintyDiscipline: 4,
      },
    });

    expect(combined.autoScore).toBe(80);
    expect(combined.resolvedObjectiveScore).toBe(78);
    expect(combined.humanJudgmentScore).toBe(18);
    expect(combined.combinedScore).toBe(96);
    expect(combined.scoreSources.visibleFactualAccuracy).toBe('manual-override');
    expect(combined.eligibleForRanking).toBe(true);
  });

  it('keeps the combined score null when an unscorable objective category has no manual fallback', () => {
    const auto = autoScore({ parsedJson: response(), schemaValid: true, evidence: null });
    const combined = combineAutoAndManualScores({
      auto,
      manualScores: {
        themeAbstractionQuality: 15,
        uncertaintyDiscipline: 5,
      },
    });
    expect(combined.resolvedObjectiveScore).toBeNull();
    expect(combined.combinedScore).toBeNull();
    expect(combined.eligibleForRanking).toBe(false);
  });

  it('allows manual fallback for an unscorable objective category without overriding schema eligibility', () => {
    const auto = autoScore({ parsedJson: response(), schemaValid: true, evidence: null });
    const combined = combineAutoAndManualScores({
      auto,
      manualScores: {
        visibleFactualAccuracy: 20,
        styleSystemAccuracy: 20,
        quarantineQuality: 20,
        themeAbstractionQuality: 15,
        uncertaintyDiscipline: 5,
      },
    });
    expect(combined.resolvedObjectiveScore).toBe(80);
    expect(combined.combinedScore).toBe(100);
    expect(combined.eligibleForRanking).toBe(true);
  });
});
