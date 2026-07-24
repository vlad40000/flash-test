import { describe, expect, it } from 'vitest';
import { matchEvidence, parseEvidenceSuite } from '@/lib/evidence';

const aggregate = {
  suite_version: '1.0',
  images: [{
    file: 'sample.png', role: 'test image', pixel: { color_mode: 'full-color' },
    visual: { quarantine_must_capture: ['bat'], discrimination_target: 'gradient discipline' },
  }],
};

describe('evidence-suite parsing', () => {
  it('parses the supplied aggregate images shape', () => {
    const records = parseEvidenceSuite(aggregate);
    expect(records).toHaveLength(1);
    expect(records[0]?.filename).toBe('sample.png');
    expect(records[0]?.quarantineRequirements).toEqual(['bat']);
    expect(records[0]?.discriminationTarget).toBe('gradient discipline');
    expect(records[0]?.ownerSignOffState).toBe('visual_pending_owner_signoff');
  });

  it('matches the active image by exact filename and overlays owner review', () => {
    const records = parseEvidenceSuite(aggregate);
    expect(matchEvidence(records, 'sample.png', { 'sample.png': 'approved' })[0]?.reviewDecision).toBe('approved');
    expect(matchEvidence(records, 'SAMPLE.png')).toEqual([]);
  });

  it('parses a legacy per-image evidence file', () => {
    const records = parseEvidenceSuite({ image: 'bat.png', facts: { a: 1 }, quarantine_inventory: { items: ['bat'] }, verified_by: 'PIL' });
    expect(records[0]?.filename).toBe('bat.png');
    expect(records[0]?.ownerSignOffState).toBe('machine_verified');
  });
});
