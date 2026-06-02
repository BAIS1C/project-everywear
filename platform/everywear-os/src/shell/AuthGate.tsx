/**
 * AuthGate — renders a login/signup screen until the user is authenticated.
 *
 * Everywear ID is required to use the shell. This gate wraps ShellLayout
 * and only renders children when useAuth().isAuthenticated is true.
 *
 * Supports: email + password login, signup, and signup email-code verification.
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';

type AuthMode = 'login' | 'signup' | 'otp-verify';

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
  const { signInWithPassword, signInWithGoogle, signUp, verifyOtp, error } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [rememberProfile, setRememberProfile] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [socialSubmitting, setSocialSubmitting] = useState<'google' | null>(null);

  const displayError = localError || error;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    try {
      if (mode === 'login') {
        if (!password) {
          setLocalError('Password is required.');
          return;
        }
        await signInWithPassword(email, password, rememberProfile);
      } else if (mode === 'signup') {
        if (!password) {
          setLocalError('Password is required for signup.');
          return;
        }
        if (!handle.trim()) {
          setLocalError('Everywear ID is required.');
          return;
        }
        await signUp(email, password, handle, displayName);
        setMode('otp-verify');
      } else {
        await verifyOtp(email, otpCode, handle, displayName);
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    setSocialSubmitting('google');
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setLocalError(err?.message || 'Google sign-in failed.');
      setSocialSubmitting(null);
    }
  };

  return (
    <div className="ew-auth-gate">
      <div className="ew-auth-card">
        <div className="ew-auth-card__header">
          <h1 className="ew-auth-card__title">Everywear ID</h1>
          <p className="ew-auth-card__subtitle">
            {mode === 'login' && 'Sign in to your Everywear account'}
            {mode === 'signup' && 'Create your Everywear ID'}
            {mode === 'otp-verify' && 'Enter the code from your email'}
          </p>
        </div>

        <form className="ew-auth-card__form" onSubmit={handleSubmit}>
          {(mode === 'login' || mode === 'signup') && (
            <>
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

              {mode === 'signup' && (
                <>
                  <label className="ew-auth-field">
                    <span className="ew-auth-field__label">Everywear ID</span>
                    <input
                      type="text"
                      className="ew-auth-field__input"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      placeholder="seanie"
                      required
                    />
                  </label>

                  <label className="ew-auth-field">
                    <span className="ew-auth-field__label">Display Name</span>
                    <input
                      type="text"
                      className="ew-auth-field__input"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                </>
              )}

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

              {mode === 'login' && (
                <label className="ew-auth-remember">
                  <input
                    type="checkbox"
                    checked={rememberProfile}
                    onChange={(event) => setRememberProfile(event.target.checked)}
                  />
                  <span>Save my profile on this device for 30 days</span>
                </label>
              )}
            </>
          )}

          {mode === 'otp-verify' && (
            <label className="ew-auth-field">
              <span className="ew-auth-field__label">Verification code</span>
              <input
                type="text"
                className="ew-auth-field__input"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="123456"
                autoFocus
              />
            </label>
          )}

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
              : mode === 'login'
                ? 'Sign In'
                : mode === 'signup'
                  ? 'Create Account'
                  : 'Verify Code'}
          </button>
        </form>

        {mode === 'login' && (
          <div className="ew-auth-card__socials" aria-label="Social sign in">
            <button
              type="button"
              className="ew-auth-card__social ew-auth-card__social--google"
              onClick={handleGoogleSignIn}
              disabled={submitting || socialSubmitting === 'google'}
            >
              <span className="ew-auth-card__social-mark">G</span>
              <span>{socialSubmitting === 'google' ? 'Opening Google...' : 'Continue with Google'}</span>
            </button>
            <button
              type="button"
              className="ew-auth-card__social"
              disabled
            >
              <span className="ew-auth-card__social-mark">D</span>
              <span>Discord next</span>
            </button>
          </div>
        )}

        <div className="ew-auth-card__footer">
          {mode === 'login' && (
            <button
              className="ew-auth-card__link"
              onClick={() => { setMode('signup'); setLocalError(null); }}
            >
              Don't have an account? Create Everywear ID
            </button>
          )}
          {mode === 'signup' && (
            <button
              className="ew-auth-card__link"
              onClick={() => { setMode('login'); setLocalError(null); }}
            >
              Already have an account? Sign in
            </button>
          )}
          {mode === 'otp-verify' && (
            <button
              className="ew-auth-card__link"
              onClick={() => setMode('login')}
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
