/**
 * Generation runs off the main thread.
 *
 * A reaction-diffusion piece is several seconds of tight numeric loops; doing
 * that inline freezes the page, including the status text that would explain
 * why. The worker keeps the UI responsive, and streams intermediate scenes so
 * you watch the pattern grow instead of staring at a spinner.
 */

import { generate, type GenerateRequest } from '../core/generate';
import type { Scene } from '../core/types';

export interface WorkerRequest extends GenerateRequest {
  id: number;
  /** Stream intermediate scenes while generating (reaction-diffusion only). */
  progressive?: boolean;
}

export type WorkerResponse =
  | { id: number; kind: 'progress'; scene: Scene; fraction: number }
  | { id: number; kind: 'done'; scene: Scene; elapsedMs: number }
  | { id: number; kind: 'error'; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, progressive, ...request } = event.data;
  const started = performance.now();

  const post = (message: WorkerResponse): void => {
    self.postMessage(message);
  };

  try {
    const scene = generate(
      request,
      progressive
        ? ({ scene: partial, fraction }) =>
            post({ id, kind: 'progress', scene: partial, fraction })
        : undefined,
    );
    post({ id, kind: 'done', scene, elapsedMs: Math.round(performance.now() - started) });
  } catch (error) {
    post({ id, kind: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
