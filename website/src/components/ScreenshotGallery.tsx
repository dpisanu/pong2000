import { useState } from 'react';
import { MonitorPlay } from 'lucide-react';
import { assetUrl } from '../assetUrl.ts';

interface ScreenshotItem {
  id: string;
  label: string;
  title: string;
  caption: string;
  path: string;
}

const SCREENSHOTS: readonly ScreenshotItem[] = [
  {
    id: 'lobby',
    label: 'Arena Lobby',
    title: 'Live Player Discovery & Instant Challenges',
    caption:
      'See who is online, check real-time round-trip ping, filter available opponents, or challenge Demo Player immediately.',
    path: 'media/screenshots/arena-lobby.png',
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    title: 'Session Standings, Trophies & Trimmed Ping',
    caption:
      'Tracks overall playtime, active player counts, wins, losses, forfeits, longest match duration, and outlier-trimmed ping.',
    path: 'media/screenshots/leaderboard.png',
  },
  {
    id: 'demo-modes',
    label: 'Demo Modes',
    title: 'Five Configurable Solo Practice Modes',
    caption:
      'Choose Wall, Gap, Honing, Swipe, or Erratic directly from your profile, or keep Default to sample the server pool.',
    path: 'media/screenshots/edit-demo-modes-tab.png',
  },
  {
    id: 'admin',
    label: 'Admin Console',
    title: 'Live Physics, Timeout & LAN Host Controls',
    caption:
      'Tune paddle size, ball acceleration, win score, timeouts, and LAN Host IP at runtime without restarting the container.',
    path: 'media/screenshots/admin.png',
  },
  {
    id: 'profile',
    label: 'Profile Setup',
    title: 'Zero-Account Onboarding with Bundled or Custom Avatars',
    caption:
      'Join in seconds with a nickname and either an 8-emblem SVG gallery pick or an uploaded PNG, JPEG, or WebP avatar.',
    path: 'media/screenshots/initial-profile.png',
  },
  {
    id: 'edit-profile',
    label: 'Edit Profile',
    title: 'Update Identity or Switch Avatars Mid-Session',
    caption:
      'Modify your nickname or swap uploaded emblems cleanly between matches without losing your session history.',
    path: 'media/screenshots/edit-profile-tab.png',
  },
];

export function ScreenshotGallery() {
  const [selectedId, setSelectedId] = useState<string>(SCREENSHOTS[0].id);
  const [failedPaths, setFailedPaths] = useState<Record<string, boolean>>({});

  const active = SCREENSHOTS.find((item) => item.id === selectedId) ?? SCREENSHOTS[0];
  const imgSrc = assetUrl(active.path);
  const hasFailed = Boolean(failedPaths[active.path]);

  return (
    <div className="mt-10">
      <div
        role="tablist"
        aria-label="Pong2000 interface screens"
        className="flex flex-wrap items-center gap-2 pb-5"
      >
        {SCREENSHOTS.map((item) => {
          const isSelected = item.id === active.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelectedId(item.id)}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                isSelected
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'bg-[#151e29] text-slate-300 hover:text-white border border-white/10 hover:border-white/20'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="bg-[#151e29] border border-white/10 rounded-xl overflow-hidden">
        <div className="bg-[#0b1016] aspect-[16/9] w-full flex items-center justify-center overflow-hidden">
          {hasFailed ? (
            <div className="px-6 py-12 text-center max-w-md">
              <MonitorPlay className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="mt-3 text-sm font-semibold text-slate-200">{active.title}</p>
              <p className="mt-1 text-xs text-slate-400">{active.caption}</p>
            </div>
          ) : (
            <img
              src={imgSrc}
              alt={`${active.label} — ${active.title}`}
              referrerPolicy="no-referrer"
              onError={() =>
                setFailedPaths((prev) => ({
                  ...prev,
                  [active.path]: true,
                }))
              }
              className="w-full h-full object-contain"
            />
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-bold text-slate-100">{active.title}</h3>
            <p className="mt-0.5 text-sm text-slate-400">{active.caption}</p>
          </div>
          <span className="font-mono-tabular text-xs text-slate-400 whitespace-nowrap shrink-0">
            {active.label}
          </span>
        </div>
      </div>
    </div>
  );
}
