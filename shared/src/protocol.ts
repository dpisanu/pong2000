import { z } from 'zod';
import type {
  ActiveMatchSync,
  ChallengeInfo,
  ErrorCode,
  LobbyPlayer,
  MatchOutcomeReason,
  MatchParticipant,
  MatchPhase,
  MatchRematchState,
  MatchSnapshot,
  PaddleSide,
} from './types.ts';

const RequestIdSchema = z.string().min(1).max(64);

const ProfilePayloadSchema = z.object({
  nickname: z.string().min(1).max(64),
  avatarId: z.string().min(1).max(96),
});

export const ClientCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.hello'),
    requestId: RequestIdSchema,
    payload: z.object({
      protocolVersion: z.number().int(),
      profile: ProfilePayloadSchema,
      recoveryToken: z.string().min(16).max(128).optional(),
    }),
  }),
  z.object({
    type: z.literal('profile.update'),
    requestId: RequestIdSchema,
    payload: ProfilePayloadSchema,
  }),
  z.object({
    type: z.literal('challenge.create'),
    requestId: RequestIdSchema,
    payload: z.object({
      targetPlayerId: z.string().min(1).max(64),
    }),
  }),
  z.object({
    type: z.literal('challenge.accept'),
    requestId: RequestIdSchema,
    payload: z.object({
      challengeId: z.string().min(1).max(64),
    }),
  }),
  z.object({
    type: z.literal('challenge.decline'),
    requestId: RequestIdSchema,
    payload: z.object({
      challengeId: z.string().min(1).max(64),
    }),
  }),
  z.object({
    type: z.literal('challenge.cancel'),
    requestId: RequestIdSchema,
    payload: z.object({
      challengeId: z.string().min(1).max(64),
    }),
  }),
  z.object({
    type: z.literal('match.input'),
    requestId: RequestIdSchema,
    payload: z.object({
      matchId: z.string().min(1).max(64),
      direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
      seq: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    type: z.literal('match.leave'),
    requestId: RequestIdSchema,
    payload: z.object({
      matchId: z.string().min(1).max(64),
    }),
  }),
  z.object({
    type: z.literal('match.rematch.request'),
    requestId: RequestIdSchema,
    payload: z.object({
      matchId: z.string().min(1).max(64),
    }),
  }),
  z.object({
    type: z.literal('match.rematch.accept'),
    requestId: RequestIdSchema,
    payload: z.object({
      matchId: z.string().min(1).max(64),
    }),
  }),
  z.object({
    type: z.literal('lobby.join'),
    requestId: RequestIdSchema,
    payload: z.object({}).optional(),
  }),
]);

export type ClientCommand = z.infer<typeof ClientCommandSchema>;

export type ServerEvent =
  | {
      type: 'session.ready';
      protocolVersion: number;
      serverTime: number;
      payload: {
        playerId: string;
        profile: {
          nickname: string;
          avatarId: string;
          avatarUrl: string;
        };
        recoveryToken: string;
        uploadToken: string;
        recovered: boolean;
        lobby: LobbyPlayer[];
        activeChallenge: ChallengeInfo | null;
        activeMatch: ActiveMatchSync | null;
      };
    }
  | {
      type: 'lobby.snapshot';
      protocolVersion: number;
      serverTime: number;
      payload: {
        players: LobbyPlayer[];
      };
    }
  | {
      type: 'lobby.player.upsert';
      protocolVersion: number;
      serverTime: number;
      payload: {
        player: LobbyPlayer;
      };
    }
  | {
      type: 'lobby.player.remove';
      protocolVersion: number;
      serverTime: number;
      payload: {
        playerId: string;
      };
    }
  | {
      type: 'challenge.received';
      protocolVersion: number;
      serverTime: number;
      payload: {
        challenge: ChallengeInfo;
      };
    }
  | {
      type: 'challenge.updated';
      protocolVersion: number;
      serverTime: number;
      payload: {
        challenge: ChallengeInfo;
      };
    }
  | {
      type: 'match.started';
      protocolVersion: number;
      serverTime: number;
      payload: {
        matchId: string;
        yourSide: PaddleSide;
        participants: [MatchParticipant, MatchParticipant];
        snapshot: MatchSnapshot;
      };
    }
  | {
      type: 'match.snapshot';
      protocolVersion: number;
      serverTime: number;
      payload: MatchSnapshot;
    }
  | {
      type: 'match.phase';
      protocolVersion: number;
      serverTime: number;
      payload: {
        matchId: string;
        phase: MatchPhase;
        countdownEndsAt?: number | null;
        pausedReason?: string | null;
        pauseExpiresAt?: number | null;
        disconnectedPlayerId?: string | null;
        participants?: [MatchParticipant, MatchParticipant];
      };
    }
  | {
      type: 'match.finished';
      protocolVersion: number;
      serverTime: number;
      payload: {
        matchId: string;
        winnerPlayerId: string;
        winnerNickname: string;
        winnerSide: PaddleSide;
        reason: MatchOutcomeReason;
        finalScore: {
          left: number;
          right: number;
        };
      };
    }
  | {
      type: 'match.rematch.updated';
      protocolVersion: number;
      serverTime: number;
      payload: MatchRematchState;
    }
  | {
      type: 'command.ack';
      protocolVersion: number;
      serverTime: number;
      requestId: string;
      payload: {
        commandType: string;
      };
    }
  | {
      type: 'command.error';
      protocolVersion: number;
      serverTime: number;
      requestId?: string;
      payload: {
        code: ErrorCode;
        message: string;
        commandType?: string;
      };
    }
  | {
      type: 'server.notice';
      protocolVersion: number;
      serverTime: number;
      payload: {
        level: 'info' | 'warning';
        message: string;
      };
    };
