import type { ReactNode } from 'react';

interface MmSettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

interface MmSettingRowProps {
  label: string;
  description?: string;
  htmlFor?: string;
  layout: 'row' | 'stack';
  children: ReactNode;
}

export function MmSettingsSection({ title, description, children }: MmSettingsSectionProps) {
  return (
    <section className="mm-settings-panel ew-card ew-v2-bevel">
      <div className="mm-settings-section-head">
        <h2 className="ew-card-title">{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="mm-settings-section-body">
        {children}
      </div>
    </section>
  );
}

export function MmSettingRow({ label, description, htmlFor, layout, children }: MmSettingRowProps) {
  const labelNode = htmlFor ? (
    <label htmlFor={htmlFor}>{label}</label>
  ) : (
    <span>{label}</span>
  );

  return (
    <div className={`mm-setting-row mm-setting-row--${layout}`}>
      <div className="mm-setting-copy">
        {labelNode}
        {description && <p>{description}</p>}
      </div>
      <div className="mm-setting-control">
        {children}
      </div>
    </div>
  );
}
