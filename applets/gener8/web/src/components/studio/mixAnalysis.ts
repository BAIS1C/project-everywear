import type { TrackName } from "../../services/api";

export type MixChannelType = "mix_bus" | "lead_vocal" | "drums" | "bass" | "instruments";

export interface MixAnalysisOptions {
  channelType: MixChannelType;
  genre: string;
}

export interface MixAnalysisResult {
  integratedLufs: number;
  shortTermLufs: number;
  momentaryLufs: number;
  loudnessRange: number;
  truePeakDb: number;
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  correlation: number;
  width: number;
  dcOffset: number;
  duration: number;
  sampleRate: number;
  activeStems: TrackName[];
  spectrum: number[];
  feedback: string[];
  summary: string;
}

let sharedContext: AudioContext | null = null;
const bufferCache = new Map<string, Promise<AudioBuffer>>();

function getAudioContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return sharedContext;
}

function db(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return -96;
  return Math.max(-96, 20 * Math.log10(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function decodeAudio(url: string): Promise<AudioBuffer> {
  const hit = bufferCache.get(url);
  if (hit) return hit;

  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => getAudioContext().decodeAudioData(arrayBuffer.slice(0)));

  bufferCache.set(url, promise);
  return promise;
}

function windowLufs(samples: Float32Array, sampleRate: number, seconds: number): number {
  const count = Math.max(1, Math.min(samples.length, Math.round(sampleRate * seconds)));
  const start = Math.max(0, samples.length - count);
  let sumSquares = 0;
  for (let i = start; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i];
  }
  return db(Math.sqrt(sumSquares / count)) - 0.691;
}

function loudnessRange(samples: Float32Array, sampleRate: number): number {
  const block = Math.max(1, Math.round(sampleRate * 3));
  const values: number[] = [];
  for (let start = 0; start < samples.length; start += block) {
    const end = Math.min(samples.length, start + block);
    let sumSquares = 0;
    for (let i = start; i < end; i++) sumSquares += samples[i] * samples[i];
    const lufs = db(Math.sqrt(sumSquares / Math.max(1, end - start))) - 0.691;
    if (lufs > -70) values.push(lufs);
  }
  if (values.length < 2) return 0;
  values.sort((a, b) => a - b);
  const low = values[Math.floor(values.length * 0.1)];
  const high = values[Math.floor(values.length * 0.95)];
  return Math.max(0, high - low);
}

function goertzel(samples: Float32Array, sampleRate: number, freq: number): number {
  const omega = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  const stride = Math.max(1, Math.ceil(samples.length / 120000));
  for (let i = 0; i < samples.length; i += stride) {
    q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }
  const power = q1 * q1 + q2 * q2 - coeff * q1 * q2;
  return Math.sqrt(Math.max(0, power));
}

function spectrumBands(mono: Float32Array, sampleRate: number): number[] {
  const centers = [55, 110, 220, 440, 880, 1760, 3520, 7040];
  const raw = centers.map((freq) => goertzel(mono, sampleRate, Math.min(freq, sampleRate / 2 - 100)));
  const max = Math.max(...raw, 0.000001);
  return raw.map((value) => clamp(value / max, 0, 1));
}

function channelLabel(channelType: MixChannelType): string {
  switch (channelType) {
    case "lead_vocal": return "lead vocal";
    case "drums": return "drum bus";
    case "bass": return "bass";
    case "instruments": return "instrument bus";
    default: return "mix bus";
  }
}

function makeFeedback(result: Omit<MixAnalysisResult, "feedback" | "summary">, options: MixAnalysisOptions): string[] {
  const notes: string[] = [];
  const label = channelLabel(options.channelType);
  const lowEnergy = result.spectrum[0] + result.spectrum[1];
  const midEnergy = result.spectrum[3] + result.spectrum[4];
  const airEnergy = result.spectrum[6] + result.spectrum[7];

  if (options.channelType === "mix_bus") {
    if (result.integratedLufs > -8) {
      notes.push(`The ${label} is very loud at ${result.integratedLufs.toFixed(1)} LUFS est. Back the limiter or clipper off 1-3 dB before chasing more level.`);
    } else if (result.integratedLufs < -16) {
      notes.push(`The ${label} is sitting fairly quiet at ${result.integratedLufs.toFixed(1)} LUFS est. There is headroom for bus compression or limiter gain if the arrangement already feels finished.`);
    } else {
      notes.push(`The ${label} level is in a workable zone at ${result.integratedLufs.toFixed(1)} LUFS est., so the next move should be tonal balance rather than raw loudness.`);
    }
  } else {
    notes.push(`Analysing this as a ${label}: level reads ${result.shortTermLufs.toFixed(1)} short-term LUFS est. with ${result.crestDb.toFixed(1)} dB crest, so the feedback is focused on fit and control rather than mastering loudness.`);
  }

  if (result.truePeakDb > -0.5) {
    notes.push(`True peak estimate is close to clipping at ${result.truePeakDb.toFixed(1)} dBTP. Leave at least 1 dB of ceiling before export or heavy downstream processing.`);
  } else if (result.truePeakDb < -6 && options.channelType === "mix_bus") {
    notes.push(`Peak headroom is generous at ${result.truePeakDb.toFixed(1)} dBTP. If the mix feels small, raise gain into the bus chain before adding more compression.`);
  }

  if (result.crestDb < 6) {
    notes.push(`Dynamics are tight: ${result.crestDb.toFixed(1)} dB crest can feel flattened. Try easing bus compression attack/release or lowering clipper drive.`);
  } else if (result.crestDb > 15 && options.channelType !== "lead_vocal") {
    notes.push(`Crest factor is wide at ${result.crestDb.toFixed(1)} dB. If the track jumps around, catch transients with 1-2 dB of compression before limiting.`);
  }

  if (result.correlation < 0.15) {
    notes.push(`Stereo correlation is low (${result.correlation.toFixed(2)}). Check mono compatibility and narrow low-frequency widening before committing.`);
  } else if (result.width > 1.35 && options.channelType === "bass") {
    notes.push(`Bass width is high (${result.width.toFixed(2)}). Keep sub information mono and push width higher up the spectrum instead.`);
  } else if (result.width < 0.45 && options.channelType === "mix_bus") {
    notes.push(`Stereo width is conservative (${result.width.toFixed(2)}). If the genre allows it, widen ambience, doubles, or upper percussion rather than the low end.`);
  }

  if (lowEnergy > midEnergy * 1.35 && options.channelType !== "bass") {
    notes.push(`The low bands dominate the curve. Try a 1-2 dB trim around 80-160 Hz or high-pass non-bass stems to open space.`);
  } else if (airEnergy < midEnergy * 0.45 && options.channelType !== "bass") {
    notes.push(`Top-end energy is restrained. A gentle high shelf above 8 kHz or brighter saturation could add presence without changing the arrangement.`);
  }

  if (options.channelType === "lead_vocal" && result.width > 1.1) {
    notes.push(`For a lead vocal, the image is wide. Keep the main vocal centred and put width on doubles, throws, or reverb returns.`);
  }

  return notes.slice(0, 5);
}

export async function analyseDawMix(
  stems: Record<TrackName, string | null>,
  options: MixAnalysisOptions,
): Promise<MixAnalysisResult> {
  const entries = Object.entries(stems)
    .filter((entry): entry is [TrackName, string] => Boolean(entry[1]) && entry[1] !== "simulated");

  if (entries.length === 0) {
    throw new Error("No real stem audio is available for analysis yet.");
  }

  const decoded = await Promise.all(entries.map(async ([trackName, url]) => ({
    trackName,
    buffer: await decodeAudio(url),
  })));

  const maxLength = Math.max(...decoded.map((item) => item.buffer.length));
  const sourceRate = decoded[0]?.buffer.sampleRate || 48000;
  const stride = Math.max(1, Math.ceil(maxLength / 240000));
  const sampleCount = Math.max(1, Math.ceil(maxLength / stride));
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  const gain = 1 / Math.sqrt(decoded.length);

  for (const item of decoded) {
    const buffer = item.buffer;
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
    for (let i = 0; i < sampleCount; i++) {
      const src = i * stride;
      if (src >= buffer.length) continue;
      left[i] += ch0[src] * gain;
      right[i] += ch1[src] * gain;
    }
  }

  const mono = new Float32Array(sampleCount);
  let peak = 0;
  let sumSquares = 0;
  let sumL = 0;
  let sumR = 0;
  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  let sumDc = 0;
  let sideSquares = 0;
  let midSquares = 0;

  for (let i = 0; i < sampleCount; i++) {
    const l = clamp(left[i], -1.5, 1.5);
    const r = clamp(right[i], -1.5, 1.5);
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    const absPeak = Math.max(Math.abs(l), Math.abs(r));
    if (absPeak > peak) peak = absPeak;
    mono[i] = m;
    sumSquares += m * m;
    sumL += l;
    sumR += r;
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
    sumDc += m;
    midSquares += m * m;
    sideSquares += s * s;
  }

  const effectiveRate = sourceRate / stride;
  const rms = Math.sqrt(sumSquares / sampleCount);
  const integratedLufs = db(rms) - 0.691;
  const peakDb = db(peak);
  const truePeakDb = peakDb + 0.6;
  const crestDb = Math.max(0, peakDb - db(rms));
  const denominator = Math.sqrt(Math.max(0.000001, sumL2 * sumR2));
  const correlation = clamp(sumLR / denominator, -1, 1);
  const width = clamp(Math.sqrt(sideSquares / Math.max(0.000001, midSquares)), 0, 2.5);
  const base = {
    integratedLufs,
    shortTermLufs: windowLufs(mono, effectiveRate, 3),
    momentaryLufs: windowLufs(mono, effectiveRate, 0.4),
    loudnessRange: loudnessRange(mono, effectiveRate),
    truePeakDb,
    peakDb,
    rmsDb: db(rms),
    crestDb,
    correlation,
    width,
    dcOffset: sumDc / sampleCount,
    duration: maxLength / sourceRate,
    sampleRate: sourceRate,
    activeStems: decoded.map((item) => item.trackName),
    spectrum: spectrumBands(mono, effectiveRate),
  };

  const feedback = makeFeedback(base, options);
  return {
    ...base,
    feedback,
    summary: feedback[0] || `The ${channelLabel(options.channelType)} has enough meter data for a first-pass review.`,
  };
}
