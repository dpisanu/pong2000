import { useCallback, useEffect, useRef, useState } from 'react';
import { MatchView } from '@multi/client/game/MatchView.tsx';
import {
  createLocalMatchState,
  createRestartedLocalMatch,
  stepLocalMatchState,
  toActiveMatchSync,
  type LocalMatchState,
} from '@multi/shared/localMatch.ts';
import type { PaddleInputDir } from '@multi/shared/pongEngine.ts';
import type { ActiveMatchSync, PaddleSide } from '@multi/shared/types.ts';

const NOOP = () => {};

export default function App() {
  const matchRef = useRef<LocalMatchState | null>(null);
  if (!matchRef.current) {
    matchRef.current = createLocalMatchState();
  }

  const [activeMatch, setActiveMatch] = useState<ActiveMatchSync>(() =>
    toActiveMatchSync(matchRef.current!),
  );

  const syncUi = useCallback(() => {
    if (!matchRef.current) return;
    setActiveMatch(toActiveMatchSync(matchRef.current));
  }, []);

  const startFreshMatch = useCallback(
    (swapSides = false) => {
      const current = matchRef.current ?? createLocalMatchState();
      matchRef.current = createRestartedLocalMatch(current, {
        swapSides,
        nowEpochMs: Date.now(),
        nowPerfMs: performance.now(),
      });
      syncUi();
    },
    [syncUi],
  );

  const handleDualInput = useCallback((side: PaddleSide, direction: PaddleInputDir) => {
    const current = matchRef.current;
    if (!current) return;
    current.inputs[side] = direction;
  }, []);

  useEffect(() => {
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
  }, []);

  return (
    <div className="min-h-screen bg-[#0d131a] text-slate-100 flex flex-col">
      <header className="border-b border-white/10 bg-[#111922]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-100">
              Pong2000
            </span>
            <span className="text-xs font-medium text-emerald-400">Local 2-Player</span>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs text-slate-300">
            <span className="font-mono-tabular text-emerald-300">Player 1: W / S</span>
            <span className="text-slate-500" aria-hidden="true">
              ·
            </span>
            <span className="font-mono-tabular text-sky-300">Player 2: ↑ / ↓</span>
          </div>
        </div>
      </header>

      <div className="flex-1">
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
          onReturnToLobby={NOOP}
        />
      </div>
    </div>
  );
}
