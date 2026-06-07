import type { MyMaitVramStatus } from '../lib/transport';

function gb(valueMb: number): string {
  return `${(valueMb / 1024).toFixed(valueMb >= 10_240 ? 0 : 1)} GB`;
}

export function MyMaitVramBadge({ status }: { status: MyMaitVramStatus | null }) {
  if (!status) {
    return (
      <div className="mm-vram-badge ew-badge ew-badge--neutral cold">
        <span className="ew-badge-dot mm-vram-dot" />
        <span>VRAM unknown</span>
      </div>
    );
  }

  return (
    <div className={`mm-vram-badge ew-badge ${status.my_mait_resident ? 'ew-badge--success hot' : 'ew-badge--neutral cold'}`}>
      <span className="ew-badge-dot mm-vram-dot" />
      <span>{status.my_mait_resident ? 'Resident' : 'Cold'}</span>
      <b>{gb(status.used_mb)} / {gb(status.total_mb)}</b>
    </div>
  );
}
