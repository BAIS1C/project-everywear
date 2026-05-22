/**
 * Shared LRC / SRT parsing utilities.
 * Ported from s3studio-web/src/lib/lrcParser.ts.
 * All timed-lyrics logic should import from here.
 */

export interface LrcLine {
  /** Timestamp in seconds (fractional). */
  ts: number;
  /** The lyric text at this timestamp. */
  text: string;
}

// -- Parsing ------------------------------------------------------------------

/** Parse an LRC string into an ordered array of timestamped lines. */
export function parseLrc(raw: string): LrcLine[] {
  return raw
    .trim()
    .split('\n')
    .map((line) => {
      const m = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
      if (!m) return null;
      const mins = parseInt(m[1], 10);
      const secs = parseInt(m[2], 10);
      const frac = m[3].length === 3
        ? parseInt(m[3], 10) / 1000
        : parseInt(m[3], 10) / 100;
      return { ts: mins * 60 + secs + frac, text: m[4].trim() };
    })
    .filter(Boolean) as LrcLine[];
}

/**
 * Given a parsed LRC array and the current playback time (seconds),
 * return the text of the line that should be displayed.
 */
export function getCurrentLine(parsed: LrcLine[], currentTime: number): string {
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (parsed[i].ts <= currentTime) return parsed[i].text;
  }
  return '';
}

// -- Format Conversion --------------------------------------------------------

function fmtSrt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return (
    String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + ',' +
    String(ms).padStart(3, '0')
  );
}

/** Convert an LRC string to SRT format. */
export function lrcToSrt(lrcData: string): string {
  const entries = parseLrc(lrcData);
  if (entries.length === 0) return '';
  return entries
    .map((e, i) => {
      const end = entries[i + 1] ? entries[i + 1].ts : e.ts + 3;
      return `${i + 1}\n${fmtSrt(e.ts)} --> ${fmtSrt(end)}\n${e.text}\n`;
    })
    .join('\n');
}

/** Convert an SRT string to LRC format. */
export function srtToLrc(srt: string): string {
  const blocks = srt.trim().split(/\n\s*\n/);
  const lrcLines: string[] = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const textLine = lines.slice(2).join(' ');
    const startMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (startMatch) {
      const mins = parseInt(startMatch[1], 10) * 60 + parseInt(startMatch[2], 10);
      const secs = startMatch[3];
      const cs = startMatch[4].slice(0, 2);
      lrcLines.push(`[${String(mins).padStart(2, '0')}:${secs}.${cs}]${textLine}`);
    }
  }
  return lrcLines.join('\n');
}

/** Returns true if the string looks like it has LRC timestamps. */
export function isLrcData(data: string | null | undefined): boolean {
  if (!data) return false;
  return /^\[\d{2}:\d{2}\.\d{2,3}\]/m.test(data);
}

// -- Naive Fallback -----------------------------------------------------------

const SECTION_TAG_RE = /^\[.*\]\s*$/;

/**
 * Generate naive LRC from plain (unsynced) lyrics by distributing lines
 * evenly across the track duration.
 */
export function naiveLrcFromLyrics(lyrics: string, durationSec: number): string {
  const rawLines = lyrics.trim().split('\n');
  const singable = rawLines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !SECTION_TAG_RE.test(l));

  if (singable.length === 0 || durationSec <= 0) return '';

  const startOffset = Math.min(2, durationSec * 0.02);
  const endPad = Math.min(3, durationSec * 0.05);
  const usable = durationSec - startOffset - endPad;
  const interval = usable / singable.length;

  return singable
    .map((text, i) => {
      const ts = startOffset + i * interval;
      const mins = Math.floor(ts / 60);
      const secs = Math.floor(ts % 60);
      const cs = Math.round((ts % 1) * 100);
      return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}]${text}`;
    })
    .join('\n');
}
