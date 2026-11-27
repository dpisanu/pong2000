import { useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import {
  BUNDLED_AVATARS,
  DEFAULT_AVATAR_ID,
  DEMO_ERRATIC_PADDLE_HEIGHT,
  DEMO_ERRATIC_SPEED,
  DEMO_GAP_PADDLE_HEIGHT,
  DEMO_HONING_PADDLE_HEIGHT,
  DEMO_HONING_SPEED,
  DEMO_SWIPE_PADDLE_HEIGHT,
  DEMO_SWIPE_SPEED,
  MAX_AVATAR_BYTES,
  MAX_NICKNAME_LENGTH,
} from '../../shared/constants.ts';
import type {
  DemoModePreference,
  PlayerProfile,
  PublicArenaConfig,
} from '../../shared/types.ts';
import {
  normalizeDemoModePreference,
  resolveAvatarUrl,
  sanitizeNickname,
} from '../../shared/validation.ts';
import { AvatarImg } from '../components/AvatarImg.tsx';
import { uploadAvatarFile } from '../network/arenaClient.ts';

interface ProfileSetupViewProps {
  mode: 'onboarding' | 'edit';
  initialProfile: PlayerProfile | null;
  arenaConfig?: PublicArenaConfig;
  uploadToken: string | null;
  serverError?: string | null;
  saving?: boolean;
  onClearServerError?: () => void;
  onSave: (profile: PlayerProfile, pendingFile?: File | null) => void;
  onCancel?: () => void;
}

type EditTab = 'profile' | 'demoModes';

const ACCEPTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function formatGlobalDefaultPool(arenaConfig?: PublicArenaConfig): string {
  if (!arenaConfig) return 'Wall';
  const enabled: string[] = [];
  if (arenaConfig.demoModes.wall.enabled) enabled.push('Wall');
  if (arenaConfig.demoModes.gap.enabled) enabled.push('Gap');
  if (arenaConfig.demoModes.honing.enabled) enabled.push('Honing');
  if (arenaConfig.demoModes.swipe.enabled) enabled.push('Swipe');
  if (arenaConfig.demoModes.erratic.enabled) enabled.push('Erratic');
  return enabled.length > 0 ? enabled.join(', ') : 'Wall';
}

export function ProfileSetupView({
  mode,
  initialProfile,
  arenaConfig,
  uploadToken,
  serverError,
  saving = false,
  onClearServerError,
  onSave,
  onCancel,
}: ProfileSetupViewProps) {
  const [activeTab, setActiveTab] = useState<EditTab>('profile');
  const [nickname, setNickname] = useState(initialProfile?.nickname ?? '');
  const [avatarId, setAvatarId] = useState(initialProfile?.avatarId ?? DEFAULT_AVATAR_ID);
  const [demoModePreference, setDemoModePreference] = useState<DemoModePreference>(() =>
    mode === 'onboarding'
      ? 'default'
      : normalizeDemoModePreference(initialProfile?.demoModePreference),
  );
  const [previewUrl, setPreviewUrl] = useState(
    resolveAvatarUrl(initialProfile?.avatarId ?? DEFAULT_AVATAR_ID),
  );
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const handleSelectBundled = (id: string, url: string) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPendingFile(null);
    setAvatarId(id);
    setPreviewUrl(url);
    setError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
      setError('Unsupported file type. Please choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('Image is too large. Maximum file size is 1 MiB.');
      return;
    }

    if (uploadToken) {
      setUploading(true);
      try {
        const uploaded = await uploadAvatarFile(file, uploadToken);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        setPendingFile(null);
        setAvatarId(uploaded.avatarId);
        setPreviewUrl(uploaded.avatarUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload avatar.');
      } finally {
        setUploading(false);
      }
      return;
    }

    // First-visit onboarding before WS handshake completes: preview locally and upload on connect
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const localUrl = URL.createObjectURL(file);
    objectUrlRef.current = localUrl;
    setPendingFile(file);
    setPreviewUrl(localUrl);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const checked = sanitizeNickname(nickname);
    if (!checked.ok) {
      setActiveTab('profile');
      setError(checked.error);
      return;
    }
    onSave(
      {
        nickname: checked.value,
        avatarId,
        demoModePreference: mode === 'onboarding' ? 'default' : demoModePreference,
      },
      pendingFile,
    );
  };

  const trimmedLength = Array.from(nickname.trim().replace(/\s+/g, ' ')).length;
  const globalDefaultPool = formatGlobalDefaultPool(arenaConfig);

  const gapHeightPct = Math.round(
    (arenaConfig?.demoModes.gap.paddleHeight ?? DEMO_GAP_PADDLE_HEIGHT) * 100,
  );
  const honingHeightPct = Math.round(
    (arenaConfig?.demoModes.honing.paddleHeight ?? DEMO_HONING_PADDLE_HEIGHT) * 100,
  );
  const honingSpeed = (arenaConfig?.demoModes.honing.speed ?? DEMO_HONING_SPEED).toFixed(2);
  const swipeHeightPct = Math.round(
    (arenaConfig?.demoModes.swipe.paddleHeight ?? DEMO_SWIPE_PADDLE_HEIGHT) * 100,
  );
  const swipeSpeed = (arenaConfig?.demoModes.swipe.speed ?? DEMO_SWIPE_SPEED).toFixed(2);
  const erraticHeightPct = Math.round(
    (arenaConfig?.demoModes.erratic.paddleHeight ?? DEMO_ERRATIC_PADDLE_HEIGHT) * 100,
  );
  const erraticSpeed = (arenaConfig?.demoModes.erratic.speed ?? DEMO_ERRATIC_SPEED).toFixed(2);

  const demoModeOptions: Array<{
    key: DemoModePreference;
    label: string;
    description: string;
    meta: string;
  }> = [
    {
      key: 'default',
      label: 'Default',
      description: 'Uses the global Admin Panel configuration for Demo Player matches.',
      meta: `Global pool: ${globalDefaultPool}`,
    },
    {
      key: 'wall',
      label: 'Wall',
      description: 'Full wall-height stationary paddle for uninterrupted rally practice.',
      meta: 'Length 100% · Stationary',
    },
    {
      key: 'gap',
      label: 'Gap',
      description: 'Centered stationary paddle leaving top and bottom gaps for angled shots.',
      meta: `Length ${gapHeightPct}% · Stationary`,
    },
    {
      key: 'honing',
      label: 'Honing',
      description: "Auto-moves to track the ball's vertical position continuously.",
      meta: `Length ${honingHeightPct}% · Speed ${honingSpeed}`,
    },
    {
      key: 'swipe',
      label: 'Swipe',
      description: 'Sweeps continuously from top to bottom and back up without honing.',
      meta: `Length ${swipeHeightPct}% · Speed ${swipeSpeed}`,
    },
    {
      key: 'erratic',
      label: 'Erratic',
      description: 'Random up and down bursts simulating erratic button presses.',
      meta: `Length ${erraticHeightPct}% · Speed ${erraticSpeed}`,
    },
  ];

  return (
    <div
      className={
        mode === 'onboarding'
          ? 'min-h-screen flex items-center justify-center px-6 py-12 bg-[#0d131a]'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6'
      }
      role={mode === 'edit' ? 'dialog' : undefined}
      aria-modal={mode === 'edit' ? true : undefined}
      aria-labelledby="profile-heading"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#151e29] border border-white/10 rounded-xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-white/10">
          <div>
            <h1
              id="profile-heading"
              className="font-display text-3xl font-bold tracking-tight text-slate-100"
            >
              {mode === 'onboarding' ? 'Enter Pong2000 Arena' : 'Edit Player Profile'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              {mode === 'onboarding'
                ? 'Choose a table nickname and pick a club emblem or upload your own avatar.'
                : 'Update your nickname, avatar, or preferred Demo Player mode.'}
            </p>
          </div>
          {mode === 'edit' && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close profile editor"
              className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {mode === 'edit' && (
          <div
            role="tablist"
            aria-label="Profile editor sections"
            className="mt-5 flex items-center gap-1 p-1 bg-[#0d131a] border border-white/10 rounded-lg w-fit"
          >
            <button
              type="button"
              role="tab"
              id="tab-profile"
              aria-selected={activeTab === 'profile'}
              aria-controls="panel-profile"
              onClick={() => setActiveTab('profile')}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'profile'
                  ? 'bg-[#1e2a38] text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Profile
            </button>
            <button
              type="button"
              role="tab"
              id="tab-demo-modes"
              aria-selected={activeTab === 'demoModes'}
              aria-controls="panel-demo-modes"
              onClick={() => setActiveTab('demoModes')}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'demoModes'
                  ? 'bg-[#1e2a38] text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Demo Player Modes
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          {(mode === 'onboarding' || activeTab === 'profile') && (
            <div
              role={mode === 'edit' ? 'tabpanel' : undefined}
              id={mode === 'edit' ? 'panel-profile' : undefined}
              aria-labelledby={mode === 'edit' ? 'tab-profile' : undefined}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                <div className="flex items-center gap-4">
                  <AvatarImg
                    src={previewUrl}
                    alt="Selected avatar preview"
                    size={80}
                    className="w-20 h-20 rounded-xl border border-white/15"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-200">Active Avatar</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {pendingFile
                        ? 'Custom image ready to upload'
                        : avatarId.startsWith('uploaded:')
                          ? 'Uploaded WebP avatar'
                          : 'Gallery emblem'}
                    </div>
                  </div>
                </div>

                <div className="sm:ml-auto">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFileChange}
                    className="sr-only"
                    id="avatar-file-input"
                  />
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <Upload className="w-4 h-4 text-emerald-400" />
                    {uploading ? 'Processing…' : 'Upload Image'}
                  </button>
                  <p className="mt-1.5 text-xs text-slate-400">PNG, JPEG, or WebP · Max 1 MiB</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="nickname-input" className="text-sm font-medium text-slate-200">
                    Player Nickname
                  </label>
                  <span className="text-xs font-mono-tabular text-slate-400">
                    {trimmedLength} / {MAX_NICKNAME_LENGTH}
                  </span>
                </div>
                <input
                  id="nickname-input"
                  type="text"
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    if (error) setError(null);
                    if (serverError) onClearServerError?.();
                  }}
                  maxLength={36}
                  placeholder="e.g. Alex"
                  autoFocus
                  className="w-full px-4 py-3 text-base text-slate-100 bg-[#0d131a] border border-white/15 rounded-lg placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <div className="text-sm font-medium text-slate-200 mb-3">Bundled Gallery</div>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
                  {BUNDLED_AVATARS.map((item) => {
                    const selected = !pendingFile && avatarId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectBundled(item.id, item.url)}
                        title={item.label}
                        aria-label={`Select ${item.label}`}
                        aria-pressed={selected}
                        className={`group relative flex items-center justify-center p-1.5 rounded-xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                          selected
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-white/10 bg-[#0d131a] hover:border-white/25'
                        }`}
                      >
                        <AvatarImg
                          src={item.url}
                          alt={item.label}
                          size={48}
                          className="w-12 h-12 rounded-lg"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {mode === 'edit' && activeTab === 'demoModes' && (
            <div
              role="tabpanel"
              id="panel-demo-modes"
              aria-labelledby="tab-demo-modes"
              className="space-y-4"
            >
              <p className="text-xs text-slate-400 leading-relaxed">
                Select one Demo Player playing mode for your practice matches. Keeping{' '}
                <span className="text-slate-200 font-medium">Default</span> active uses the global
                Admin configuration. Mode geometry and speed values are configured globally in Admin.
              </p>

              <div className="divide-y divide-white/10 border-t border-b border-white/10">
                {demoModeOptions.map((option) => {
                  const isActive = demoModePreference === option.key;
                  const isDefault = option.key === 'default';
                  return (
                    <div
                      key={option.key}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-100">
                            {option.label}
                          </span>
                          <span className="text-slate-500 text-xs" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-xs font-mono-tabular text-slate-400">
                            {option.meta}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">{option.description}</p>
                      </div>

                      <div
                        className="flex items-center gap-1 p-1 bg-[#0d131a] border border-white/15 rounded-lg w-[132px] shrink-0"
                        role="group"
                        aria-label={`${option.label} mode preference`}
                      >
                        <button
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => setDemoModePreference(option.key)}
                          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                            isActive
                              ? 'bg-emerald-500 text-slate-950 font-semibold'
                              : 'text-slate-300 hover:text-white'
                          }`}
                        >
                          On
                        </button>
                        <button
                          type="button"
                          aria-pressed={!isActive}
                          disabled={isDefault && isActive}
                          onClick={() => {
                            if (!isDefault) {
                              setDemoModePreference('default');
                            }
                          }}
                          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                            !isActive
                              ? 'bg-[#1e2a38] text-slate-100'
                              : 'text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed'
                          }`}
                        >
                          Off
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(error || serverError) && (
            <div
              role="alert"
              className="px-4 py-3 text-sm text-red-200 bg-red-950/50 border border-red-500/30 rounded-lg"
            >
              {error ?? serverError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            {mode === 'edit' && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2.5 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-white/5 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={uploading || saving}
              className="px-6 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              {saving
                ? 'Checking…'
                : mode === 'onboarding'
                  ? 'Enter Lobby'
                  : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
