import { useEffect, useState } from 'react';
import { Swords, UserPlus } from 'lucide-react';
import type {
  ChallengeInfo,
  LobbyPlayer,
  PlayerStatus,
  PublicArenaConfig,
} from '../../shared/src/types.ts';
import { AvatarImg } from '../components/AvatarImg.tsx';

interface LobbyViewProps {
  selfPlayerId: string | null;
  players: LobbyPlayer[];
  activeChallenge: ChallengeInfo | null;
  arenaConfig: PublicArenaConfig;
  connected: boolean;
  onChallenge: (targetPlayerId: string) => void;
  onAcceptChallenge: (challengeId: string) => void;
  onDeclineChallenge: (challengeId: string) => void;
  onCancelChallenge: (challengeId: string) => void;
  onOpenShare: () => void;
  onEditProfile: () => void;
}

function formatStatusText(status: PlayerStatus): { label: string; colorClass: string } {
  switch (status) {
    case 'AVAILABLE':
      return { label: 'Available', colorClass: 'text-emerald-400' };
    case 'INVITED':
      return { label: 'Invited', colorClass: 'text-amber-400' };
    case 'IN_GAME':
      return { label: 'In Match', colorClass: 'text-sky-400' };
    case 'DISCONNECTED':
      return { label: 'Reconnecting', colorClass: 'text-slate-400' };
  }
}

export function LobbyView({
  selfPlayerId,
  players,
  activeChallenge,
  arenaConfig,
  connected,
  onChallenge,
  onAcceptChallenge,
  onDeclineChallenge,
  onCancelChallenge,
  onOpenShare,
  onEditProfile,
}: LobbyViewProps) {
  const [filter, setFilter] = useState<'all' | 'available'>('all');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!activeChallenge) return;
    const timer = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(timer);
  }, [activeChallenge]);

  const selfPlayer = players.find((p) => p.playerId === selfPlayerId) ?? null;
  const otherPlayers = players.filter((p) => p.playerId !== selfPlayerId);
  const humanOpponents = otherPlayers.filter((p) => !p.isBot);
  const visiblePlayers =
    filter === 'available'
      ? otherPlayers.filter((p) => p.status === 'AVAILABLE')
      : otherPlayers;

  const availableCount = otherPlayers.filter((p) => p.status === 'AVAILABLE').length;
  const selfAvailable = selfPlayer?.status === 'AVAILABLE' && !activeChallenge && connected;
  const humanOnlineCount = players.filter((p) => !p.isBot).length;

  const isIncoming =
    activeChallenge !== null &&
    selfPlayerId !== null &&
    activeChallenge.toPlayerId === selfPlayerId;
  const isOutgoing =
    activeChallenge !== null &&
    selfPlayerId !== null &&
    activeChallenge.fromPlayerId === selfPlayerId;

  const challengeSecondsLeft = activeChallenge
    ? Math.max(0, Math.ceil((activeChallenge.expiresAt - nowMs) / 1000))
    : 0;

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Live Player Directory */}
        <section className="lg:col-span-8 bg-[#151e29] border border-white/10 rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b border-white/10">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-100">
                Arena Lobby
              </h1>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-400 font-mono-tabular">
                <span>{humanOnlineCount} players online</span>
                <span aria-hidden="true">·</span>
                <span>{availableCount} opponents ready</span>
              </div>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#0d131a] border border-white/10 rounded-lg">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filter === 'all'
                    ? 'bg-[#1e2a38] text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Players
              </button>
              <button
                type="button"
                onClick={() => setFilter('available')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filter === 'available'
                    ? 'bg-[#1e2a38] text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Available Only
              </button>
            </div>
          </div>

          {visiblePlayers.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-base font-medium text-slate-200">
                {otherPlayers.length === 0
                  ? 'No other players in the lobby yet'
                  : 'No opponents currently available'}
              </p>
              <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
                {otherPlayers.length === 0
                  ? 'Share the server LAN address so another player on your network can open it in their browser.'
                  : 'Players currently in a match or invitation will appear here once free.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/10">
              {visiblePlayers.map((player) => {
                const statusMeta = formatStatusText(player.status);
                const canChallenge = selfAvailable && player.status === 'AVAILABLE';
                return (
                  <li
                    key={player.playerId}
                    className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <AvatarImg
                        src={player.avatarUrl}
                        alt={player.nickname}
                        size={44}
                        className="w-11 h-11 rounded-lg border border-white/10"
                      />
                      <div className="min-w-0">
                        <div className="text-base font-medium text-slate-100 truncate">
                          {player.nickname}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`font-medium ${statusMeta.colorClass}`}>
                            {statusMeta.label}
                          </span>
                          {player.isBot && (
                            <>
                              <span className="text-slate-500" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-slate-400">
                                {arenaConfig.demoPaddleHeight >= 1.0
                                  ? 'Demo mode · 100% full-height paddle · Auto-accepts'
                                  : `Demo mode · ${Math.round(arenaConfig.demoPaddleHeight * 100)}% paddle · ${
                                      arenaConfig.demoAutoMove
                                        ? `Auto-move (${arenaConfig.demoPaddleSpeed})`
                                        : 'Stationary'
                                    } · Auto-accepts`}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!canChallenge}
                      onClick={() => onChallenge(player.playerId)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <Swords className="w-3.5 h-3.5" />
                      {player.isBot ? 'Start Demo' : 'Challenge'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {humanOpponents.length === 0 && (
            <div className="px-6 py-5 border-t border-white/10 bg-[#111922]/60 flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs text-slate-400">
                Practice against <span className="text-slate-200 font-medium">Demo Player</span>{' '}
                anytime, or invite another player on your LAN.
              </div>
              <button
                type="button"
                onClick={onOpenShare}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Show LAN Invite URL
              </button>
            </div>
          )}
        </section>

        {/* Right: Challenge & Profile Panel */}
        <aside className="lg:col-span-4 space-y-6">
          {isIncoming && activeChallenge && (
            <section
              aria-live="polite"
              className="bg-[#151e29] border border-amber-500/40 rounded-xl p-6"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-bold text-amber-300">
                  Incoming Challenge
                </h2>
                <span className="font-mono-tabular text-sm font-semibold text-amber-200">
                  {challengeSecondsLeft}s
                </span>
              </div>

              <div className="mt-4 flex items-center gap-3.5">
                <AvatarImg
                  src={activeChallenge.fromAvatarUrl}
                  alt={activeChallenge.fromNickname}
                  size={48}
                  className="w-12 h-12 rounded-lg border border-white/15"
                />
                <div className="min-w-0">
                  <div className="text-base font-semibold text-slate-100 truncate">
                    {activeChallenge.fromNickname}
                  </div>
                  <div className="text-xs text-slate-400">
                    First to {arenaConfig.winScore}{' '}
                    {arenaConfig.winScore === 1 ? 'point' : 'points'}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onAcceptChallenge(activeChallenge.challengeId)}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap"
                >
                  Accept Match
                </button>
                <button
                  type="button"
                  onClick={() => onDeclineChallenge(activeChallenge.challengeId)}
                  className="px-4 py-2.5 text-sm font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg transition-colors whitespace-nowrap"
                >
                  Decline
                </button>
              </div>
            </section>
          )}

          {isOutgoing && activeChallenge && (
            <section
              aria-live="polite"
              className="bg-[#151e29] border border-emerald-500/35 rounded-xl p-6"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-bold text-slate-100">
                  Challenge Sent
                </h2>
                <span className="font-mono-tabular text-sm font-semibold text-emerald-300">
                  {challengeSecondsLeft}s
                </span>
              </div>

              <div className="mt-4 flex items-center gap-3.5">
                <AvatarImg
                  src={activeChallenge.toAvatarUrl}
                  alt={activeChallenge.toNickname}
                  size={48}
                  className="w-12 h-12 rounded-lg border border-white/15"
                />
                <div className="min-w-0">
                  <div className="text-base font-semibold text-slate-100 truncate">
                    {activeChallenge.toNickname}
                  </div>
                  <div className="text-xs text-slate-400">Waiting for opponent response…</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onCancelChallenge(activeChallenge.challengeId)}
                className="mt-5 w-full px-4 py-2.5 text-sm font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg transition-colors"
              >
                Cancel Challenge
              </button>
            </section>
          )}

          <section className="bg-[#151e29] border border-white/10 rounded-xl p-6">
            <h2 className="font-display text-xl font-bold text-slate-100">Your Profile</h2>
            {selfPlayer ? (
              <div className="mt-4 flex items-center gap-3.5">
                <AvatarImg
                  src={selfPlayer.avatarUrl}
                  alt={selfPlayer.nickname}
                  size={48}
                  className="w-12 h-12 rounded-lg border border-white/15"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold text-slate-100 truncate">
                    {selfPlayer.nickname}
                  </div>
                  <div className="text-xs text-emerald-400">
                    {formatStatusText(selfPlayer.status).label}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onEditProfile}
                  className="px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Edit
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Connecting session…</p>
            )}

            <div className="mt-6 pt-5 border-t border-white/10 space-y-2.5 text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span>Controls</span>
                <span className="font-mono-tabular text-slate-200">W / S or ↑ / ↓</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Win Condition</span>
                <span className="font-mono-tabular text-slate-200">
                  First to {arenaConfig.winScore}{' '}
                  {arenaConfig.winScore === 1 ? 'point' : 'points'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Disconnect Grace</span>
                <span className="font-mono-tabular text-slate-200">
                  {Math.round(arenaConfig.disconnectGraceMs / 1000)} seconds
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
