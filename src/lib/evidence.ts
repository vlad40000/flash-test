import { EvidenceRecord, EvidenceReviewDecision } from '@/types';

interface AggregateSuiteImage {
  file?: unknown;
  role?: unknown;
  pixel?: unknown;
  visual?: unknown;
}

function normalizeAggregateImage(image: AggregateSuiteImage): EvidenceRecord {
  if (typeof image.file !== 'string' || image.file.trim().length === 0) {
    throw new Error('each evidence-suite images entry must contain a non-empty "file" string');
  }
  const visual = image.visual && typeof image.visual === 'object' ? (image.visual as Record<string, unknown>) : {};
  const quarantineRequirements = visual.quarantine_must_capture ?? visual.quarantineRequirements;
  const discriminationTarget = visual.discrimination_target ?? visual.discriminationTarget;

  return {
    filename: image.file,
    role: typeof image.role === 'string' ? image.role : undefined,
    pixelFacts: image.pixel,
    visualFacts: image.visual,
    quarantineRequirements,
    discriminationTarget,
    ownerSignOffState: image.visual
      ? 'visual_pending_owner_signoff'
      : image.pixel
        ? 'machine_verified'
        : 'not_approved',
    reviewDecision: null,
  };
}

/** Matches evidence-suite records to the active image by exact filename. */
export function matchEvidence(
  records: EvidenceRecord[],
  originalFilename: string,
  reviews: Record<string, EvidenceReviewDecision> = {}
): EvidenceRecord[] {
  return records
    .filter((record) => record.filename === originalFilename)
    .map((record) => ({ ...record, reviewDecision: reviews[record.filename] ?? record.reviewDecision ?? null }));
}

/**
 * Accepts all evidence shapes used by the supplied benchmark kit:
 * - the aggregate suite: { images: [{ file, role, pixel, visual }] }
 * - a normalized array of EvidenceRecord
 * - { records: EvidenceRecord[] }
 * - one legacy per-image evidence object: { image, facts, quarantine_inventory }
 */
export function parseEvidenceSuite(json: unknown): EvidenceRecord[] {
  if (Array.isArray(json)) return normalizeRecordArray(json);

  if (!json || typeof json !== 'object') {
    throw new Error('evidence JSON must be an object or array');
  }

  const object = json as Record<string, unknown>;

  if (Array.isArray(object.images)) {
    return object.images.map((image) => normalizeAggregateImage(image as AggregateSuiteImage));
  }

  if (Array.isArray(object.records)) {
    return normalizeRecordArray(object.records);
  }

  if (typeof object.image === 'string') {
    return [
      {
        filename: object.image,
        role: typeof object.role === 'string' ? object.role : undefined,
        pixelFacts: object.facts,
        visualFacts: object.visual,
        quarantineRequirements: object.quarantine_inventory,
        discriminationTarget: object.discrimination_target,
        ownerSignOffState: typeof object.verified_by === 'string' ? 'machine_verified' : 'not_approved',
        reviewDecision: null,
      },
    ];
  }

  throw new Error('unsupported evidence JSON shape; expected "images", "records", an array, or a per-image object');
}

function normalizeRecordArray(items: unknown[]): EvidenceRecord[] {
  return items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`evidence record ${index + 1} must be an object`);
    const record = item as Record<string, unknown>;
    const filename = record.filename ?? record.file ?? record.image;
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      throw new Error(`evidence record ${index + 1} is missing filename/file/image`);
    }
    return {
      filename,
      role: typeof record.role === 'string' ? record.role : undefined,
      pixelFacts: record.pixelFacts ?? record.pixel ?? record.facts,
      visualFacts: record.visualFacts ?? record.visual,
      quarantineRequirements:
        record.quarantineRequirements ?? record.quarantine_inventory ??
        (record.visual && typeof record.visual === 'object'
          ? (record.visual as Record<string, unknown>).quarantine_must_capture
          : undefined),
      discriminationTarget:
        record.discriminationTarget ?? record.discrimination_target ??
        (record.visual && typeof record.visual === 'object'
          ? (record.visual as Record<string, unknown>).discrimination_target
          : undefined),
      ownerSignOffState:
        typeof record.ownerSignOffState === 'string'
          ? record.ownerSignOffState
          : record.pixelFacts || record.pixel || record.facts
            ? 'machine_verified'
            : 'not_approved',
      reviewDecision: null,
    };
  });
}
