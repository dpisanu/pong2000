export type PlayerStatus = 'AVAILABLE' | 'INVITED' | 'IN_GAME' | 'DISCONNECTED';

export type ChallengeStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'MATCH_CREATED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'INVALIDATED';

export type MatchPhase =
  | 'CREATED'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'PAUSED_DISCONNECT'
  | 'FINISHED'
  | 'FORFEITED'
  | 'CLOSED';

export type MatchOutcomeReason =
  | 'SCORE_LIMIT'
  | 'FORFEIT_LEAVE'
  | 'FORFEIT_DISCONNECT';

export type PaddleSide = 'left' | 'right';

export type ErrorCode =
  | 'PROTOCOL_MISMATCH'
  | 'INVALID_MESSAGE'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'INVALID_PROFILE'
  | 'NICKNAME_TAKEN'
  | 'PLAYER_NOT_FOUND'
  | 'PLAYER_UNAVAILABLE'
  | 'SELF_CHALLENGE'
  | 'ALREADY_BUSY'
  | 'CHALLENGE_NOT_FOUND'
  | 'CHALLENGE_CLOSED'
  | 'MATCH_NOT_FOUND'
  | 'NOT_MATCH_PARTICIPANT'
  | 'INVALID_MATCH_STATE';

export interface PlayerProfile {
  nickname: string;
  avatarId: string;
}

export interface LobbyPlayer {
  playerId: string;
  nickname: string;
  avatarId: string;
  avatarUrl: string;
  status: PlayerStatus;
}

export interface ChallengeInfo {
  challengeId: string;
  fromPlayerId: string;
  fromNickname: string;
  fromAvatarUrl: string;
  toPlayerId: string;
  toNickname: string;
  toAvatarUrl: string;
  status: ChallengeStatus;
  expiresAt: number;
  reason?: string;
}

export interface MatchParticipant {
  playerId: string;
  nickname: string;
  avatarId: string;
  avatarUrl: string;
  side: PaddleSide;
  connected: boolean;
}

export interface MatchSnapshot {
  matchId: string;
  tick: number;
  phase: MatchPhase;
  ball: {
    x: number;
    y: number;
    vx: number;
    vy: number;
  };
  paddles: {
    leftY: number;
    rightY: number;
  };
  score: {
    left: number;
    right: number;
  };
  countdownEndsAt?: number | null;
  paddlesUnlocked?: boolean;
  pausedReason?: string | null;
  pauseExpiresAt?: number | null;
  disconnectedPlayerId?: string | null;
}

export interface MatchRematchState {
  matchId: string;
  requestedByPlayerId: string | null;
  acceptedByPlayerId: string | null;
  status: 'NONE' | 'PENDING' | 'ACCEPTED' | 'CANCELLED';
}

export interface ActiveMatchSync {
  matchId: string;
  yourSide: PaddleSide;
  participants: [MatchParticipant, MatchParticipant];
  snapshot: MatchSnapshot;
  rematch: MatchRematchState;
  winnerPlayerId?: string | null;
  outcomeReason?: MatchOutcomeReason | null;
}
