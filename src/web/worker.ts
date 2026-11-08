/**
 * Generation runs off the main thread.
 *
 * A reaction-diffusion piece is several seconds of tight numeric loops; doing
 * that inline freezes the page, including the status text that would explain
 * why. The worker keeps the UI responsive and lets the button show progress.
 */

import { generate, type GenerateRequest } from '../core/generate';
import type { Scene } from '../core/types';

export interface WorkerRequest extends GenerateRequest {
  id: number;
}

export type WorkerResponse =
  | { id: number; ok: true; scene: Scene; elapsedMs: number }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, ...request } = event.data;
  const started = performance.now();
  try {
    const scene = generate(request);
    const response: WorkerResponse = {
      id,
      ok: true,
      scene,
      elapsedMs: Math.round(performance.now() - started),
    };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
