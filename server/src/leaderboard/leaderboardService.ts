import { DEMO_PLAYER_ID, DEMO_PLAYER_NICKNAME } from '../../../shared/src/constants.ts';
import type {
  LeaderboardEntry,
  LeaderboardSummary,
  MatchOutcomeReason,
} from '../../../shared/src/types.ts';
import type { PlayerSession } from '../sessions/sessionManager.ts';

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
  pingMs: number | null;
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
      existing.pingMs = session.isBot ? 0 : session.pingMs;
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
      pingMs: session.isBot ? 0 : session.pingMs,
    });
  }

  markDisconnected(playerId: string): void {
    const rec = this.records.get(playerId);
    if (!rec || rec.isBot) return;
    rec.connected = false;
    rec.pingMs = null;
  }

  updatePing(playerId: string, pingMs: number): void {
    const rec = this.records.get(playerId);
    if (!rec || rec.isBot) return;
    rec.pingMs = Math.max(0, Math.round(pingMs));
  }

  recordMatchResult(params: {
    winnerId: string;
    loserId: string;
    durationMs: number;
    reason: MatchOutcomeReason;
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
    }
  }

  getEntries(): LeaderboardEntry[] {
    const list = Array.from(this.records.values()).map((r) => ({ ...r }));
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
