/**
 * AuthGate — renders a login/signup screen until the user is authenticated.
 *
 * Everywear ID is required to use the shell. This gate wraps ShellLayout
 * and only renders children when useAuth().isAuthenticated is true.
 *
 * Supports: email + password login. Full Everywear ID creation stays on the
 * canonical S3 Studio signup flow until the shell ports handle selection.
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="ew-auth-gate ew-auth-gate--loading">
        <div className="ew-auth-gate__spinner" />
        <p>Loading Everywear OS...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <>{children}</>;
}

function LoginScreen() {
  const { signInWithPassword, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberProfile, setRememberProfile] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const displayError = localError || error;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    try {
      if (!password) {
        setLocalError('Password is required.');
        return;
      }
      await signInWithPassword(email, password, rememberProfile);
    } catch (err: any) {
      setLocalError(err?.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ew-auth-gate">
      <div className="ew-auth-card">
        <div className="ew-auth-card__header">
          <h1 className="ew-auth-card__title">Everywear ID</h1>
          <p className="ew-auth-card__subtitle">
            Sign in to your Everywear account
          </p>
        </div>

        <form className="ew-auth-card__form" onSubmit={handleSubmit}>
          <label className="ew-auth-field">
            <span className="ew-auth-field__label">Email</span>
            <input
              type="email"
              className="ew-auth-field__input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </label>

          <label className="ew-auth-field">
            <span className="ew-auth-field__label">
              Password
            </span>
            <input
              type="password"
              className="ew-auth-field__input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Required"
              required
            />
          </label>

          <label className="ew-auth-remember">
            <input
              type="checkbox"
              checked={rememberProfile}
              onChange={(event) => setRememberProfile(event.target.checked)}
            />
            <span>Save my profile on this device for 30 days</span>
          </label>

          {displayError && (
            <div className="ew-auth-card__error">{displayError}</div>
          )}

          <button
            type="submit"
            className="ew-auth-card__submit"
            disabled={submitting}
          >
            {submitting
              ? 'Please wait...'
              : 'Sign In'}
          </button>
        </form>

        <div className="ew-auth-card__footer">
          <span className="ew-auth-card__link" aria-disabled="true">
            Create or change Everywear ID in S3 Studio for now.
          </span>
        </div>
      </div>
    </div>
  );
}
