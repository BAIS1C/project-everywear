interface SkillIconInput {
  id: string;
  name: string;
  tag?: string;
  icon?: string;
}

function initials(name: string, fallback?: string): string {
  const parts = name
    .replace(/->/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return letters || fallback?.slice(0, 2).toUpperCase() || 'MM';
}

function iconKind(skill: SkillIconInput): string {
  const key = `${skill.id} ${skill.tag || ''} ${skill.name} ${skill.icon || ''}`.toLowerCase();
  if (key.includes('mymory') || key.includes('memory') || key.includes('vault')) return 'memory';
  if (key.includes('graph')) return 'graph';
  if (key.includes('code') || key.includes('dev') || key.includes('review')) return 'code';
  if (key.includes('youtube') || key.includes('yt') || key.includes('play')) return 'video';
  if (key.includes('thread') || key.includes('x thread')) return 'thread';
  if (key.includes('linkedin') || key.includes('briefcase')) return 'work';
  if (key.includes('article') || key.includes('document') || key.includes('summary')) return 'document';
  if (key.includes('study') || key.includes('teacher') || key.includes('book')) return 'study';
  if (key.includes('file') || key.includes('folder')) return 'file';
  return 'skill';
}

function IconShape({ kind }: { kind: string }) {
  if (kind === 'memory') {
    return (
      <>
        <path className="gl-stroke" d="M13 9c-3 0-5 2-5 5 0 2 1 4 3 5v3h10v-3c2-1 3-3 3-5 0-3-2-5-5-5-2 0-3 1-4 2-1-1-2-2-4-2Z" />
        <path className="gl-stroke" d="M12 15h8M13 19h6" />
      </>
    );
  }
  if (kind === 'graph') {
    return (
      <>
        <circle className="gl-fg" cx="10" cy="11" r="2.2" />
        <circle className="gl-fg" cx="22" cy="12" r="2.2" />
        <circle className="gl-fg" cx="16" cy="22" r="2.2" />
        <path className="gl-stroke" d="M12 12h8M11 13l4 7M21 14l-4 6" />
      </>
    );
  }
  if (kind === 'code') {
    return (
      <>
        <path className="gl-stroke" d="m13 10-5 6 5 6M19 10l5 6-5 6" />
        <path className="gl-stroke" d="m18 8-4 24" />
      </>
    );
  }
  if (kind === 'video') {
    return (
      <>
        <rect className="gl-stroke" x="8" y="10" width="18" height="14" rx="2" />
        <path className="gl-fg" d="m15 14 7 3-7 4Z" />
      </>
    );
  }
  if (kind === 'thread') {
    return (
      <>
        <path className="gl-stroke" d="M9 10h15M9 16h11M9 22h14" />
        <circle className="gl-fg" cx="6" cy="10" r="1.4" />
        <circle className="gl-fg" cx="6" cy="16" r="1.4" />
        <circle className="gl-fg" cx="6" cy="22" r="1.4" />
      </>
    );
  }
  if (kind === 'work') {
    return (
      <>
        <rect className="gl-stroke" x="8" y="12" width="18" height="15" rx="2" />
        <path className="gl-stroke" d="M13 12v-2h8v2M8 18h18" />
      </>
    );
  }
  if (kind === 'document') {
    return (
      <>
        <path className="gl-stroke" d="M10 7h10l5 5v17H10Z" />
        <path className="gl-stroke" d="M20 7v6h6M13 18h11M13 23h8" />
      </>
    );
  }
  if (kind === 'study') {
    return (
      <>
        <path className="gl-stroke" d="M8 10c4-2 8-2 12 0v18c-4-2-8-2-12 0ZM20 10c3-2 6-2 8 0v18c-2-2-5-2-8 0Z" />
        <path className="gl-stroke" d="M20 10v18" />
      </>
    );
  }
  if (kind === 'file') {
    return (
      <>
        <path className="gl-stroke" d="M7 12h9l2 3h10v15H7Z" />
        <path className="gl-stroke" d="M7 12v-3h8l2 3" />
      </>
    );
  }
  return (
    <>
      <path className="gl-stroke" d="M16 7 8 18h7l-1 11 9-13h-7Z" />
      <circle className="gl-fg" cx="24" cy="9" r="2" />
    </>
  );
}

export function MyMaitSkillIcon({ skill, inline = false }: { skill: SkillIconInput; inline?: boolean }) {
  const kind = iconKind(skill);
  return (
    <span
      className={`ah-skill-glyph ew-glyph ew-glyph--32 ew-glyph--3d skill-glyph--${kind} ${inline ? 'inline' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" focusable="false">
        <rect className="gl-bg" x="3" y="3" width="26" height="26" rx="4" />
        <IconShape kind={kind} />
        <text className="gl-text" x="16" y="27">{initials(skill.name, skill.icon)}</text>
      </svg>
    </span>
  );
}
