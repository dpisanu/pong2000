import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Volume2, VolumeX, LogOut } from 'lucide-react';
import { WIN_SCORE } from '../../shared/constants.ts';
import type {
  ActiveMatchSync,
  MatchOutcomeReason,
  MatchSnapshot,
  PaddleSide,
} from '../../shared/types.ts';
import { soundFx } from '../audio/soundFx.ts';
import { AvatarImg } from '../components/AvatarImg.tsx';
import { PongArenaCanvas } from './PongArenaCanvas.tsx';

interface MatchViewProps {
  match: ActiveMatchSync;
  selfPlayerId: string;
  pingMs: number | null;
  onSendInput: (matchId: string, direction: -1 | 0 | 1, seq: number) => void;
  onLeaveMatch: (matchId: string) => void;
  onRequestRematch: (matchId: string) => void;
  onAcceptRematch: (matchId: string) => void;
  onReturnToLobby: () => void;
  localTwoPlayer?: boolean;
  onSendDualInput?: (side: PaddleSide, direction: -1 | 0 | 1) => void;
  onRestartMatch?: () => void;
}

function formatOutcomeReason(
  reason: MatchOutcomeReason | null | undefined,
  winScore: number,
): string {
  switch (reason) {
    case 'SCORE_LIMIT':
      return `First to ${winScore} ${winScore === 1 ? 'point' : 'points'}`;
    case 'FORFEIT_DISCONNECT':
      return 'Forfeit due to disconnect timeout';
    case 'FORFEIT_LEAVE':
      return 'Opponent left the match';
    default:
      return 'Match complete';
  }
}

export function MatchView({
  match,
  selfPlayerId,
  pingMs,
  onSendInput,
  onLeaveMatch,
  onRequestRematch,
  onAcceptRematch,
  onReturnToLobby,
  localTwoPlayer = false,
  onSendDualInput,
  onRestartMatch,
}: MatchViewProps) {
  const [muted, setMuted] = useState(() => soundFx.isMuted());
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const pressedUpRef = useRef(false);
  const pressedDownRef = useRef(false);
  const lastDirRef = useRef<-1 | 0 | 1>(0);
  const leftUpRef = useRef(false);
  const leftDownRef = useRef(false);
  const lastLeftDirRef = useRef<-1 | 0 | 1>(0);
  const rightUpRef = useRef(false);
  const rightDownRef = useRef(false);
  const lastRightDirRef = useRef<-1 | 0 | 1>(0);
  const onSendInputRef = useRef(onSendInput);
  const onSendDualInputRef = useRef(onSendDualInput);
  const seqRef = useRef(0);
  const prevSnapshotRef = useRef<MatchSnapshot | null>(null);
  const lastCountdownSecRef = useRef<number | null>(null);

  useEffect(() => {
    onSendInputRef.current = onSendInput;
  }, [onSendInput]);

  useEffect(() => {
    onSendDualInputRef.current = onSendDualInput;
  }, [onSendDualInput]);

  useEffect(() => {
    lastCountdownSecRef.current = null;
  }, [match.matchId]);

  const { snapshot, participants, yourSide, rematch, rules } = match;
  const leftPlayer = participants[0];
  const rightPlayer = participants[1];
  const winScore = rules?.winScore ?? WIN_SCORE;

  const isActiveMatch =
    snapshot.phase === 'COUNTDOWN' ||
    snapshot.phase === 'PLAYING' ||
    snapshot.phase === 'PAUSED_DISCONNECT';

  // Timer tick for countdown and disconnect grace display
  useEffect(() => {
    if (
      snapshot.phase !== 'COUNTDOWN' &&
      snapshot.phase !== 'PAUSED_DISCONNECT'
    ) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(timer);
  }, [snapshot.phase]);

  // Reset confirmLeave when match ends
  useEffect(() => {
    if (!isActiveMatch) {
      setConfirmLeave(false);
    }
  }, [isActiveMatch]);

  // Sound FX from authoritative snapshot transitions
  useEffect(() => {
    const prev = prevSnapshotRef.current;
    prevSnapshotRef.current = snapshot;
    if (!prev || prev.matchId !== snapshot.matchId) return;

    if (
      snapshot.score.left !== prev.score.left ||
      snapshot.score.right !== prev.score.right
    ) {
      const leftScored = snapshot.score.left > prev.score.left;
      const bySelf = localTwoPlayer
        ? true
        : (leftScored && yourSide === 'left') || (!leftScored && yourSide === 'right');
      soundFx.pointScored(bySelf);
    } else if (prev.phase === 'PLAYING' && snapshot.phase === 'PLAYING') {
      if (
        (prev.ball.vx < 0 && snapshot.ball.vx > 0) ||
        (prev.ball.vx > 0 && snapshot.ball.vx < 0)
      ) {
        soundFx.paddleHit();
      } else if (
        (prev.ball.vy < 0 && snapshot.ball.vy > 0) ||
        (prev.ball.vy > 0 && snapshot.ball.vy < 0)
      ) {
        soundFx.wallBounce();
      }
    }

    if (
      (prev.phase === 'COUNTDOWN' || prev.phase === 'PLAYING') &&
      (snapshot.phase === 'FINISHED' || snapshot.phase === 'FORFEITED')
    ) {
      soundFx.matchFinished(localTwoPlayer ? true : match.winnerPlayerId === selfPlayerId);
    }
  }, [snapshot, match.winnerPlayerId, selfPlayerId, yourSide, localTwoPlayer]);

  // Countdown tick sound
  const countdownSeconds =
    snapshot.phase === 'COUNTDOWN' && snapshot.countdownEndsAt
      ? Math.max(1, Math.ceil((snapshot.countdownEndsAt - nowMs) / 1000))
      : null;

  useEffect(() => {
    if (countdownSeconds !== null && countdownSeconds !== lastCountdownSecRef.current) {
      lastCountdownSecRef.current = countdownSeconds;
      soundFx.countdownTick(false);
    } else if (countdownSeconds === null && lastCountdownSecRef.current !== null) {
      lastCountdownSecRef.current = null;
      if (snapshot.phase === 'PLAYING') {
        soundFx.countdownTick(true);
      }
    }
  }, [countdownSeconds, snapshot.phase]);

  // Keyboard input capture:
  // - multi: W/S or ArrowUp/ArrowDown control own paddle
  // - localTwoPlayer: W/S controls left paddle and ArrowUp/ArrowDown controls right paddle
  useEffect(() => {
    const emitSingleIfChanged = () => {
      const up = pressedUpRef.current;
      const down = pressedDownRef.current;
      const nextDir: -1 | 0 | 1 = up && !down ? -1 : down && !up ? 1 : 0;
      if (nextDir !== lastDirRef.current) {
        lastDirRef.current = nextDir;
        seqRef.current += 1;
        onSendInputRef.current(match.matchId, nextDir, seqRef.current);
      }
    };

    const emitDualIfChanged = (side: PaddleSide) => {
      if (side === 'left') {
        const up = leftUpRef.current;
        const down = leftDownRef.current;
        const nextDir: -1 | 0 | 1 = up && !down ? -1 : down && !up ? 1 : 0;
        if (nextDir !== lastLeftDirRef.current) {
          lastLeftDirRef.current = nextDir;
          onSendDualInputRef.current?.('left', nextDir);
        }
      } else {
        const up = rightUpRef.current;
        const down = rightDownRef.current;
        const nextDir: -1 | 0 | 1 = up && !down ? -1 : down && !up ? 1 : 0;
        if (nextDir !== lastRightDirRef.current) {
          lastRightDirRef.current = nextDir;
          onSendDualInputRef.current?.('right', nextDir);
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveMatch) return;
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Space') {
        e.preventDefault();
      }
      if (e.repeat) return;

      if (localTwoPlayer) {
        if (e.code === 'KeyW') {
          leftUpRef.current = true;
          emitDualIfChanged('left');
        } else if (e.code === 'KeyS') {
          leftDownRef.current = true;
          emitDualIfChanged('left');
        } else if (e.code === 'ArrowUp') {
          rightUpRef.current = true;
          emitDualIfChanged('right');
        } else if (e.code === 'ArrowDown') {
          rightDownRef.current = true;
          emitDualIfChanged('right');
        }
        return;
      }

      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        pressedUpRef.current = true;
        emitSingleIfChanged();
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        pressedDownRef.current = true;
        emitSingleIfChanged();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (localTwoPlayer) {
        if (e.code === 'KeyW') {
          leftUpRef.current = false;
          emitDualIfChanged('left');
        } else if (e.code === 'KeyS') {
          leftDownRef.current = false;
          emitDualIfChanged('left');
        } else if (e.code === 'ArrowUp') {
          rightUpRef.current = false;
          emitDualIfChanged('right');
        } else if (e.code === 'ArrowDown') {
          rightDownRef.current = false;
          emitDualIfChanged('right');
        }
        return;
      }

      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        pressedUpRef.current = false;
        emitSingleIfChanged();
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        pressedDownRef.current = false;
        emitSingleIfChanged();
      }
    };

    const clearInputs = () => {
      if (localTwoPlayer) {
        leftUpRef.current = false;
        leftDownRef.current = false;
        rightUpRef.current = false;
        rightDownRef.current = false;
        emitDualIfChanged('left');
        emitDualIfChanged('right');
        return;
      }
      pressedUpRef.current = false;
      pressedDownRef.current = false;
      emitSingleIfChanged();
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearInputs);
    document.addEventListener('visibilitychange', clearInputs);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearInputs);
      document.removeEventListener('visibilitychange', clearInputs);
      clearInputs();
    };
  }, [isActiveMatch, match.matchId, localTwoPlayer]);

  const toggleMute = () => {
    const next = !muted;
    soundFx.setMuted(next);
    setMuted(next);
  };

  const pauseSecondsLeft =
    snapshot.phase === 'PAUSED_DISCONNECT' && snapshot.pauseExpiresAt
      ? Math.max(0, Math.ceil((snapshot.pauseExpiresAt - nowMs) / 1000))
      : 0;

  const disconnectedPlayer = participants.find(
    (p) => p.playerId === snapshot.disconnectedPlayerId || !p.connected,
  );

  const isTerminal = snapshot.phase === 'FINISHED' || snapshot.phase === 'FORFEITED';
  const didWin = match.winnerPlayerId === selfPlayerId;
  const winnerParticipant = participants.find((p) => p.playerId === match.winnerPlayerId);

  const rematchRequestedBySelf = rematch.requestedByPlayerId === selfPlayerId;
  const rematchRequestedByOpponent =
    rematch.requestedByPlayerId !== null && rematch.requestedByPlayerId !== selfPlayerId;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {/* Unobtrusive Top Scoreboard HUD */}
      <div className="bg-[#151e29] border border-white/10 rounded-xl px-5 py-3.5 mb-4 flex flex-wrap items-center justify-between gap-4">
        {/* Left Participant */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <AvatarImg
            src={leftPlayer.avatarUrl}
            alt={leftPlayer.nickname}
            size={40}
            className={`w-10 h-10 rounded-lg border ${
              localTwoPlayer || yourSide === 'left' ? 'border-emerald-500/70' : 'border-white/15'
            }`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-100 truncate">
                {leftPlayer.nickname}
              </span>
              {localTwoPlayer ? (
                <span className="text-xs font-medium text-emerald-400">· W / S</span>
              ) : (
                yourSide === 'left' && (
                  <span className="text-xs font-medium text-emerald-400">· You</span>
                )
              )}
            </div>
            <div className="text-xs text-slate-400">
              Left paddle {!leftPlayer.connected && '· Disconnected'}
            </div>
          </div>
        </div>

        {/* Center Tabular Score */}
        <div className="flex items-center gap-4 px-4">
          <span
            className={`font-display text-4xl font-bold font-mono-tabular ${
              localTwoPlayer || yourSide === 'left' ? 'text-emerald-400' : 'text-slate-100'
            }`}
          >
            {snapshot.score.left}
          </span>
          <span className="text-slate-500 font-mono-tabular text-xl">:</span>
          <span
            className={`font-display text-4xl font-bold font-mono-tabular ${
              localTwoPlayer
                ? 'text-sky-400'
                : yourSide === 'right'
                  ? 'text-emerald-400'
                  : 'text-slate-100'
            }`}
          >
            {snapshot.score.right}
          </span>
        </div>

        {/* Right Participant */}
        <div className="flex items-center justify-end gap-3 min-w-0 flex-1 text-right">
          <div className="min-w-0">
            <div className="flex items-center justify-end gap-2">
              {localTwoPlayer ? (
                <span className="text-xs font-medium text-sky-400">↑ / ↓ ·</span>
              ) : (
                yourSide === 'right' && (
                  <span className="text-xs font-medium text-emerald-400">You ·</span>
                )
              )}
              <span className="text-sm font-semibold text-slate-100 truncate">
                {rightPlayer.nickname}
              </span>
            </div>
            <div className="text-xs text-slate-400">
              {!rightPlayer.connected && 'Disconnected · '}Right paddle
            </div>
          </div>
          <AvatarImg
            src={rightPlayer.avatarUrl}
            alt={rightPlayer.nickname}
            size={40}
            className={`w-10 h-10 rounded-lg border ${
              localTwoPlayer
                ? 'border-sky-400/70'
                : yourSide === 'right'
                  ? 'border-emerald-500/70'
                  : 'border-white/15'
            }`}
          />
        </div>
      </div>

      {/* Arena Canvas Container */}
      <div className="relative bg-[#0c141c] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
        <PongArenaCanvas
          snapshot={snapshot}
          yourSide={yourSide}
          localDirectionRef={lastDirRef}
          rules={rules}
          localTwoPlayer={localTwoPlayer}
        />

        {/* Countdown Overlay */}
        {snapshot.phase === 'COUNTDOWN' && countdownSeconds !== null && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/25">
            <div
              className={`font-display text-7xl font-bold font-mono-tabular drop-shadow-lg ${
                snapshot.paddlesUnlocked ? 'text-emerald-400' : 'text-slate-100'
              }`}
            >
              {snapshot.paddlesUnlocked ? 1 : countdownSeconds}
            </div>
            <div
              className={`mt-2 text-sm font-medium ${
                snapshot.paddlesUnlocked ? 'text-emerald-300' : 'text-slate-300'
              }`}
            >
              {snapshot.paddlesUnlocked
                ? 'Paddles active — position now'
                : snapshot.score.left === 0 && snapshot.score.right === 0
                  ? 'Match starting'
                  : 'Next serve'}
            </div>
          </div>
        )}

        {/* Disconnect Pause Overlay */}
        {snapshot.phase === 'PAUSED_DISCONNECT' && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center bg-black/65 px-4"
          >
            <div className="max-w-sm w-full bg-[#151e29] border border-amber-500/40 rounded-xl p-6 text-center shadow-2xl">
              <h2 className="font-display text-2xl font-bold text-amber-300">Match Paused</h2>
              <p className="mt-2 text-sm text-slate-300">
                {disconnectedPlayer
                  ? `${disconnectedPlayer.nickname} disconnected. Waiting for reconnect.`
                  : 'Waiting for opponent to reconnect.'}
              </p>
              <div className="mt-4 font-display text-4xl font-bold font-mono-tabular text-slate-100">
                {pauseSecondsLeft}s
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Automatic forfeit if connection is not restored
              </p>
            </div>
          </div>
        )}

        {/* Post-Match Result Overlay */}
        {isTerminal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="match-result-heading"
            className="absolute inset-0 flex items-center justify-center bg-black/70 px-4"
          >
            <div className="max-w-md w-full bg-[#151e29] border border-white/15 rounded-xl p-6 sm:p-7 text-center shadow-2xl">
              <div className="text-xs font-medium text-slate-400">
                {formatOutcomeReason(match.outcomeReason, winScore)}
              </div>
              <h2
                id="match-result-heading"
                className={`mt-1.5 font-display text-3xl font-bold ${
                  localTwoPlayer
                    ? winnerParticipant?.side === 'right'
                      ? 'text-sky-400'
                      : 'text-emerald-400'
                    : didWin
                      ? 'text-emerald-400'
                      : 'text-slate-100'
                }`}
              >
                {localTwoPlayer
                  ? winnerParticipant
                    ? `${winnerParticipant.nickname} Wins`
                    : 'Match Ended'
                  : didWin
                    ? 'Victory'
                    : winnerParticipant
                      ? `${winnerParticipant.nickname} Wins`
                      : 'Match Ended'}
              </h2>

              <div className="mt-4 font-display text-5xl font-bold font-mono-tabular text-slate-100">
                {snapshot.score.left} – {snapshot.score.right}
              </div>

              {!localTwoPlayer && rematch.status === 'PENDING' && rematchRequestedByOpponent && (
                <p className="mt-4 text-sm font-medium text-amber-300">
                  Opponent requested a rematch (sides will swap)
                </p>
              )}
              {!localTwoPlayer && rematch.status === 'PENDING' && rematchRequestedBySelf && (
                <p className="mt-4 text-sm text-slate-300">
                  Rematch requested. Waiting for opponent…
                </p>
              )}
              {!localTwoPlayer && rematch.status === 'CANCELLED' && (
                <p className="mt-4 text-sm text-slate-400">
                  Opponent left to the lobby.
                </p>
              )}

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                {localTwoPlayer ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onRequestRematch(match.matchId)}
                      className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Play Again
                    </button>
                    <button
                      type="button"
                      onClick={() => onAcceptRematch(match.matchId)}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Swap Sides &amp; Rematch
                    </button>
                  </>
                ) : (
                  <>
                    {rematch.status === 'NONE' && (
                      <button
                        type="button"
                        onClick={() => onRequestRematch(match.matchId)}
                        className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap"
                      >
                        Request Rematch
                      </button>
                    )}
                    {rematch.status === 'PENDING' && rematchRequestedByOpponent && (
                      <button
                        type="button"
                        onClick={() => onAcceptRematch(match.matchId)}
                        className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap"
                      >
                        Accept Rematch
                      </button>
                    )}
                    {rematch.status === 'PENDING' && rematchRequestedBySelf && (
                      <button
                        type="button"
                        disabled
                        className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-400 bg-slate-800 border border-white/10 rounded-lg cursor-not-allowed whitespace-nowrap"
                      >
                        Waiting…
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onReturnToLobby}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Return to Lobby
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls & Key Hint Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          {localTwoPlayer ? (
            <>
              <span>Controls:</span>
              <span className="font-mono-tabular text-emerald-300">Left W / S</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular text-sky-300">Right ↑ / ↓</span>
            </>
          ) : (
            <>
              <span>Move Paddle:</span>
              <span className="font-mono-tabular text-slate-200">W / S or ↑ / ↓</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>
            First to {winScore} {winScore === 1 ? 'point' : 'points'}
          </span>
          {rules?.isDemoMatch && (() => {
            const demoHeight =
              rules.demoSide === 'left' ? rules.leftPaddleHeight : rules.rightPaddleHeight;
            const demoPct = Math.round(demoHeight * 100);
            const modeLabelMap = {
              wall: 'Wall (100% paddle)',
              gap: `Gap (${demoPct}% centered)`,
              honing: `Honing (${demoPct}% · speed ${rules.demoPaddleSpeed})`,
              swipe: `Swipe (${demoPct}% · speed ${rules.demoPaddleSpeed})`,
              erratic: `Erratic (${demoPct}% · speed ${rules.demoPaddleSpeed})`,
            } as const;
            const demoDesc = rules.demoMode
              ? `Demo mode: ${modeLabelMap[rules.demoMode]}`
              : `Demo mode (${demoPct}% paddle)`;
            return (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-300">{demoDesc}</span>
              </>
            );
          })()}
          {!localTwoPlayer && pingMs !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={`font-mono-tabular ${
                  pingMs >= 100
                    ? 'text-red-400'
                    : pingMs >= 50
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                }`}
              >
                Ping {pingMs} ms
                {pingMs >= 100 ? ' (High lag)' : pingMs >= 50 ? ' (Moderate lag)' : ''}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleMute}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {muted ? 'Sound Off' : 'Sound On'}
          </button>

          {localTwoPlayer && onRestartMatch && (
            <button
              type="button"
              onClick={onRestartMatch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restart Match
            </button>
          )}

          {!localTwoPlayer && isActiveMatch && !confirmLeave && (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#151e29] hover:bg-red-950/60 hover:text-red-200 hover:border-red-500/40 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Leave Match
            </button>
          )}

          {!localTwoPlayer && isActiveMatch && confirmLeave && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onLeaveMatch(match.matchId)}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Confirm Forfeit
              </button>
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Keep Playing
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
