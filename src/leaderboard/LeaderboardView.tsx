import { ArrowLeft, Clock, RefreshCw, Trophy, Users } from 'lucide-react';
import type { LeaderboardEntry, LeaderboardSummary } from '../../shared/src/types.ts';
import { AvatarImg } from '../components/AvatarImg.tsx';

interface LeaderboardViewProps {
  entries: LeaderboardEntry[];
  summary: LeaderboardSummary;
  selfPlayerId: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onBackToLobby: () => void;
}

function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function formatTotalPlayTimeMs(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

function renderRankTrophy(rank: number) {
  if (rank === 1) {
    return (
      <Trophy
        className="w-4 h-4 text-amber-400 shrink-0"
        aria-label="Gold trophy — 1st place"
      />
    );
  }
  if (rank === 2) {
    return (
      <Trophy
        className="w-4 h-4 text-slate-300 shrink-0"
        aria-label="Silver trophy — 2nd place"
      />
    );
  }
  if (rank === 3) {
    return (
      <Trophy
        className="w-4 h-4 text-[#cd7f32] shrink-0"
        aria-label="Bronze trophy — 3rd place"
      />
    );
  }
  return null;
}

function formatPingCell(entry: LeaderboardEntry): { text: string; colorClass: string } {
  if (entry.isBot) {
    return { text: '0 ms · Local', colorClass: 'text-slate-400' };
  }
  if (entry.pingMs === null) {
    return entry.connected
      ? { text: '—', colorClass: 'text-slate-500' }
      : { text: 'Offline', colorClass: 'text-slate-500' };
  }
  if (entry.pingMs >= 100) {
    return { text: `${entry.pingMs} ms · High lag`, colorClass: 'text-red-400' };
  }
  if (entry.pingMs >= 50) {
    return { text: `${entry.pingMs} ms · Moderate lag`, colorClass: 'text-amber-300' };
  }
  return { text: `${entry.pingMs} ms · Low`, colorClass: 'text-emerald-400' };
}

export function LeaderboardView({
  entries,
  summary,
  selfPlayerId,
  loading,
  error,
  onRefresh,
  onBackToLobby,
}: LeaderboardViewProps) {
  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-100">
            Arena Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Live session rankings since server start · Includes Demo Player · Avg ping drops lowest &amp; highest match outliers · Resets on restart
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-300 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onBackToLobby}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-200 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Lobby
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 px-4 py-3 text-sm font-medium text-red-200 bg-red-950/60 border border-red-500/35 rounded-lg"
        >
          {error}
        </div>
      )}

      <section
        aria-label="Session overview"
        className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <div className="bg-[#151e29] border border-white/10 rounded-xl px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Overall Time Played
            </p>
            <p className="mt-1.5 font-display text-2xl font-bold tracking-tight font-mono-tabular text-slate-100">
              {formatTotalPlayTimeMs(summary.totalPlayTimeMs)}
            </p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-[#111922] border border-white/10 flex items-center justify-center text-emerald-400 shrink-0">
            <Clock className="w-5 h-5" aria-hidden="true" />
          </div>
        </div>

        <div className="bg-[#151e29] border border-white/10 rounded-xl px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Overall Player Count
            </p>
            <p className="mt-1.5 font-display text-2xl font-bold tracking-tight font-mono-tabular text-slate-100">
              {summary.totalPlayerCount}
            </p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-[#111922] border border-white/10 flex items-center justify-center text-emerald-400 shrink-0">
            <Users className="w-5 h-5" aria-hidden="true" />
          </div>
        </div>
      </section>

      <section className="mt-4 bg-[#151e29] border border-white/10 rounded-xl overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-400">
            Loading leaderboard standings…
          </div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-400">
            No players recorded yet during this server session.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-xs font-medium text-slate-400 bg-[#111922]/60">
                  <th className="py-3.5 pl-6 pr-3 whitespace-nowrap">Rank</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Player</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Played</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Won</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Lost</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Forfeited</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Longest Match</th>
                  <th className="py-3.5 pl-4 pr-6 text-right whitespace-nowrap">Avg Ping / Lag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-sm">
                {entries.map((entry, idx) => {
                  const rank = idx + 1;
                  const isSelf = selfPlayerId !== null && entry.playerId === selfPlayerId;
                  const pingMeta = formatPingCell(entry);
                  return (
                    <tr
                      key={entry.playerId}
                      className={`transition-colors ${
                        isSelf ? 'bg-emerald-500/[0.05]' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <td className="py-3.5 pl-6 pr-3 font-mono-tabular text-slate-400 whitespace-nowrap">
                        #{rank}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <AvatarImg
                            src={entry.avatarUrl}
                            alt={entry.nickname}
                            size={36}
                            className="w-9 h-9 rounded-lg border border-white/10 shrink-0"
                          />
                          <div className="flex items-center gap-2 min-w-0">
                            {renderRankTrophy(rank)}
                            <span className="font-medium text-slate-100 truncate">
                              {entry.nickname}
                            </span>
                            {isSelf && (
                              <span className="text-xs font-medium text-emerald-400 whitespace-nowrap shrink-0">
                                · You
                              </span>
                            )}
                            {entry.isBot && (
                              <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">
                                · Demo
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-slate-200 whitespace-nowrap">
                        {entry.matchesPlayed}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular font-semibold text-emerald-400 whitespace-nowrap">
                        {entry.wins}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-slate-300 whitespace-nowrap">
                        {entry.losses}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-slate-300 whitespace-nowrap">
                        {entry.forfeits}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-slate-200 whitespace-nowrap">
                        {formatDurationMs(entry.longestMatchMs)}
                      </td>
                      <td
                        className={`py-3.5 pl-4 pr-6 text-right font-mono-tabular text-xs whitespace-nowrap ${pingMeta.colorClass}`}
                      >
                        {pingMeta.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
