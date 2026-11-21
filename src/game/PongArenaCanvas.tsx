import { useEffect, useRef, type RefObject } from 'react';
import {
  ARENA_ASPECT,
  BALL_RADIUS_Y,
  PADDLE_HEIGHT,
  PADDLE_MARGIN_X,
  PADDLE_SPEED,
  PADDLE_WIDTH,
} from '../../shared/src/constants.ts';
import type { MatchSnapshot, PaddleSide } from '../../shared/src/types.ts';

interface PongArenaCanvasProps {
  snapshot: MatchSnapshot;
  yourSide: PaddleSide;
  localDirectionRef: RefObject<-1 | 0 | 1>;
}

interface SnapshotSample {
  snapshot: MatchSnapshot;
  receivedPerfMs: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function PongArenaCanvas({
  snapshot,
  yourSide,
  localDirectionRef,
}: PongArenaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const samplesRef = useRef<{ prev: SnapshotSample | null; curr: SnapshotSample | null }>({
    prev: null,
    curr: null,
  });
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const yourSideRef = useRef<PaddleSide>(yourSide);
  const predictedSelfYRef = useRef<number | null>(null);

  useEffect(() => {
    yourSideRef.current = yourSide;
  }, [yourSide]);

  useEffect(() => {
    const nowPerf = performance.now();
    const { curr } = samplesRef.current;

    if (!curr || curr.snapshot.matchId !== snapshot.matchId || snapshot.tick < curr.snapshot.tick) {
      samplesRef.current = {
        prev: { snapshot, receivedPerfMs: nowPerf },
        curr: { snapshot, receivedPerfMs: nowPerf },
      };
      trailRef.current = [];
      predictedSelfYRef.current =
        yourSideRef.current === 'left' ? snapshot.paddles.leftY : snapshot.paddles.rightY;
      return;
    }

    // If entering a new countdown (start of match, after a point, or resume), clear trail and snap
    if (curr.snapshot.phase !== 'COUNTDOWN' && snapshot.phase === 'COUNTDOWN') {
      trailRef.current = [];
      predictedSelfYRef.current =
        yourSideRef.current === 'left' ? snapshot.paddles.leftY : snapshot.paddles.rightY;
    }

    if (snapshot.tick > curr.snapshot.tick || snapshot.phase !== curr.snapshot.phase) {
      samplesRef.current = {
        prev: curr,
        curr: { snapshot, receivedPerfMs: nowPerf },
      };

      const paddlesUnlocked = snapshot.phase === 'PLAYING' || Boolean(snapshot.paddlesUnlocked);
      const authSelfY =
        yourSideRef.current === 'left' ? snapshot.paddles.leftY : snapshot.paddles.rightY;
      if (predictedSelfYRef.current === null || !paddlesUnlocked) {
        predictedSelfYRef.current = authSelfY;
      } else {
        const diff = Math.abs(authSelfY - predictedSelfYRef.current);
        if (diff > 0.08) {
          predictedSelfYRef.current = authSelfY;
        } else {
          predictedSelfYRef.current = lerp(predictedSelfYRef.current, authSelfY, 0.35);
        }
      }
    }
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastFramePerf = performance.now();

    const renderFrame = (frameNowPerf: number) => {
      const dtSec = Math.min(0.05, Math.max(0, (frameNowPerf - lastFramePerf) / 1000));
      lastFramePerf = frameNowPerf;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.max(320, Math.round(rect.width * dpr));
      const targetH = Math.max(200, Math.round(rect.height * dpr));

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const w = canvas.width;
      const h = canvas.height;
      const { prev, curr } = samplesRef.current;

      let ballX = 0.5;
      let ballY = 0.5;
      let leftY = 0.5;
      let rightY = 0.5;
      let isPlaying = false;
      let paddlesActive = false;

      if (curr) {
        isPlaying = curr.snapshot.phase === 'PLAYING';
        paddlesActive = isPlaying || Boolean(curr.snapshot.paddlesUnlocked);

        if (prev && paddlesActive && curr.snapshot.tick > prev.snapshot.tick) {
          const intervalMs = Math.max(16, Math.min(80, curr.receivedPerfMs - prev.receivedPerfMs));
          const elapsed = frameNowPerf - curr.receivedPerfMs;
          // Interpolate smoothly from prev toward curr, allowing tiny bounded extrapolation (up to 25%)
          const alpha = Math.max(0, Math.min(1.25, elapsed / intervalMs));

          if (isPlaying) {
            const jumpDist = Math.hypot(
              curr.snapshot.ball.x - prev.snapshot.ball.x,
              curr.snapshot.ball.y - prev.snapshot.ball.y,
            );
            if (jumpDist > 0.35) {
              ballX = curr.snapshot.ball.x;
              ballY = curr.snapshot.ball.y;
            } else {
              ballX = lerp(prev.snapshot.ball.x, curr.snapshot.ball.x, alpha);
              ballY = lerp(prev.snapshot.ball.y, curr.snapshot.ball.y, alpha);
            }
          } else {
            ballX = curr.snapshot.ball.x;
            ballY = curr.snapshot.ball.y;
          }

          leftY = lerp(prev.snapshot.paddles.leftY, curr.snapshot.paddles.leftY, Math.min(1, alpha));
          rightY = lerp(prev.snapshot.paddles.rightY, curr.snapshot.paddles.rightY, Math.min(1, alpha));
        } else {
          ballX = curr.snapshot.ball.x;
          ballY = curr.snapshot.ball.y;
          leftY = curr.snapshot.paddles.leftY;
          rightY = curr.snapshot.paddles.rightY;
        }

        // Visual-only client-side prediction for own paddle so key presses feel instant
        if (paddlesActive) {
          const minY = PADDLE_HEIGHT / 2;
          const maxY = 1 - PADDLE_HEIGHT / 2;
          const baseSelfY =
            predictedSelfYRef.current ??
            (yourSideRef.current === 'left'
              ? curr.snapshot.paddles.leftY
              : curr.snapshot.paddles.rightY);
          const dir = localDirectionRef.current ?? 0;
          const nextSelfY = clamp(baseSelfY + dir * PADDLE_SPEED * dtSec, minY, maxY);
          predictedSelfYRef.current = nextSelfY;
          if (yourSideRef.current === 'left') {
            leftY = nextSelfY;
          } else {
            rightY = nextSelfY;
          }
        }
      }

      // Background court surface
      ctx.fillStyle = '#0c141c';
      ctx.fillRect(0, 0, w, h);

      // Court boundary frame
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = Math.max(2, w * 0.0025);
      ctx.strokeRect(1, 1, w - 2, h - 2);

      // Center court circle
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = Math.max(1.5, w * 0.002);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, h * 0.13, 0, Math.PI * 2);
      ctx.stroke();

      // Center dashed net line
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = Math.max(2, w * 0.003);
      ctx.setLineDash([h * 0.03, h * 0.025]);
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.03);
      ctx.lineTo(w / 2, h * 0.97);
      ctx.stroke();
      ctx.restore();

      // Goal zone hairline accents
      const paddleW = PADDLE_WIDTH * w;
      const paddleH = PADDLE_HEIGHT * h;
      const leftX = PADDLE_MARGIN_X * w;
      const rightX = (1 - PADDLE_MARGIN_X - PADDLE_WIDTH) * w;

      // Left paddle
      const leftIsSelf = yourSideRef.current === 'left';
      ctx.fillStyle = leftIsSelf ? '#10b981' : '#e2e8f0';
      ctx.beginPath();
      ctx.roundRect(leftX, leftY * h - paddleH / 2, paddleW, paddleH, Math.min(paddleW / 2, 6));
      ctx.fill();

      // Right paddle
      const rightIsSelf = yourSideRef.current === 'right';
      ctx.fillStyle = rightIsSelf ? '#10b981' : '#e2e8f0';
      ctx.beginPath();
      ctx.roundRect(rightX, rightY * h - paddleH / 2, paddleW, paddleH, Math.min(paddleW / 2, 6));
      ctx.fill();

      // Ball trail when playing
      if (isPlaying) {
        trailRef.current.push({ x: ballX, y: ballY });
        if (trailRef.current.length > 5) {
          trailRef.current.shift();
        }
        for (let i = 0; i < trailRef.current.length - 1; i++) {
          const pt = trailRef.current[i];
          const ratio = (i + 1) / trailRef.current.length;
          ctx.fillStyle = `rgba(248, 250, 252, ${ratio * 0.16})`;
          ctx.beginPath();
          ctx.arc(pt.x * w, pt.y * h, BALL_RADIUS_Y * h * (0.65 + ratio * 0.3), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Ball
      const ballRadiusPx = BALL_RADIUS_Y * h;
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(ballX * w, ballY * h, ballRadiusPx, 0, Math.PI * 2);
      ctx.fill();

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ aspectRatio: `${ARENA_ASPECT} / 1` }}
      className="w-full h-auto block rounded-xl"
      aria-label="Pong arena playfield"
    />
  );
}
