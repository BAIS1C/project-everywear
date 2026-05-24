// @ts-nocheck
/**
 * ErrorBoundary — top-level React error boundary.
 *
 * Catches render-time exceptions, logs them through the diag pipeline,
 * and shows a fallback UI so the whole app doesn't disappear into a
 * blank white screen. The diag log entry includes the component stack
 * so the bug is reproducible.
 *
 * 2026-04-26 SGT.
 */

import React from 'react';
import { logError } from '@/lib/diag';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional override of the fallback UI. */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Forward to diag. componentStack is the React component tree path,
    // useful for finding which component crashed.
    logError(`[react] ${error.name}: ${error.message}`, {
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  reset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'var(--ew-bg, #0a0a12)',
            color: 'var(--ew-text, #e6e6f0)',
            fontFamily: 'var(--ew-font-mono, monospace)',
            textAlign: 'center',
            zIndex: 99999,
          }}
        >
          <div style={{
            fontSize: 14,
            letterSpacing: '0.3em',
            color: 'var(--ew-warning, #f59e0b)',
            textTransform: 'uppercase',
            marginBottom: 16,
          }}>
            Something went sideways
          </div>
          <div style={{
            fontSize: 12,
            opacity: 0.7,
            maxWidth: 480,
            marginBottom: 24,
            lineHeight: 1.5,
          }}>
            The error has been logged to %LOCALAPPDATA%\S3-Gener8\logs\.
            You can keep going by reloading, or close the app and restart.
          </div>
          <div style={{
            fontSize: 10,
            opacity: 0.5,
            fontStyle: 'italic',
            maxWidth: 480,
            marginBottom: 24,
            wordBreak: 'break-word',
          }}>
            {this.state.errorMessage}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={this.reset}
              style={{
                padding: '8px 16px',
                fontSize: 11,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                background: 'var(--ew-primary, #00C2FF)',
                color: 'var(--ew-primary-fg, #000)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                fontSize: 11,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                background: 'transparent',
                color: 'var(--ew-text-muted, #999)',
                border: '1px solid var(--ew-border, #333)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
