import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Lock, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import type { ArenaConfig } from '../../shared/src/types.ts';

interface AdminViewProps {
  onBackToArena: () => void;
  onConfigSaved?: () => void;
}

interface AdminStatusResponse {
  needsSetup: boolean;
  usesEnvPasscode: boolean;
  authenticated: boolean;
}

interface AdminConfigResponse {
  config: ArenaConfig;
  serverInfo: {
    lanUrls: string[];
    primaryUrl: string;
    port: number;
    isContainer: boolean;
    hasConfiguredHostIp: boolean;
    ipDetected: boolean;
  };
}

interface FormValues {
  hostIp: string;
  paddleHeight: string;
  paddleSpeed: string;
  ballInitialSpeed: string;
  ballSpeedIncrement: string;
  ballMaxSpeed: string;
  winScore: string;
  initialCountdownMs: string;
  pointCountdownMs: string;
  resumeCountdownMs: string;
  challengeExpiryMs: string;
  disconnectGraceMs: string;
  demoPaddleHeight: string;
  demoAutoMove: boolean;
  demoPaddleSpeed: string;
}

function toFormValues(cfg: ArenaConfig): FormValues {
  return {
    hostIp: cfg.hostIp,
    paddleHeight: String(cfg.paddleHeight),
    paddleSpeed: String(cfg.paddleSpeed),
    ballInitialSpeed: String(cfg.ballInitialSpeed),
    ballSpeedIncrement: String(cfg.ballSpeedIncrement),
    ballMaxSpeed: String(cfg.ballMaxSpeed),
    winScore: String(cfg.winScore),
    initialCountdownMs: String(cfg.initialCountdownMs),
    pointCountdownMs: String(cfg.pointCountdownMs),
    resumeCountdownMs: String(cfg.resumeCountdownMs),
    challengeExpiryMs: String(cfg.challengeExpiryMs),
    disconnectGraceMs: String(cfg.disconnectGraceMs),
    demoPaddleHeight: String(cfg.demoPaddleHeight),
    demoAutoMove: cfg.demoPaddleHeight < 1.0 && cfg.demoAutoMove,
    demoPaddleSpeed: String(cfg.demoPaddleSpeed),
  };
}

export function AdminView({ onBackToArena, onConfigSaved }: AdminViewProps) {
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [form, setForm] = useState<FormValues | null>(null);
  const [serverInfo, setServerInfo] = useState<AdminConfigResponse['serverInfo'] | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ level: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const fetchStatus = useCallback(async (token: string | null) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/admin/status', { headers });
      const data = (await res.json()) as AdminStatusResponse;
      setNeedsSetup(data.needsSetup);
      if (token && !data.authenticated) {
        setAdminToken(null);
      }
    } catch {
      setAuthError('Unable to reach server admin status endpoint.');
    }
  }, []);

  const loadConfig = useCallback(async (token: string) => {
    setLoadingConfig(true);
    setSaveFeedback(null);
    try {
      const res = await fetch('/api/admin/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setAdminToken(null);
        return;
      }
      const data = (await res.json()) as AdminConfigResponse & { error?: string };
      if (!res.ok) {
        setSaveFeedback({ level: 'err', text: data.error || 'Failed to load configuration.' });
        return;
      }
      setForm(toFormValues(data.config));
      setServerInfo(data.serverInfo);
    } catch {
      setSaveFeedback({ level: 'err', text: 'Network error while loading configuration.' });
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus(adminToken);
  }, [adminToken, fetchStatus]);

  useEffect(() => {
    if (adminToken) {
      void loadConfig(adminToken);
    } else {
      setForm(null);
      setServerInfo(null);
    }
  }, [adminToken, loadConfig]);

  const handleSetupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (passcode.trim().length < 6) {
      setAuthError('Passcode must be at least 6 characters.');
      return;
    }
    if (passcode !== confirmPasscode) {
      setAuthError('Passcodes do not match.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(data.error || 'Failed to set up admin passcode.');
        void fetchStatus(null);
        return;
      }
      setPasscode('');
      setConfirmPasscode('');
      setNeedsSetup(false);
      setAdminToken(data.token);
    } catch {
      setAuthError('Network error while configuring admin passcode.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!passcode) {
      setAuthError('Enter your admin passcode.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(data.error || 'Invalid passcode.');
        return;
      }
      setPasscode('');
      setAdminToken(data.token);
    } catch {
      setAuthError('Network error during admin sign-in.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    const token = adminToken;
    setAdminToken(null);
    if (token) {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  };

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    if (!adminToken || !form) return;
    setSaveFeedback(null);

    const demoPaddleHeightNum = Number(form.demoPaddleHeight);
    const demoAutoMoveAllowed = Number.isFinite(demoPaddleHeightNum) && demoPaddleHeightNum < 1.0;

    const payload = {
      hostIp: form.hostIp.trim(),
      paddleHeight: Number(form.paddleHeight),
      paddleSpeed: Number(form.paddleSpeed),
      ballInitialSpeed: Number(form.ballInitialSpeed),
      ballSpeedIncrement: Number(form.ballSpeedIncrement),
      ballMaxSpeed: Number(form.ballMaxSpeed),
      winScore: Math.round(Number(form.winScore)),
      initialCountdownMs: Math.round(Number(form.initialCountdownMs)),
      pointCountdownMs: Math.round(Number(form.pointCountdownMs)),
      resumeCountdownMs: Math.round(Number(form.resumeCountdownMs)),
      challengeExpiryMs: Math.round(Number(form.challengeExpiryMs)),
      disconnectGraceMs: Math.round(Number(form.disconnectGraceMs)),
      demoPaddleHeight: demoPaddleHeightNum,
      demoAutoMove: demoAutoMoveAllowed ? form.demoAutoMove : false,
      demoPaddleSpeed: Number(form.demoPaddleSpeed),
    };

    for (const [key, val] of Object.entries(payload)) {
      if (key !== 'hostIp' && key !== 'demoAutoMove' && !Number.isFinite(val)) {
        setSaveFeedback({ level: 'err', text: `Invalid numeric value for ${key}.` });
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setAdminToken(null);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Partial<AdminConfigResponse> & {
        error?: string;
      };
      if (!res.ok || !data.config) {
        setSaveFeedback({ level: 'err', text: data.error || 'Failed to save configuration.' });
        return;
      }
      setForm(toFormValues(data.config));
      if (data.serverInfo) setServerInfo(data.serverInfo);
      setSaveFeedback({
        level: 'ok',
        text: 'Configuration saved. New matches and LAN share URLs use these values immediately.',
      });
      onConfigSaved?.();
    } catch {
      setSaveFeedback({ level: 'err', text: 'Network error while saving configuration.' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!adminToken) return;
    setSaving(true);
    setSaveFeedback(null);
    try {
      const res = await fetch('/api/admin/config/reset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401) {
        setAdminToken(null);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Partial<AdminConfigResponse> & {
        error?: string;
      };
      if (!res.ok || !data.config) {
        setSaveFeedback({ level: 'err', text: data.error || 'Failed to reset configuration.' });
        return;
      }
      setForm(toFormValues(data.config));
      if (data.serverInfo) setServerInfo(data.serverInfo);
      setSaveFeedback({ level: 'ok', text: 'Reset all arena values to defaults.' });
      onConfigSaved?.();
    } catch {
      setSaveFeedback({ level: 'err', text: 'Network error while resetting configuration.' });
    } finally {
      setSaving(false);
    }
  };

  const updateField = (key: Exclude<keyof FormValues, 'demoAutoMove'>, value: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      if (key === 'demoPaddleHeight') {
        const parsed = Number(value);
        const isFullHeight = Number.isFinite(parsed) && parsed >= 1.0;
        return {
          ...prev,
          demoPaddleHeight: value,
          demoAutoMove: isFullHeight ? false : prev.demoAutoMove,
        };
      }
      return { ...prev, [key]: value };
    });
  };

  const demoHeightVal = form ? Number(form.demoPaddleHeight) : 1.0;
  const demoIsFullHeight = !Number.isFinite(demoHeightVal) || demoHeightVal >= 1.0;
  const demoPercent = Number.isFinite(demoHeightVal)
    ? Math.max(0, Math.min(100, Math.round(demoHeightVal * 100)))
    : 100;

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-100">
            Arena Admin Configuration
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Configure host LAN IP, paddle geometry, ball velocities, match rounds, and timeouts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {adminToken && (
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-300 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Lock className="w-3.5 h-3.5" />
              Lock Session
            </button>
          )}
          <button
            type="button"
            onClick={onBackToArena}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-200 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Arena
          </button>
        </div>
      </div>

      {!adminToken && (
        <section className="mt-8 max-w-md mx-auto bg-[#151e29] border border-white/10 rounded-xl p-6 shadow-xl">
          <div className="flex items-center gap-2.5 text-emerald-400">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <h2 className="font-display text-xl font-bold text-slate-100">
              {needsSetup === true ? 'Set Up Admin Passcode' : 'Admin Sign In'}
            </h2>
          </div>

          <p className="mt-2 text-sm text-slate-400">
            {needsSetup === true
              ? 'No ADMIN_PASSCODE is configured in the environment. Create a passcode for this server instance to protect configuration changes.'
              : 'Enter the server admin passcode to unlock configuration settings.'}
          </p>

          {authError && (
            <div
              role="alert"
              className="mt-4 px-3.5 py-2.5 text-xs font-medium text-red-200 bg-red-950/60 border border-red-500/30 rounded-lg"
            >
              {authError}
            </div>
          )}

          {needsSetup === true ? (
            <form onSubmit={handleSetupSubmit} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="admin-setup-passcode"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  New Admin Passcode (min 6 characters)
                </label>
                <input
                  id="admin-setup-passcode"
                  type="password"
                  autoComplete="new-password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="admin-setup-confirm"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Confirm Passcode
                </label>
                <input
                  id="admin-setup-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPasscode}
                  onChange={(e) => setConfirmPasscode(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={authBusy}
                className="w-full px-4 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg transition-colors"
              >
                {authBusy ? 'Claiming Admin Access…' : 'Create Passcode & Unlock'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLoginSubmit} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="admin-login-passcode"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Admin Passcode
                </label>
                <input
                  id="admin-login-passcode"
                  type="password"
                  autoComplete="current-password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={authBusy || needsSetup === null}
                className="w-full px-4 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 rounded-lg transition-colors"
              >
                {authBusy ? 'Verifying…' : 'Unlock Admin Settings'}
              </button>
            </form>
          )}
        </section>
      )}

      {adminToken && (loadingConfig || !form) && (
        <div className="mt-8 bg-[#151e29] border border-white/10 rounded-xl p-8 text-center text-sm text-slate-400">
          Loading server configuration…
        </div>
      )}

      {adminToken && form && (
        <form onSubmit={handleSaveConfig} className="mt-6 space-y-6">
          {saveFeedback && (
            <div
              role={saveFeedback.level === 'err' ? 'alert' : 'status'}
              className={`px-4 py-3 text-sm font-medium rounded-lg border flex items-center gap-2 ${
                saveFeedback.level === 'ok'
                  ? 'bg-emerald-950/50 border-emerald-500/35 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/35 text-red-200'
              }`}
            >
              {saveFeedback.level === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              {saveFeedback.text}
            </div>
          )}

          {/* Host IP & LAN Discovery */}
          <section className="bg-[#151e29] border border-white/10 rounded-xl p-6">
            <h2 className="font-display text-xl font-bold text-slate-100">
              Host IP &amp; LAN Share Address
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Set an explicit LAN IPv4 address, hostname, or full URL (for example{' '}
              <code className="font-mono-tabular text-slate-200">192.168.1.42</code>) when running
              inside Docker where host interfaces are hidden. Leave blank for automatic detection.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label
                  htmlFor="cfg-host-ip"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Configured Host IP / URL
                </label>
                <input
                  id="cfg-host-ip"
                  type="text"
                  value={form.hostIp}
                  onChange={(e) => updateField('hostIp', e.target.value)}
                  placeholder="e.g. 192.168.1.42 or http://192.168.1.42:3000"
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              {serverInfo && (
                <div className="px-3.5 py-2.5 bg-[#0d131a] border border-white/10 rounded-lg text-xs">
                  <div className="text-slate-400">Active Share URL</div>
                  <div className="mt-0.5 font-mono-tabular text-slate-100 truncate">
                    {serverInfo.lanUrls[0] ?? serverInfo.primaryUrl}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Paddle & Ball Physics */}
          <section className="bg-[#151e29] border border-white/10 rounded-xl p-6">
            <h2 className="font-display text-xl font-bold text-slate-100">
              Paddle &amp; Ball Physics
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Normalized court height is <span className="font-mono-tabular">1.0</span> (for
              example, <span className="font-mono-tabular">0.19</span> equals 19% of court height).
              Applies to all newly started matches.
            </p>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="cfg-paddle-height"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Paddle Length (0.08 – 0.45)
                </label>
                <input
                  id="cfg-paddle-height"
                  type="number"
                  step="0.01"
                  min="0.08"
                  max="0.45"
                  value={form.paddleHeight}
                  onChange={(e) => updateField('paddleHeight', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-paddle-speed"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Paddle Speed (0.30 – 2.50)
                </label>
                <input
                  id="cfg-paddle-speed"
                  type="number"
                  step="0.02"
                  min="0.3"
                  max="2.5"
                  value={form.paddleSpeed}
                  onChange={(e) => updateField('paddleSpeed', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-ball-init"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Ball Initial Speed (0.30 – 1.80)
                </label>
                <input
                  id="cfg-ball-init"
                  type="number"
                  step="0.02"
                  min="0.3"
                  max="1.8"
                  value={form.ballInitialSpeed}
                  onChange={(e) => updateField('ballInitialSpeed', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-ball-inc"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Ball Speed Increment / Hit (0.00 – 0.25)
                </label>
                <input
                  id="cfg-ball-inc"
                  type="number"
                  step="0.005"
                  min="0"
                  max="0.25"
                  value={form.ballSpeedIncrement}
                  onChange={(e) => updateField('ballSpeedIncrement', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-ball-max"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Ball Max Speed (0.50 – 3.00)
                </label>
                <input
                  id="cfg-ball-max"
                  type="number"
                  step="0.02"
                  min="0.5"
                  max="3.0"
                  value={form.ballMaxSpeed}
                  onChange={(e) => updateField('ballMaxSpeed', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
            </div>
          </section>

          {/* Game Rounds & Timeouts */}
          <section className="bg-[#151e29] border border-white/10 rounded-xl p-6">
            <h2 className="font-display text-xl font-bold text-slate-100">
              Game Rounds &amp; Timeout Values
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Set the winning score limit and server timing windows in milliseconds.
            </p>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="cfg-win-score"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Game Rounds / Points to Win (1 – 21)
                </label>
                <input
                  id="cfg-win-score"
                  type="number"
                  step="1"
                  min="1"
                  max="21"
                  value={form.winScore}
                  onChange={(e) => updateField('winScore', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-challenge-expiry"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Challenge Timeout (ms, 5000 – 120000)
                </label>
                <input
                  id="cfg-challenge-expiry"
                  type="number"
                  step="500"
                  min="5000"
                  max="120000"
                  value={form.challengeExpiryMs}
                  onChange={(e) => updateField('challengeExpiryMs', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-disconnect-grace"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Disconnect Grace Timeout (ms, 3000 – 60000)
                </label>
                <input
                  id="cfg-disconnect-grace"
                  type="number"
                  step="500"
                  min="3000"
                  max="60000"
                  value={form.disconnectGraceMs}
                  onChange={(e) => updateField('disconnectGraceMs', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-init-countdown"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Initial Match Countdown (ms, 1000 – 10000)
                </label>
                <input
                  id="cfg-init-countdown"
                  type="number"
                  step="250"
                  min="1000"
                  max="10000"
                  value={form.initialCountdownMs}
                  onChange={(e) => updateField('initialCountdownMs', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-point-countdown"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  After-Point Countdown (ms, 500 – 5000)
                </label>
                <input
                  id="cfg-point-countdown"
                  type="number"
                  step="250"
                  min="500"
                  max="5000"
                  value={form.pointCountdownMs}
                  onChange={(e) => updateField('pointCountdownMs', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="cfg-resume-countdown"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Reconnect Resume Countdown (ms, 500 – 5000)
                </label>
                <input
                  id="cfg-resume-countdown"
                  type="number"
                  step="250"
                  min="500"
                  max="5000"
                  value={form.resumeCountdownMs}
                  onChange={(e) => updateField('resumeCountdownMs', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
            </div>
          </section>

          {/* Demo User Configuration */}
          <section className="bg-[#151e29] border border-white/10 rounded-xl p-6">
            <h2 className="font-display text-xl font-bold text-slate-100">Demo User</h2>
            <p className="mt-1 text-xs text-slate-400">
              Configure the virtual Demo Player practice opponent. Auto movement is available only
              when paddle length is less than <span className="font-mono-tabular">100%</span> (
              <span className="font-mono-tabular">1.0</span>).
            </p>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="cfg-demo-paddle-height"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Demo Paddle Length (0.08 – 1.00)
                  </label>
                  <span className="text-xs font-mono-tabular text-slate-400">{demoPercent}%</span>
                </div>
                <input
                  id="cfg-demo-paddle-height"
                  type="number"
                  step="0.01"
                  min="0.08"
                  max="1.0"
                  value={form.demoPaddleHeight}
                  onChange={(e) => updateField('demoPaddleHeight', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-300 mb-1.5">
                  Auto Movement
                </span>
                <div className="flex items-center gap-1 p-1 bg-[#0d131a] border border-white/15 rounded-lg">
                  <button
                    type="button"
                    disabled={demoIsFullHeight}
                    onClick={() =>
                      setForm((prev) => (prev ? { ...prev, demoAutoMove: true } : prev))
                    }
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      !demoIsFullHeight && form.demoAutoMove
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    On
                  </button>
                  <button
                    type="button"
                    disabled={demoIsFullHeight}
                    onClick={() =>
                      setForm((prev) => (prev ? { ...prev, demoAutoMove: false } : prev))
                    }
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      demoIsFullHeight || !form.demoAutoMove
                        ? 'bg-[#1e2a38] text-slate-100'
                        : 'text-slate-400 hover:text-slate-200 disabled:opacity-40'
                    }`}
                  >
                    Off
                  </button>
                </div>
                {demoIsFullHeight && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    Disabled while paddle length is 100%.
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="cfg-demo-paddle-speed"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Auto Movement Speed (0.20 – 2.50)
                </label>
                <input
                  id="cfg-demo-paddle-speed"
                  type="number"
                  step="0.02"
                  min="0.2"
                  max="2.5"
                  disabled={demoIsFullHeight || !form.demoAutoMove}
                  value={form.demoPaddleSpeed}
                  onChange={(e) => updateField('demoPaddleSpeed', e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-tabular text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg focus:outline-none focus:border-emerald-500 disabled:opacity-45 disabled:cursor-not-allowed"
                  required
                />
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-200 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" />
              Reset Defaults
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
