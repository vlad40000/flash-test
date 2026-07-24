import { describe, expect, it } from 'vitest';
import { CONCURRENCY, MAX_OUTPUT_TOKENS, MODELS, TEMPERATURES, THINKING_LEVELS, TOP_P } from '@/types';

describe('locked benchmark contract', () => {
  it('top-P is always 0.95', () => {
    expect(TOP_P).toBe(0.95);
  });

  it('maximum output tokens is always 65536', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(65_536);
  });

  it('concurrency (max simultaneous provider calls) is always 4', () => {
    expect(CONCURRENCY).toBe(4);
  });

  it('only the two approved models are ever in scope', () => {
    expect(MODELS).toEqual(['gemini-3.5-flash', 'gemini-3.1-pro-preview']);
  });

  it('only the four approved temperatures are ever in scope', () => {
    expect(TEMPERATURES).toEqual([0.2, 0.4, 0.8, 1.0]);
  });

  it('only the three approved thinking levels are ever in scope — no "minimal"', () => {
    expect(THINKING_LEVELS).toEqual(['low', 'medium', 'high']);
    expect(THINKING_LEVELS as readonly string[]).not.toContain('minimal');
  });
});
