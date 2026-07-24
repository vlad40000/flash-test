import {
  BenchmarkJob,
  BenchmarkModel,
  BenchmarkTemperature,
  MODELS,
  TEMPERATURES,
  THINKING_LEVELS,
  ThinkingLevel,
  TOP_P,
} from '@/types';
import { seededShuffle } from './rng';

export function cellId(temperature: BenchmarkTemperature, thinking: ThinkingLevel, trial: number): string {
  return `temp-${temperature}__thinking-${thinking}__trial-${trial}`;
}

export function jobId(
  experimentId: string,
  model: BenchmarkModel,
  temperature: BenchmarkTemperature,
  thinking: ThinkingLevel,
  trial: number
): string {
  return `${experimentId}__${model}__temp-${temperature}__thinking-${thinking}__trial-${trial}`;
}

export interface CellDescriptor {
  cellId: string;
  temperature: BenchmarkTemperature;
  thinkingLevel: ThinkingLevel;
  trial: number;
}

/** All (temperature x thinking x trial) cells for one experiment, in canonical (unshuffled) order. */
export function buildCells(trials: number): CellDescriptor[] {
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error('trials must be a positive integer');
  }
  const cells: CellDescriptor[] = [];
  for (let trial = 1; trial <= trials; trial++) {
    for (const temperature of TEMPERATURES) {
      for (const thinkingLevel of THINKING_LEVELS) {
        cells.push({ cellId: cellId(temperature, thinkingLevel, trial), temperature, thinkingLevel, trial });
      }
    }
  }
  return cells;
}

/**
 * Generates the exact job matrix for one experiment: 2 models x 4 temperatures x 3 thinking
 * levels x `trials`, scheduled as paired cells (both models for a cell run adjacently) with
 * cell order shuffled deterministically by `seed`.
 */
export function generateJobMatrix(experimentId: string, trials: number, seed: number): BenchmarkJob[] {
  const cells = buildCells(trials);
  const shuffled = seededShuffle(cells, seed);

  const jobs: BenchmarkJob[] = [];
  shuffled.forEach((cell, cellIndex) => {
    const waveNumber = Math.floor(cellIndex / 2) + 1;
    for (const model of MODELS) {
      jobs.push({
        id: jobId(experimentId, model, cell.temperature, cell.thinkingLevel, cell.trial),
        experimentId,
        model,
        temperature: cell.temperature,
        topP: TOP_P,
        thinkingLevel: cell.thinkingLevel,
        trial: cell.trial,
        cellId: cell.cellId,
        waveNumber,
        status: 'queued',
        queuedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        workerNumber: null,
        queuePosition: 0,
      });
    }
  });

  jobs.forEach((job, index) => {
    job.queuePosition = index;
  });

  return jobs;
}

export function expectedJobCount(trials: number): number {
  return MODELS.length * TEMPERATURES.length * THINKING_LEVELS.length * trials;
}
