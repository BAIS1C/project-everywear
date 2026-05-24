// @ts-nocheck
/**
 * gener8Epithets — phase-keyed copy pool + shuffle-bag rotator for the
 * Gener8 generation progress strip.
 *
 * Rules of the voice (Strands / EWDS):
 *   • 2 to 6 words, terminal-grade, zero corporate cheer.
 *   • Never apologise for the wait; never address the user's impatience.
 *   • Mix diegetic studio vocab (fans, tape, stems) with latent/signal language.
 *   • No emoji, no em dashes.
 *
 * Rotation: shuffle-bag, never repeat the last 3 lines within a phase.
 * Swap cadence is enforced by the consumer (GenerationProgress).
 */

export type Gener8Phase =
  | 'queued'
  | 'warming'
  | 'running'
  | 'finishing'
  | 'analysing'
  | 'success'
  | 'failure';

const POOLS: Record<Gener8Phase, readonly string[]> = {
  queued: [
    'Holding in the rack.',
    'Waiting for a free GPU.',
    'Booking studio time.',
    'Line forms to the left.',
    'Engine cold-booting ahead of you.',
    'Track slotted. Standby.',
  ],
  warming: [
    'Fans spooling up.',
    'Model cache thawing.',
    'Loading weights. No rush.',
    'Compute allocated.',
    'Studio lights on.',
    'Pulling the XL checkpoint.',
    'Priming the diffusion schedule.',
    'Patching the signal chain.',
  ],
  running: [
    'Diffusing.',
    'Painting the waveform.',
    'Sampling the latent.',
    'Tuning the signal.',
    'Pressing the instrumental.',
    'Writing to disk in slow motion.',
    'Mixing in a dark room.',
    'Chasing the groove.',
    'Rendering the arrangement.',
    'Locking the tempo grid.',
    'Ironing the stems.',
    'Training the snare to behave.',
    'Bending the VAE into shape.',
  ],
  finishing: [
    'Bouncing the master.',
    'Encoding to audio.',
    'Final polish.',
    'Committing to tape.',
  ],
  analysing: [
    'Analysing waveform.',
    'Reading the peaks.',
    'Plotting the shape.',
    'Mapping amplitudes.',
  ],
  success: [
    'Track on the slab.',
    'Done. Press play.',
    'Signal clean.',
    'Out of the oven.',
  ],
  failure: [
    "Generation dropped out. Try again.",
    'Signal lost between nodes.',
    "That one didn't print. Retry.",
  ],
};

/** Look up the full pool for a phase (read-only). */
export function getEpithetPool(phase: Gener8Phase): readonly string[] {
  return POOLS[phase];
}

/**
 * Build a stateful shuffle-bag rotator for a phase.
 *
 * - Returns a `next()` fn that yields the next line.
 * - Never returns a line that sits in the most recent `memory` entries.
 * - Falls back to pure random when the pool is smaller than memory+1.
 *
 * Typical usage:
 *   const rot = makeRotator('running');
 *   const line = rot.next();  // different from the last 3 by default
 */
export function makeRotator(phase: Gener8Phase, memory: number = 3) {
  const pool = POOLS[phase];
  const recent: string[] = [];
  const safeMemory = Math.min(memory, Math.max(0, pool.length - 1));

  return {
    next(): string {
      if (pool.length === 0) return '';
      // Candidate pool = anything not in the last `safeMemory` picks.
      const blocked = new Set(recent.slice(-safeMemory));
      const candidates = pool.filter((l) => !blocked.has(l));
      const bag = candidates.length > 0 ? candidates : pool;
      const pick = bag[Math.floor(Math.random() * bag.length)];
      recent.push(pick);
      if (recent.length > safeMemory + 2) recent.shift();
      return pick;
    },
    /** Expose current pool size for consumers that want to pace themselves. */
    size: pool.length,
  };
}

/**
 * Format the queue-position copy when a song is queued.
 * Pulled out so the composite can inject the position number mid-string.
 */
export function queuedWithPosition(position: number): string {
  if (!Number.isFinite(position) || position <= 0) {
    return 'Queued. Standby.';
  }
  return `Queue position ${position}. Standby.`;
}
