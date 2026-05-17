import React, { useState, useRef, useCallback } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function PromptInput({ value, onChange, onGenerate, disabled, placeholder }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !disabled) {
      e.preventDefault();
      onGenerate();
    }
  }, [onGenerate, disabled]);

  return (
    <div className="imagen-sidebar__section">
      <div className="imagen-sidebar__label">Prompt</div>
      <textarea
        ref={ref}
        className="prompt-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Describe what you want to create...'}
        disabled={disabled}
      />
      <div style={{
        marginTop: 'var(--ew-space-1)',
        fontSize: '10px',
        color: 'var(--ew-text-faint)',
        fontFamily: 'var(--ew-font-mono)',
      }}>
        Ctrl+Enter to generate
      </div>
    </div>
  );
}
