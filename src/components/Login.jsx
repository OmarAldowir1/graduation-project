import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, SUPABASE_URL } from '../lib/config.js';
import { getSession, sendPasswordReset, signIn, signInWithGoogle, signUp, updatePassword } from '../lib/supabase.js';
import { showToast } from '../legacy/app.js';

function isNetworkFetchError(err) {
  const msg = (err && (err.message || String(err))) || '';
  return msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror');
}

function friendlyNetworkHelp() {
  // For normal users, do NOT expose infrastructure/config details.
  return 'تعذر الاتصال بخدمة تسجيل الدخول. تحقق من اتصال الإنترنت ثم أعد المحاولة.';
}

function logNetworkHelpForDevelopers(err) {
  if (!import.meta.env.DEV) return;
  console.groupCollapsed('[Motion] Supabase network error');
  console.error(err);
  console.info('SUPABASE_URL:', SUPABASE_URL);
  console.info(
    'Fix: set react/.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from Supabase Dashboard → Settings → API'
  );
  console.info('Common causes: VPN/firewall blocks *.supabase.co, wrong URL, project removed/paused');
  console.groupEnd();
}

export default function Login({ isBootstrapping }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => (mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Sign Up' : 'Send Reset Link'), [mode]);

  useEffect(() => {
    // If the user already has a session, redirect to the app shell.
    if (!isSupabaseConfigured) return;
    getSession().then((session) => {
      if (session) window.location.hash = 'dashboard';
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase is not configured. Copy .env.example to .env and add your project URL and anon key.');
      if (mode === 'reset') {
        const { error: resetError } = await sendPasswordReset(email);
        if (resetError) throw resetError;
        setMode('signin');
        setError('If an account exists for that email, a password reset link has been sent.');
      } else if (mode === 'signin') {
        const { error: signInError } = await signIn(email, password);
        if (signInError) throw signInError;
        showToast('Signed in!', 'success');
        window.location.hash = 'dashboard';
      } else {
        const { error: signUpError } = await signUp(email, password, name);
        if (signUpError) throw signUpError;
        const session = await getSession();
        if (session) {
          showToast('Account created!', 'success');
          window.location.hash = 'dashboard';
        } else {
          setMode('signin');
          setError('Account created. Check your email to confirm your account, then sign in.');
        }
      }
    } catch (err) {
      if (isNetworkFetchError(err)) {
        logNetworkHelpForDevelopers(err);
        setError(friendlyNetworkHelp());
      }
      else setError(err?.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError('');
    setLoading(true);
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase is not configured. Copy .env.example to .env and add your project URL and anon key.');
      const { error: oauthError } = await signInWithGoogle();
      if (oauthError) throw oauthError;
    } catch (err) {
      if (isNetworkFetchError(err)) {
        logNetworkHelpForDevelopers(err);
        setError(friendlyNetworkHelp());
      }
      else setError(err?.message || 'Google sign-in failed');
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col items-center justify-center p-6">
      <main className="w-full max-w-[420px] space-y-10">
        <header className="text-center space-y-2">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-on-primary text-2xl">motion_photos_on</span>
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tighter text-on-surface">Motion</h1>
          <p className="text-on-surface-variant font-label tracking-wide text-sm">DESIGNED FOR CLARITY</p>
          {!isSupabaseConfigured ? (
            <p className="mt-4 rounded-lg bg-tertiary-container/40 px-3 py-2 text-left text-xs text-on-tertiary-container">
              Backend setup required: copy <code>.env.example</code> to <code>.env</code> and add your Supabase credentials.
            </p>
          ) : null}
        </header>

        <div className="tonal-stack-card rounded-xl p-8 shadow-[0_40px_40px_-15px_rgba(45,52,51,0.04)] border border-outline-variant/10 bg-white">
          <div className="flex mb-6 bg-surface-container rounded-lg p-1">
            <button
              type="button"
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${
                mode === 'signin' ? 'bg-white shadow-sm text-on-surface' : 'text-on-surface-variant'
              }`}
              onClick={() => setMode('signin')}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${
                mode === 'signup' ? 'bg-white shadow-sm text-on-surface' : 'text-on-surface-variant'
              }`}
              onClick={() => setMode('signup')}
            >
              Sign Up
            </button>
          </div>

          {mode === 'signin' ? (
            <button type="button" className="mb-5 text-xs font-semibold text-primary hover:underline" onClick={() => { setError(''); setMode('reset'); }}>
              Forgot your password?
            </button>
          ) : mode === 'reset' ? (
            <button type="button" className="mb-5 text-xs font-semibold text-primary hover:underline" onClick={() => { setError(''); setMode('signin'); }}>
              Back to sign in
            </button>
          ) : null}

          {error ? (
            <div className="mb-4 p-3 rounded-lg bg-error-container/20 text-on-error-container text-sm font-medium whitespace-pre-wrap">
              {error}
            </div>
          ) : null}

          <form className="space-y-6" onSubmit={handleSubmit}>
            {mode === 'signup' ? (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wider text-on-surface-variant uppercase pl-1">
                  Full Name
                </label>
                <input
                  className="w-full px-4 py-3 bg-surface-container rounded-lg border-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest transition-all duration-200 text-on-surface placeholder:text-outline text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  type="text"
                  placeholder="Your full name"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold tracking-wider text-on-surface-variant uppercase pl-1">Email</label>
              <input
                className="w-full px-4 py-3 bg-surface-container rounded-lg border-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest transition-all duration-200 text-on-surface placeholder:text-outline text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                type="email"
                placeholder="name@workspace.com"
              />
            </div>

            {mode !== 'reset' ? <div className="space-y-1.5">
              <label className="block text-xs font-semibold tracking-wider text-on-surface-variant uppercase pl-1">Password</label>
              <input
                className="w-full px-4 py-3 bg-surface-container rounded-lg border-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest transition-all duration-200 text-on-surface placeholder:text-outline text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                type="password"
                placeholder="••••••••"
                minLength={6}
              />
            </div> : null}

            <button
              className="w-full py-3.5 bg-gradient-to-r from-primary to-primary-dim text-on-primary rounded-full font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all shadow-sm disabled:opacity-60"
              type="submit"
              disabled={loading || isBootstrapping}
            >
              {loading ? 'Please wait…' : title}
            </button>

            {mode !== 'reset' ? <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-outline-variant/20"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-white text-outline font-medium">OR</span>
              </div>
            </div> : null}

            {mode !== 'reset' ? <button
              type="button"
              onClick={handleGoogle}
              disabled={loading || isBootstrapping}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-full border border-outline-variant/30 bg-surface-container-lowest text-on-surface text-sm font-medium hover:bg-surface-container-low transition-colors duration-200 disabled:opacity-60"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                ></path>
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                ></path>
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  fill="#FBBC05"
                ></path>
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                ></path>
              </svg>
              Continue with Google
            </button> : null}
          </form>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 w-full h-1/2 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-tertiary-container/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-12 -right-12 w-64 h-64 bg-primary-container/15 rounded-full blur-3xl"></div>
      </div>
    </div>
  );
}

export function PasswordReset() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirmation) return setError('Passwords do not match.');
    setLoading(true);
    try {
      const { error: updateError } = await updatePassword(password);
      if (updateError) throw updateError;
      setMessage('Password updated. You can now sign in.');
      window.setTimeout(() => { window.location.hash = 'login'; }, 900);
    } catch (err) {
      setError(err?.message || 'Could not update password. Request a new reset link.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col items-center justify-center p-6">
      <main className="w-full max-w-[420px]">
        <div className="tonal-stack-card rounded-xl p-8 border border-outline-variant/10 bg-white">
          <h1 className="text-2xl font-extrabold tracking-tight mb-2">Set a new password</h1>
          <p className="text-sm text-on-surface-variant mb-6">Choose a new password for your Motion account.</p>
          {error ? <div className="mb-4 p-3 rounded-lg bg-error-container/20 text-on-error-container text-sm">{error}</div> : null}
          {message ? <div className="mb-4 p-3 rounded-lg bg-primary-container/30 text-on-primary-container text-sm">{message}</div> : null}
          <form className="space-y-4" onSubmit={handleSubmit}>
            <input className="w-full px-4 py-3 bg-surface-container rounded-lg border-none text-on-surface" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" minLength={6} required />
            <input className="w-full px-4 py-3 bg-surface-container rounded-lg border-none text-on-surface" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Confirm new password" minLength={6} required />
            <button className="w-full py-3.5 bg-primary text-on-primary rounded-full font-semibold text-sm disabled:opacity-60" type="submit" disabled={loading}>{loading ? 'Updating…' : 'Update password'}</button>
          </form>
        </div>
      </main>
    </div>
  );
}
