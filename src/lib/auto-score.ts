import type { EvidenceRecord, ScoringCategoryKey } from '@/types';

/**
 * Deterministic scorer for FLASH-1 Theme Extraction responses.
 *
 * Scope:
 * - schema/contract compliance
 * - visible factual accuracy
 * - style-system accuracy
 * - quarantine quality
 *
 * Theme abstraction quality and uncertainty discipline remain human-scored.
 * The scorer never calls a provider, never writes files, and never mutates inputs.
 */

const SEVERITY = { minor: 1, moderate: 3, major: 6 } as const;
export type Severity = keyof typeof SEVERITY;

export const AUTO_SCORED_CATEGORIES = {
  schemaContractCompliance: 20,
  visibleFactualAccuracy: 20,
  styleSystemAccuracy: 20,
  quarantineQuality: 20,
} as const satisfies Partial<Record<ScoringCategoryKey, number>>;

export type AutoCategoryKey = keyof typeof AUTO_SCORED_CATEGORIES;
export type AutoCategoryScore = number | null;

export interface AutoScoreLedgerEntry {
  category: AutoCategoryKey;
  field: string;
  message: string;
  severity: Severity | 'fatal';
  deduction: number;
  deductionKey: string;
}

export interface AutoCategoryCoverage {
  status: 'machine-scored' | 'partially-machine-scored' | 'unscorable';
  checksRun: number;
  fields: string[];
}

export interface AutoScoreResult {
  /** Nullable means the category was not actually scorable from the available evidence. */
  scores: Record<AutoCategoryKey, AutoCategoryScore>;
  /** Sum out of 80 only when all four automatic categories are scorable. */
  autoTotal: number | null;
  /** Sum of the automatic category points that were actually scorable. */
  autoPointsScored: number;
  /** Maximum represented by the scorable automatic categories. */
  autoMaxScored: number;
  autoMax: 80;
  schemaClean: boolean;
  schemaValid: boolean;
  /** Schema-invalid or unparseable responses can never win a configuration ranking. */
  eligibleForRanking: boolean;
  rankingIneligibilityReasons: string[];
  coverage: Record<AutoCategoryKey, AutoCategoryCoverage>;
  ledger: AutoScoreLedgerEntry[];
  notes: string[];
}

export interface AutoScoreInput {
  parsedJson: unknown | null;
  schemaValid: boolean;
  evidence: EvidenceRecord | null;
}

export interface CombinedScoreInput {
  auto: AutoScoreResult;
  manualScores?: Partial<Record<ScoringCategoryKey, number>>;
}

export interface CombinedScoreResult {
  /** Raw complete machine total; null when any automatic category was unscorable. */
  autoScore: number | null;
  /** Objective 80-point score after manual overrides/fallbacks resolve missing auto categories. */
  resolvedObjectiveScore: number | null;
  /** Theme abstraction (15) + uncertainty discipline (5), both human-only. */
  humanJudgmentScore: number | null;
  combinedScore: number | null;
  scoreSources: Partial<Record<ScoringCategoryKey, 'automatic' | 'manual-override' | 'manual' | 'missing'>>;
  eligibleForRanking: boolean;
  rankingIneligibilityReasons: string[];
}

interface EnumFact {
  required: string | null;
  forbidden: string[];
  expected: string[];
  defensible: string[];
  evidence: string;
  severity: Severity | null;
}

interface ScoreState {
  rawScores: Record<AutoCategoryKey, number>;
  checks: Record<AutoCategoryKey, Set<string>>;
  ledger: AutoScoreLedgerEntry[];
  notes: string[];
  deductionKeys: Set<string>;
}

const OBJECTIVE_CATEGORIES: readonly AutoCategoryKey[] = [
  'schemaContractCompliance',
  'visibleFactualAccuracy',
  'styleSystemAccuracy',
  'quarantineQuality',
];

const HUMAN_CATEGORIES: readonly ScoringCategoryKey[] = [
  'themeAbstractionQuality',
  'uncertaintyDiscipline',
];

const CATEGORY_MAX: Record<ScoringCategoryKey, number> = {
  schemaContractCompliance: 20,
  visibleFactualAccuracy: 20,
  styleSystemAccuracy: 20,
  themeAbstractionQuality: 15,
  quarantineQuality: 20,
  uncertaintyDiscipline: 5,
};

const COVERAGE_STOPLIST = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with',
  'design', 'detail', 'details', 'element', 'elements', 'feature', 'features', 'form', 'forms',
  'line', 'lines', 'mark', 'marks', 'marking', 'markings', 'motif', 'motifs', 'pattern', 'patterns',
  'shape', 'shapes', 'band', 'bands', 'open', 'closed', 'large', 'small', 'prominent',
]);

const LEAK_STOPLIST = new Set([
  'concentric', 'circular', 'symmetrical', 'symmetric', 'front', 'facing', 'open',
  'large', 'small', 'sharp', 'pointed', 'white', 'black', 'red', 'blue', 'orange',
  'pink', 'green', 'yellow', 'lines', 'line', 'accent', 'accents', 'mark', 'marks',
  'marking', 'shape', 'shapes', 'solid', 'bright', 'dark', 'heavy', 'prominent',
  'wide', 'portrait', 'central', 'curved', 'rings', 'ring', 'spiky', 'jagged',
]);

const SUBJECT_CATEGORIES = [
  'subject_roles',
  'identity_features',
  'clothing',
  'props',
  'symbols_and_text',
  'setting',
] as const;

export function autoScore({ parsedJson, schemaValid, evidence }: AutoScoreInput): AutoScoreResult {
  const state = createState();
  markCheck(state, 'schemaContractCompliance', 'structured-output');

  if (parsedJson == null) {
    state.rawScores.schemaContractCompliance = 0;
    state.ledger.push({
      category: 'schemaContractCompliance',
      field: '(root)',
      message: 'no parsed JSON; non-schema automatic categories are unscorable',
      severity: 'fatal',
      deduction: 20,
      deductionKey: 'schema:unparseable',
    });
    return finalize(state, false, false, ['raw output is not valid JSON']);
  }

  if (!schemaValid) {
    addDeduction(
      state,
      'schemaContractCompliance',
      '(schema)',
      'output failed JSON Schema validation',
      'major',
      'schema:invalid',
    );
  } else {
    const root = asRecord(parsedJson);
    if (root.theme_schema_version !== 'flash_theme_v4') {
      addDeduction(
        state,
        'schemaContractCompliance',
        'theme_schema_version',
        'missing or wrong theme_schema_version',
        'moderate',
        'schema:theme-schema-version',
      );
    }

    const quarantine = asRecord(root.quarantine);
    for (const [key, value] of Object.entries(quarantine)) {
      if (Array.isArray(value) && value.some((term) => /^n\/?a$/i.test(String(term).trim()))) {
        addDeduction(
          state,
          'schemaContractCompliance',
          `quarantine.${key}`,
          '"n/a" placeholder; contract requires an empty array',
          'moderate',
          `schema:quarantine-placeholder:${key}`,
        );
      }
    }
  }

  if (!evidence) {
    state.notes.push('no evidence record matched this image; non-schema automatic categories are unscorable');
    return finalize(state, schemaValid, schemaValid, schemaValid ? [] : ['JSON Schema validation failed']);
  }

  const visualAvailable = isVisualApproved(evidence);
  if (hasVisualFacts(evidence) && !visualAvailable) {
    state.notes.push('authored visual evidence skipped because reviewDecision is not "approved"');
  }

  const json = asRecord(parsedJson);
  const quarantine = asRecord(json.quarantine);

  // ── visible factual accuracy ────────────────────────────────────────────────

  checkEnum(
    state,
    evidence,
    json,
    ['background_treatment', 'background_treatment_defensible'],
    'composition_system.background_treatment',
    ['transparent-canvas', 'white-canvas', 'neutral-flat-canvas', '[x]'],
    'visibleFactualAccuracy',
    'major',
  );

  checkEnum(
    state,
    evidence,
    json,
    ['gradient_policy'],
    'fill_system.gradient_policy',
    ['none', 'minimal', 'smooth', 'mixed', '[x]'],
    'visibleFactualAccuracy',
    'moderate',
  );

  checkEnum(
    state,
    evidence,
    json,
    ['color_mode', 'color_mode_defensible'],
    'palette_system.color_mode',
    ['monochrome', 'black-and-grey', 'full-color', '[x]'],
    'visibleFactualAccuracy',
    'moderate',
    (value, factValue) => {
      if (value === 'black-and-grey' && !allowedValues(factValue).includes('black-and-grey')) return 'major';
      if (factValue.required === 'full-color') return 'major';
      return factValue.severity ?? 'moderate';
    },
  );

  const mustInclude = includeTerms(evidence);
  if (mustInclude.length > 0) {
    markCheck(state, 'visibleFactualAccuracy', 'style.palette_system.colors');
    const colors = getPath(json, 'style.palette_system.colors');
    const joined = Array.isArray(colors) ? colors.map(String).join(' | ').toLowerCase() : '';
    for (const term of mustInclude) {
      if (!containsPhrase(joined, term)) {
        addDeduction(
          state,
          'visibleFactualAccuracy',
          'style.palette_system.colors',
          `missing color "${term}"`,
          'minor',
          `visible:missing-color:${term}`,
        );
      }
    }
  }

  // Intentionally no second shading+gradient deduction. A wrong gradient_policy is
  // one underlying visible-fact defect and is charged once above.

  // ── style-system accuracy ──────────────────────────────────────────────────

  checkEnum(
    state,
    evidence,
    json,
    ['style_family', 'style_family_defensible'],
    'style_family',
    ['traditional', 'neo-traditional', 'blackwork', 'fine line', 'illustrative', 'realism', 'japanese', 'tribal', 'dotwork', 'engraving', 'ornamental', 'cartoon', 'animation', 'other', '[x]'],
    'styleSystemAccuracy',
    'moderate',
  );

  checkEnum(
    state,
    evidence,
    json,
    ['interior_weight', 'interior_weight_defensible'],
    'line_system.interior_weight',
    ['none', 'thin', 'medium', 'thick', 'mixed', '[x]'],
    'styleSystemAccuracy',
    'major',
  );

  checkEnum(
    state,
    evidence,
    json,
    ['geometry_bias', 'geometry_bias_defensible'],
    'shape_system.geometry_bias',
    ['angular', 'rounded', 'organic', 'geometric', 'mixed', '[x]'],
    'styleSystemAccuracy',
    'moderate',
  );

  checkEnum(
    state,
    evidence,
    json,
    ['density', 'density_defensible'],
    'detail_system.density',
    ['minimal', 'moderate', 'high', 'dense', '[x]'],
    'styleSystemAccuracy',
    'moderate',
  );

  checkEnum(
    state,
    evidence,
    json,
    ['edge_treatment', 'edge_treatment_defensible'],
    'line_system.edge_treatment',
    ['hard', 'soft', 'mixed', '[x]'],
    'styleSystemAccuracy',
    'minor',
  );

  checkEnum(
    state,
    evidence,
    json,
    ['breadth', 'breadth_defensible'],
    'palette_system.breadth',
    ['n-a', 'limited', 'broad', '[x]'],
    'styleSystemAccuracy',
    'moderate',
  );

  checkEnum(
    state,
    evidence,
    json,
    ['texture', 'texture_defensible'],
    'detail_system.texture',
    ['none', 'film grain', 'paper grain', 'stipple texture', 'brushstroke', 'digital smooth', 'other', '[x]'],
    'styleSystemAccuracy',
    'moderate',
  );

  checkBlackDensity(state, evidence, json);
  checkVisibleHandCharacteristics(state, evidence, json);

  // ── quarantine quality ─────────────────────────────────────────────────────

  const allQuarantineEntries = Object.values(quarantine)
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((term) => String(term).toLowerCase());

  const unsupported = unsupportedConcepts(evidence);
  if (unsupported.length > 0) {
    markCheck(state, 'quarantineQuality', 'quarantine.unsupported-concepts');
    for (const concept of unsupported) {
      if (allQuarantineEntries.some((entry) => containsPhrase(entry, concept))) {
        addDeduction(
          state,
          'quarantineQuality',
          'quarantine.*',
          `unsupported/inferred concept "${concept}"`,
          'moderate',
          `quarantine:unsupported:${normalizePhrase(concept)}`,
        );
      }
    }
  }

  const requiredInventory = quarantineInventory(evidence);
  if (requiredInventory.length > 0) {
    markCheck(state, 'quarantineQuality', 'quarantine.required-inventory');
    const aliases = quarantineAliases(evidence);
    const covered = requiredInventory.filter((item) => isInventoryItemCovered(item, allQuarantineEntries, aliases));
    const ratio = covered.length / requiredInventory.length;
    const thresholds = quarantineCoverageThresholds(evidence);
    if (ratio < thresholds.weak) {
      addDeduction(
        state,
        'quarantineQuality',
        'quarantine.*',
        `coverage ${Math.round(ratio * 100)}% of required inventory — weak`,
        'major',
        'quarantine:coverage',
      );
    } else if (ratio < thresholds.good) {
      addDeduction(
        state,
        'quarantineQuality',
        'quarantine.*',
        `coverage ${Math.round(ratio * 100)}% of required inventory — incomplete`,
        'moderate',
        'quarantine:coverage',
      );
    }
  }

  // Universal output-contract checks are deterministic even when visual evidence is pending.
  markCheck(state, 'quarantineQuality', 'quarantine.cross-category-duplicates');
  const seen = new Map<string, string>();
  for (const [category, value] of Object.entries(quarantine)) {
    if (!Array.isArray(value)) continue;
    for (const term of value) {
      const normalized = normalizePhrase(String(term));
      if (!normalized) continue;
      const prior = seen.get(normalized);
      if (prior && prior !== category) {
        addDeduction(
          state,
          'quarantineQuality',
          `quarantine.${category}`,
          `"${term}" duplicates entry in ${prior}`,
          'minor',
          `quarantine:duplicate:${normalized}`,
        );
      } else {
        seen.set(normalized, category);
      }
    }
  }

  markCheck(state, 'quarantineQuality', 'quarantine.separation-leakage');
  checkSeparationLeakage(state, json, quarantine);

  const reasons = schemaValid ? [] : ['JSON Schema validation failed'];
  return finalize(state, schemaValid, schemaValid, reasons);
}

/**
 * Resolves the 100-point score without averaging competing sources.
 *
 * Precedence:
 * 1. A valid human value on an objective category is an explicit override.
 * 2. Otherwise use the automatic category value when scorable.
 * 3. Theme abstraction and uncertainty are always human-only.
 * 4. Missing categories keep the combined score null/unscorable.
 */
export function combineAutoAndManualScores({ auto, manualScores = {} }: CombinedScoreInput): CombinedScoreResult {
  const scoreSources: CombinedScoreResult['scoreSources'] = {};
  const reasons = [...auto.rankingIneligibilityReasons];

  let resolvedObjectiveScore = 0;
  let objectiveComplete = true;

  for (const category of OBJECTIVE_CATEGORIES) {
    const manual = validManualValue(category, manualScores[category]);
    if (manual != null) {
      resolvedObjectiveScore += manual;
      scoreSources[category] = 'manual-override';
      continue;
    }

    const automatic = auto.scores[category];
    if (automatic != null) {
      resolvedObjectiveScore += automatic;
      scoreSources[category] = 'automatic';
      continue;
    }

    objectiveComplete = false;
    scoreSources[category] = 'missing';
    reasons.push(`${category} is unscorable and has no manual override`);
  }

  let humanJudgmentScore = 0;
  let humanComplete = true;
  for (const category of HUMAN_CATEGORIES) {
    const manual = validManualValue(category, manualScores[category]);
    if (manual == null) {
      humanComplete = false;
      scoreSources[category] = 'missing';
      reasons.push(`${category} requires a human score`);
    } else {
      humanJudgmentScore += manual;
      scoreSources[category] = 'manual';
    }
  }

  const resolvedObjective = objectiveComplete ? resolvedObjectiveScore : null;
  const humanJudgment = humanComplete ? humanJudgmentScore : null;
  const combinedScore = resolvedObjective != null && humanJudgment != null
    ? resolvedObjective + humanJudgment
    : null;

  const eligibleForRanking = auto.eligibleForRanking && combinedScore != null;
  if (!auto.eligibleForRanking && reasons.length === 0) reasons.push('automatic score is ineligible for ranking');
  if (combinedScore == null && !reasons.includes('combined score is incomplete')) reasons.push('combined score is incomplete');

  return {
    autoScore: auto.autoTotal,
    resolvedObjectiveScore: resolvedObjective,
    humanJudgmentScore: humanJudgment,
    combinedScore,
    scoreSources,
    eligibleForRanking,
    rankingIneligibilityReasons: unique(reasons),
  };
}

// ── scoring helpers ──────────────────────────────────────────────────────────

function createState(): ScoreState {
  return {
    rawScores: {
      schemaContractCompliance: 20,
      visibleFactualAccuracy: 20,
      styleSystemAccuracy: 20,
      quarantineQuality: 20,
    },
    checks: {
      schemaContractCompliance: new Set<string>(),
      visibleFactualAccuracy: new Set<string>(),
      styleSystemAccuracy: new Set<string>(),
      quarantineQuality: new Set<string>(),
    },
    ledger: [],
    notes: [],
    deductionKeys: new Set<string>(),
  };
}

function markCheck(state: ScoreState, category: AutoCategoryKey, field: string): void {
  state.checks[category].add(field);
}

function addDeduction(
  state: ScoreState,
  category: AutoCategoryKey,
  field: string,
  message: string,
  severity: Severity,
  deductionKey: string,
): void {
  if (state.deductionKeys.has(deductionKey)) return;
  state.deductionKeys.add(deductionKey);
  markCheck(state, category, field);
  const deduction = SEVERITY[severity];
  state.rawScores[category] = Math.max(0, state.rawScores[category] - deduction);
  state.ledger.push({ category, field, message, severity, deduction, deductionKey });
}

function finalize(
  state: ScoreState,
  schemaValid: boolean,
  eligibleForRanking: boolean,
  ineligibilityReasons: string[],
): AutoScoreResult {
  const scores = {} as Record<AutoCategoryKey, AutoCategoryScore>;
  const coverage = {} as Record<AutoCategoryKey, AutoCategoryCoverage>;

  for (const category of OBJECTIVE_CATEGORIES) {
    const fields = Array.from(state.checks[category]);
    const scorable = fields.length > 0;
    scores[category] = scorable ? state.rawScores[category] : null;
    coverage[category] = {
      status: !scorable
        ? 'unscorable'
        : category === 'schemaContractCompliance'
          ? 'machine-scored'
          : 'partially-machine-scored',
      checksRun: fields.length,
      fields,
    };
  }

  const numeric = OBJECTIVE_CATEGORIES
    .map((category) => scores[category])
    .filter((value): value is number => typeof value === 'number');
  const autoPointsScored = numeric.reduce((sum, value) => sum + value, 0);
  const autoMaxScored = OBJECTIVE_CATEGORIES.reduce(
    (sum, category) => sum + (scores[category] == null ? 0 : AUTO_SCORED_CATEGORIES[category]),
    0,
  );
  const allScorable = OBJECTIVE_CATEGORIES.every((category) => scores[category] != null);
  const schemaClean = scores.schemaContractCompliance === 20;

  return {
    scores,
    autoTotal: allScorable ? autoPointsScored : null,
    autoPointsScored,
    autoMaxScored,
    autoMax: 80,
    schemaClean,
    schemaValid,
    eligibleForRanking,
    rankingIneligibilityReasons: unique(ineligibilityReasons),
    coverage,
    ledger: state.ledger,
    notes: state.notes,
  };
}

function checkEnum(
  state: ScoreState,
  evidence: EvidenceRecord,
  json: unknown,
  factKeys: string[],
  stylePath: string,
  vocab: string[],
  category: AutoCategoryKey,
  defaultSeverity: Severity,
  severityResolver?: (value: string, factValue: EnumFact) => Severity,
): void {
  const factValue = firstEnumFact(evidence, factKeys, vocab);
  const outputValue = styleEnum(json, stylePath);
  if (!factValue || !outputValue) return;

  const fullPath = `style.${stylePath}`;
  markCheck(state, category, fullPath);
  const value = outputValue.toLowerCase();
  const allowed = allowedValues(factValue);

  if (factValue.required && value !== factValue.required) {
    addDeduction(
      state,
      category,
      fullPath,
      `"${outputValue}" — evidence requires "${factValue.required}"`,
      severityResolver?.(value, factValue) ?? factValue.severity ?? 'major',
      `${category}:${stylePath}:wrong-enum`,
    );
    return;
  }

  if (factValue.forbidden.includes(value)) {
    addDeduction(
      state,
      category,
      fullPath,
      `"${outputValue}" is forbidden by evidence${factValue.evidence ? ` (${factValue.evidence})` : ''}`,
      severityResolver?.(value, factValue) ?? factValue.severity ?? defaultSeverity,
      `${category}:${stylePath}:wrong-enum`,
    );
    return;
  }

  if (allowed.length > 0 && !allowed.includes(value)) {
    addDeduction(
      state,
      category,
      fullPath,
      `"${outputValue}" — evidence supports ${JSON.stringify(allowed)}`,
      severityResolver?.(value, factValue) ?? factValue.severity ?? defaultSeverity,
      `${category}:${stylePath}:wrong-enum`,
    );
  }
}

function checkBlackDensity(state: ScoreState, evidence: EvidenceRecord, json: unknown): void {
  const raw = fact(evidence, 'black_density_range');
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return;

  const record = asRecord(raw);
  const acceptableWords = toLowerList(record.acceptable_words);
  const lowerBound = finiteNumber(record.forbidden_numeric_below);
  const upperBound = finiteNumber(record.forbidden_numeric_above);
  if (acceptableWords.length === 0 && lowerBound == null && upperBound == null) return;

  const value = styleEnum(json, 'palette_system.black_density');
  if (!value) return;
  markCheck(state, 'styleSystemAccuracy', 'style.palette_system.black_density');

  const low = value.toLowerCase();
  if (acceptableWords.some((word) => containsPhrase(low, word))) return;

  const numericValues = Array.from(low.matchAll(/\b(\d+(?:\.\d+)?)\s*%?/g)).map((match) => Number(match[1]));
  if (numericValues.length > 0) {
    const inRange = numericValues.some((number) => {
      if (lowerBound != null && number < lowerBound) return false;
      if (upperBound != null && number > upperBound) return false;
      return true;
    });
    if (inRange) return;
  }

  addDeduction(
    state,
    'styleSystemAccuracy',
    'style.palette_system.black_density',
    `"${value}" does not match the supported black-density range`,
    firstSeverity(record) ?? 'minor',
    'style:black-density-range',
  );
}

function checkVisibleHandCharacteristics(state: ScoreState, evidence: EvidenceRecord, json: unknown): void {
  const raw = fact(evidence, 'visible_hand_characteristics');
  if (raw == null) return;

  const record = asRecord(raw);
  const expected = typeof raw === 'string'
    ? raw.toLowerCase()
    : [record.expected, record.evidence].filter((value) => typeof value === 'string').join(' ').toLowerCase();
  if (!expected || !/\[x\]|clean digital|no wobble|controlled/.test(expected)) return;

  const value = getPath(json, 'style.visible_hand_characteristics');
  if (typeof value !== 'string') return;
  markCheck(state, 'styleSystemAccuracy', 'style.visible_hand_characteristics');
  if (value.trim() === '[X]') return;

  const severity = firstSeverity(record) ?? 'moderate';
  addDeduction(
    state,
    'styleSystemAccuracy',
    'style.visible_hand_characteristics',
    'invented hand characteristics where evidence requires [X]',
    severity,
    'style:visible-hand-characteristics',
  );
}

function checkSeparationLeakage(
  state: ScoreState,
  json: Record<string, unknown>,
  quarantine: Record<string, unknown>,
): void {
  const subjectWords = new Set(
    SUBJECT_CATEGORIES.flatMap((category) => {
      const value = quarantine[category];
      return Array.isArray(value) ? value : [];
    })
      .flatMap((term) => tokenize(String(term)))
      .filter((word) => word.length > 3 && !LEAK_STOPLIST.has(word)),
  );

  const style = asRecord(json.style);
  const theme = asRecord(json.theme);
  const proseFields: Array<[string, unknown]> = [
    ['suggested_title', json.suggested_title],
    ['theme.territory', theme.territory],
    ['theme.era_cues', theme.era_cues],
    ['theme.mood', theme.mood],
    ['style.line_system.hierarchy', getPath(style, 'line_system.hierarchy')],
    ['style.fill_system.fill_behavior', getPath(style, 'fill_system.fill_behavior')],
    ['style.shape_system.proportion_treatment', getPath(style, 'shape_system.proportion_treatment')],
    ['style.shape_system.silhouette_behavior', getPath(style, 'shape_system.silhouette_behavior')],
    ['style.detail_system.interior_vs_exterior', getPath(style, 'detail_system.interior_vs_exterior')],
    ['style.composition_system.negative_space', getPath(style, 'composition_system.negative_space')],
  ];

  for (const [field, raw] of proseFields) {
    if (typeof raw !== 'string') continue;
    const low = raw.toLowerCase();
    for (const word of subjectWords) {
      if (!containsWord(low, word)) continue;
      addDeduction(
        state,
        'quarantineQuality',
        field,
        `separation leak: quarantined subject word "${word}" appears in ${field}`,
        'moderate',
        `quarantine:leak:${field}:${word}`,
      );
      break;
    }
  }
}

// ── evidence helpers ─────────────────────────────────────────────────────────

function isVisualApproved(record: EvidenceRecord): boolean {
  return record.reviewDecision === 'approved';
}

function hasVisualFacts(record: EvidenceRecord): boolean {
  return Object.keys(asRecord(record.visualFacts)).length > 0;
}

/** Pixel facts always apply. Authored visual facts require explicit approval. */
function fact(record: EvidenceRecord, key: string): unknown {
  const pixel = asRecord(record.pixelFacts);
  if (key in pixel) return pixel[key];
  if (!isVisualApproved(record)) return undefined;
  const visual = asRecord(record.visualFacts);
  return key in visual ? visual[key] : undefined;
}

function firstEnumFact(record: EvidenceRecord, keys: string[], vocab: string[]): EnumFact | null {
  for (const key of keys) {
    const value = enumFact(record, key, vocab);
    if (value) return value;
  }
  return null;
}

function enumFact(record: EvidenceRecord, key: string, vocab: string[]): EnumFact | null {
  const raw = fact(record, key);
  if (raw == null) return null;

  if (Array.isArray(raw)) {
    const values = normalizeEnumValues(raw, vocab);
    return {
      required: null,
      forbidden: [],
      expected: key.endsWith('_defensible') ? [] : values,
      defensible: values,
      evidence: values.join(', '),
      severity: null,
    };
  }

  if (typeof raw === 'string') {
    const low = raw.toLowerCase();
    const values = extractAllEnums(low, vocab);
    return {
      required: null,
      forbidden: [],
      expected: key.endsWith('_defensible') ? [] : values,
      defensible: values,
      evidence: raw,
      severity: null,
    };
  }

  if (typeof raw === 'object') {
    const recordValue = asRecord(raw);
    const requiredRaw = typeof recordValue.required === 'string'
      ? normalizeEnumValue(recordValue.required, vocab)
      : null;
    return {
      required: requiredRaw,
      forbidden: normalizeEnumValues(recordValue.forbidden, vocab),
      expected: normalizeEnumValues(recordValue.expected, vocab),
      defensible: normalizeEnumValues(recordValue.defensible, vocab),
      evidence: typeof recordValue.evidence === 'string' ? recordValue.evidence : '',
      severity: firstSeverity(recordValue),
    };
  }

  return null;
}

function includeTerms(record: EvidenceRecord): string[] {
  const raw = fact(record, 'colors_must_include');
  if (Array.isArray(raw)) return raw.map((value) => String(value).toLowerCase());
  const object = asRecord(raw);
  return toLowerList(object.terms);
}

function unsupportedConcepts(record: EvidenceRecord): string[] {
  const output = new Set<string>();
  const structured = asRecord(fact(record, 'quarantine_inventory'));
  for (const item of toLowerList(structured.unsupported_concepts)) output.add(item);

  if (isVisualApproved(record) || !hasVisualFacts(record)) {
    const requirements = asRecord(record.quarantineRequirements);
    for (const item of toLowerList(requirements.unsupported_concepts)) output.add(item);
  }

  const direct = fact(record, 'unsupported_concepts');
  for (const item of toLowerList(direct)) output.add(item);
  return Array.from(output);
}

function quarantineInventory(record: EvidenceRecord): string[] {
  const structured = asRecord(fact(record, 'quarantine_inventory'));
  if (Array.isArray(structured.items)) return structured.items.map((value) => String(value).toLowerCase());

  if (hasVisualFacts(record) && !isVisualApproved(record)) return [];
  const requirements = record.quarantineRequirements;
  if (Array.isArray(requirements)) return requirements.map((value) => String(value).toLowerCase());
  const object = asRecord(requirements);
  if (Array.isArray(object.items)) return object.items.map((value) => String(value).toLowerCase());
  return toLowerList(fact(record, 'quarantine_must_capture'));
}

function quarantineAliases(record: EvidenceRecord): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  const structured = asRecord(fact(record, 'quarantine_inventory'));
  mergeAliases(aliases, structured.aliases);

  if (isVisualApproved(record) || !hasVisualFacts(record)) {
    mergeAliases(aliases, asRecord(record.quarantineRequirements).aliases);
  }
  return aliases;
}

function quarantineCoverageThresholds(record: EvidenceRecord): { good: number; weak: number } {
  const structured = asRecord(fact(record, 'quarantine_inventory'));
  const thresholds = asRecord(structured.coverage_thresholds);
  const good = finiteNumber(thresholds.good);
  const weak = finiteNumber(thresholds.weak);
  return {
    good: good != null && good >= 0 && good <= 1 ? good : 0.6,
    weak: weak != null && weak >= 0 && weak <= 1 ? weak : 0.35,
  };
}

function mergeAliases(target: Record<string, string[]>, raw: unknown): void {
  const object = asRecord(raw);
  for (const [key, value] of Object.entries(object)) {
    const list = Array.isArray(value) ? value.map((item) => String(item).toLowerCase()) : [];
    if (list.length > 0) target[normalizePhrase(key)] = list;
  }
}

// ── quarantine matching ──────────────────────────────────────────────────────

function isInventoryItemCovered(
  item: string,
  quarantineEntries: string[],
  aliases: Record<string, string[]>,
): boolean {
  const normalizedItem = normalizePhrase(item);
  const candidates = [item, ...(aliases[normalizedItem] ?? [])];

  for (const candidate of candidates) {
    const normalizedCandidate = normalizePhrase(candidate);
    if (!normalizedCandidate) continue;

    if (quarantineEntries.some((entry) => {
      const normalizedEntry = normalizePhrase(entry);
      return normalizedEntry === normalizedCandidate || normalizedEntry.includes(normalizedCandidate);
    })) {
      return true;
    }

    const alternatives = candidate.split(/\s+\/\s+|\//).map((part) => part.trim()).filter(Boolean);
    for (const alternative of alternatives) {
      const distinctive = tokenize(alternative).filter((token) => !COVERAGE_STOPLIST.has(token));
      if (distinctive.length === 0) continue;
      const requiredMatches = distinctive.length <= 2 ? distinctive.length : Math.ceil(distinctive.length * 0.75);
      if (quarantineEntries.some((entry) => {
        const entryTokens = new Set(tokenize(entry));
        const matched = distinctive.filter((token) => entryTokens.has(token)).length;
        return matched >= requiredMatches;
      })) {
        return true;
      }
    }
  }

  return false;
}

// ── general helpers ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getPath(object: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((current, key) => (
    current == null ? current : asRecord(current)[key]
  ), object);
}

function styleEnum(json: unknown, dotted: string): string | null {
  const value = getPath(json, `style.${dotted}`);
  return typeof value === 'string' ? value : null;
}

function toLowerList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).toLowerCase()) : [];
}

function firstSeverity(record: Record<string, unknown>): Severity | null {
  for (const key of [
    'severity_if_forbidden',
    'severity_if_wrong',
    'severity_if_other',
    'severity_if_invented',
    'severity',
  ]) {
    const value = record[key];
    if (value === 'minor' || value === 'moderate' || value === 'major') return value;
  }
  return null;
}

function allowedValues(factValue: EnumFact): string[] {
  return unique([...(factValue.required ? [factValue.required] : []), ...factValue.expected, ...factValue.defensible]);
}

function normalizeEnumValues(value: unknown, vocab: string[]): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.flatMap((item) => {
    const normalized = normalizeEnumValue(String(item), vocab);
    return normalized ? [normalized] : extractAllEnums(String(item).toLowerCase(), vocab);
  }));
}

function normalizeEnumValue(value: string, vocab: string[]): string | null {
  const low = value.trim().toLowerCase();
  return vocab.includes(low) ? low : null;
}

function extractAllEnums(text: string, vocab: string[]): string[] {
  return unique(vocab.filter((term) => containsPhrase(text, term)));
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\[\]-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizePhrase(value).replace(/-/g, ' ').split(' ').filter(Boolean);
}

function containsPhrase(haystack: string, needle: string): boolean {
  const normalizedHaystack = ` ${normalizePhrase(haystack)} `;
  const normalizedNeedle = normalizePhrase(needle);
  return normalizedNeedle.length > 0 && normalizedHaystack.includes(` ${normalizedNeedle} `);
}

function containsWord(haystack: string, word: string): boolean {
  return tokenize(haystack).includes(normalizePhrase(word));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validManualValue(category: ScoringCategoryKey, value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= CATEGORY_MAX[category]
    ? value
    : null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
