export type TimeSignature = [number, number];

export function beatsPerBar(timeSignature: TimeSignature): number {
  return Math.max(1, timeSignature[0] || 4);
}

export function msPerBeat(tempoBpm: number): number {
  const bpm = Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 120;
  return 60000 / bpm;
}

export function msPerBar(tempoBpm: number, timeSignature: TimeSignature): number {
  return msPerBeat(tempoBpm) * beatsPerBar(timeSignature);
}

export function barsToMs(bars: number, tempoBpm: number, timeSignature: TimeSignature): number {
  return Math.round(Math.max(0, bars) * msPerBar(tempoBpm, timeSignature));
}

export function msToBarBeatTick(
  ms: number,
  tempoBpm: number,
  timeSignature: TimeSignature,
  ppqn = 960,
): { bar: number; beat: number; tick: number } {
  const beatMs = msPerBeat(tempoBpm);
  const beatIndex = Math.max(0, Math.floor(ms / beatMs));
  const beatsInBar = beatsPerBar(timeSignature);
  const bar = Math.floor(beatIndex / beatsInBar) + 1;
  const beat = (beatIndex % beatsInBar) + 1;
  const tick = Math.floor(((ms % beatMs) / beatMs) * ppqn);
  return { bar, beat, tick };
}

export function snapMsToBeat(ms: number, tempoBpm: number): number {
  const beatMs = msPerBeat(tempoBpm);
  return Math.round(ms / beatMs) * beatMs;
}

export function snapMsToBar(ms: number, tempoBpm: number, timeSignature: TimeSignature, bars = 1): number {
  const unit = msPerBar(tempoBpm, timeSignature) * Math.max(1, bars);
  return Math.round(ms / unit) * unit;
}
