import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pause, Play } from 'lucide-react';
import { MatchView } from '@multi/client/game/MatchView.tsx';
import { BUNDLED_AVATARS } from '@multi/shared/constants.ts';
import {
  createLocalMatchState,
  createRestartedLocalMatch,
  stepLocalMatchState,
  toActiveMatchSync,
  type LocalMatchState,
} from '@multi/shared/localMatch.ts';
import type { PaddleInputDir } from '@multi/shared/pongEngine.ts';
import type { ActiveMatchSync, PaddleSide } from '@multi/shared/types.ts';
import { assetUrl } from '../assetUrl.ts';

interface TestItArenaProps {
  onBackToOverview: () => void;
}

const NOOP = () => {};

function createInitialWebsiteMatch(): LocalMatchState {
  return createLocalMatchState({
    leftPlayer: {
      playerId: 'local_p1',
      nickname: 'Player 1',
      avatarId: BUNDLED_AVATARS[0].id,
      avatarUrl: assetUrl('avatars/ace-paddle.svg'),
    },
    rightPlayer: {
      playerId: 'local_p2',
      nickname: 'Player 2',
      avatarId: BUNDLED_AVATARS[1].id,
      avatarUrl: assetUrl('avatars/rally-fox.svg'),
    },
  });
}

export function TestItArena({ onBackToOverview }: TestItArenaProps) {
  const matchRef = useRef<LocalMatchState | null>(null);
  if (!matchRef.current) {
    matchRef.current = createInitialWebsiteMatch();
  }

  const [paused, setPaused] = useState(false);
  const pausedAtPerfRef = useRef<number | null>(null);
  const [activeMatch, setActiveMatch] = useState<ActiveMatchSync>(() =>
    toActiveMatchSync(matchRef.current!),
  );

  const syncUi = useCallback(() => {
    if (!matchRef.current) return;
    setActiveMatch(toActiveMatchSync(matchRef.current));
  }, []);

  const startFreshMatch = useCallback(
    (swapSides = false) => {
      const current = matchRef.current ?? createInitialWebsiteMatch();
      matchRef.current = createRestartedLocalMatch(current, {
        swapSides,
        nowEpochMs: Date.now(),
        nowPerfMs: performance.now(),
      });
      pausedAtPerfRef.current = null;
      setPaused(false);
      syncUi();
    },
    [syncUi],
  );

  const togglePause = useCallback(() => {
    const current = matchRef.current;
    if (!current) return;

    if (!paused) {
      pausedAtPerfRef.current = performance.now();
      setPaused(true);
      return;
    }

    const nowPerf = performance.now();
    const pausedDuration = pausedAtPerfRef.current !== null ? nowPerf - pausedAtPerfRef.current : 0;
    pausedAtPerfRef.current = null;
    current.lastStepPerfMs = nowPerf;
    if (current.countdownEndPerfMs !== null) {
      current.countdownEndPerfMs += pausedDuration;
    }
    if (current.countdownEndsAt !== null) {
      current.countdownEndsAt += pausedDuration;
    }
    setPaused(false);
    syncUi();
  }, [paused, syncUi]);

  const handleDualInput = useCallback((side: PaddleSide, direction: PaddleInputDir) => {
    const current = matchRef.current;
    if (!current) return;
    current.inputs[side] = direction;
  }, []);

  useEffect(() => {
    if (paused) return;
    let rafId = 0;

    const frame = () => {
      const current = matchRef.current;
      if (current) {
        const changed = stepLocalMatchState(current, performance.now(), Date.now());
        if (changed) {
          setActiveMatch(toActiveMatchSync(current));
        }
      }
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [paused]);

  return (
    <section aria-label="Interactive two-player browser test" className="pt-8 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-white/10">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
              Test It — Single-Page 2-Player Arena
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Running the shared 60 Hz Pong2000 engine directly in your browser. Both players share one keyboard.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePause}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-200 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={onBackToOverview}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Overview
            </button>
          </div>
        </div>
      </div>

      <div className="relative mt-2">
        <MatchView
          match={activeMatch}
          selfPlayerId="local_p1"
          pingMs={null}
          localTwoPlayer
          onSendInput={NOOP}
          onSendDualInput={handleDualInput}
          onLeaveMatch={NOOP}
          onRequestRematch={() => startFreshMatch(false)}
          onAcceptRematch={() => startFreshMatch(true)}
          onRestartMatch={() => startFreshMatch(false)}
          onReturnToLobby={onBackToOverview}
        />

        {paused && (
          <div className="pointer-events-none max-w-5xl mx-auto px-4 sm:px-6 mt-2 text-center">
            <span className="text-xs font-medium text-amber-300">
              Match paused — click Resume to continue playing
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
