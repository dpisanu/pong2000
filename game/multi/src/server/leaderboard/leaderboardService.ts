import { DEMO_PLAYER_ID, DEMO_PLAYER_NICKNAME } from '../../shared/constants.ts';
import type {
  LeaderboardEntry,
  LeaderboardSummary,
  MatchOutcomeReason,
} from '../../shared/types.ts';
import type { PlayerSession } from '../sessions/sessionManager.ts';

export interface MatchPingRange {
  minMs: number;
  maxMs: number;
}

interface MutableLeaderboardRecord {
  playerId: string;
  nickname: string;
  avatarUrl: string;
  isBot: boolean;
  connected: boolean;
  matchesPlayed: number;
  wins: number;
  losses: number;
  forfeits: number;
  longestMatchMs: number;
  matchPingDatapoints: number[];
  pingMs: number | null;
}

export function computeTrimmedAveragePing(datapoints: readonly number[]): number | null {
  if (datapoints.length === 0) return null;
  const sorted = [...datapoints]
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  // Drop the single overall lowest and overall highest outlier when more than 2 datapoints exist
  const trimmed = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  const sum = trimmed.reduce((acc, value) => acc + value, 0);
  return Math.round(sum / trimmed.length);
}

export class LeaderboardService {
  private readonly records = new Map<string, MutableLeaderboardRecord>();
  private totalPlayTimeMs = 0;

  constructor(includeDemoBot = true) {
    if (includeDemoBot) {
      this.records.set(DEMO_PLAYER_ID, {
        playerId: DEMO_PLAYER_ID,
        nickname: DEMO_PLAYER_NICKNAME,
        avatarUrl: '/avatars/spin-owl.svg',
        isBot: true,
        connected: true,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        forfeits: 0,
        longestMatchMs: 0,
        matchPingDatapoints: [],
        pingMs: 0,
      });
    }
  }

  upsertPlayer(session: PlayerSession): void {
    const existing = this.records.get(session.playerId);
    if (existing) {
      existing.nickname = session.nickname;
      existing.avatarUrl = session.avatarUrl;
      existing.isBot = Boolean(session.isBot);
      existing.connected = session.connected;
      if (existing.isBot) {
        existing.pingMs = 0;
      }
      return;
    }

    this.records.set(session.playerId, {
      playerId: session.playerId,
      nickname: session.nickname,
      avatarUrl: session.avatarUrl,
      isBot: Boolean(session.isBot),
      connected: session.connected,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      forfeits: 0,
      longestMatchMs: 0,
      matchPingDatapoints: [],
      pingMs: session.isBot ? 0 : null,
    });
  }

  markDisconnected(playerId: string): void {
    const rec = this.records.get(playerId);
    if (!rec || rec.isBot) return;
    rec.connected = false;
  }

  private appendMatchPingRange(rec: MutableLeaderboardRecord, range?: MatchPingRange | null): void {
    if (rec.isBot || !range) return;
    if (!Number.isFinite(range.minMs) || !Number.isFinite(range.maxMs)) return;
    const minMs = Math.max(0, Math.round(range.minMs));
    const maxMs = Math.max(minMs, Math.round(range.maxMs));
    rec.matchPingDatapoints.push(minMs, maxMs);
    rec.pingMs = computeTrimmedAveragePing(rec.matchPingDatapoints);
  }

  recordMatchResult(params: {
    winnerId: string;
    loserId: string;
    durationMs: number;
    reason: MatchOutcomeReason;
    winnerPingRange?: MatchPingRange | null;
    loserPingRange?: MatchPingRange | null;
  }): void {
    const duration = Math.max(1, Math.round(params.durationMs));
    this.totalPlayTimeMs += duration;
    const isForfeit =
      params.reason === 'FORFEIT_LEAVE' || params.reason === 'FORFEIT_DISCONNECT';

    const winner = this.records.get(params.winnerId);
    if (winner) {
      winner.matchesPlayed += 1;
      winner.wins += 1;
      if (duration > winner.longestMatchMs) {
        winner.longestMatchMs = duration;
      }
      this.appendMatchPingRange(winner, params.winnerPingRange);
    }

    const loser = this.records.get(params.loserId);
    if (loser) {
      loser.matchesPlayed += 1;
      loser.losses += 1;
      if (isForfeit) {
        loser.forfeits += 1;
      }
      if (duration > loser.longestMatchMs) {
        loser.longestMatchMs = duration;
      }
      this.appendMatchPingRange(loser, params.loserPingRange);
    }
  }

  getEntries(): LeaderboardEntry[] {
    const list: LeaderboardEntry[] = Array.from(this.records.values()).map((r) => ({
      playerId: r.playerId,
      nickname: r.nickname,
      avatarUrl: r.avatarUrl,
      isBot: r.isBot,
      connected: r.connected,
      matchesPlayed: r.matchesPlayed,
      wins: r.wins,
      losses: r.losses,
      forfeits: r.forfeits,
      longestMatchMs: r.longestMatchMs,
      pingMs: r.pingMs,
    }));
    list.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const aWinRate = a.matchesPlayed > 0 ? a.wins / a.matchesPlayed : -1;
      const bWinRate = b.matchesPlayed > 0 ? b.wins / b.matchesPlayed : -1;
      if (bWinRate !== aWinRate) return bWinRate - aWinRate;
      if (a.forfeits !== b.forfeits) return a.forfeits - b.forfeits;
      if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
      if (b.longestMatchMs !== a.longestMatchMs) return b.longestMatchMs - a.longestMatchMs;
      return a.nickname.localeCompare(b.nickname);
    });
    return list;
  }

  getSummary(): LeaderboardSummary {
    let totalPlayerCount = 0;
    for (const rec of this.records.values()) {
      if (!rec.isBot) {
        totalPlayerCount += 1;
      }
    }
    return {
      totalPlayTimeMs: this.totalPlayTimeMs,
      totalPlayerCount,
    };
  }
}
