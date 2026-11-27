import { useEffect, useState } from 'react';
import { Check, Copy, Film, Gamepad2, Play, Terminal } from 'lucide-react';
import { assetUrl } from './assetUrl.ts';
import { ScreenshotGallery } from './components/ScreenshotGallery.tsx';
import { TestItArena } from './components/TestItArena.tsx';

type ActiveTab = 'overview' | 'test-it';

interface VideoTrailer {
  id: string;
  index: string;
  title: string;
  meta: string;
  summary: string;
  videoPath: string;
  posterPath: string;
  highlights: readonly string[];
}

const TRAILERS: readonly VideoTrailer[] = [
  {
    id: 'video-01',
    index: '01',
    title: '1972 to 2026 Arena Evolution',
    meta: '1280×720 · 30 fps · 36.8s',
    summary:
      'Tracks classic arcade Pong spinning forward into 2026, following a full player journey from profile creation through 2×2, 4×4, and 8×8 concurrent match grids to #1 on the leaderboard.',
    videoPath: 'media/videos/01/pong2000-commercial.mp4',
    posterPath: 'media/screenshots/arena-lobby.png',
    highlights: [
      'Atari-style 1972 → 2026 mechanical year reel',
      'Escalating 2×2, 4×4, and 8×8 live match matrices',
      'Gold trophy #1 reveal and frosted outro',
    ],
  },
  {
    id: 'video-02',
    index: '02',
    title: 'CRT Classic to #1 Champion',
    meta: '1280×720 · 30 fps · 39.6s',
    summary:
      'Opens on a 1972 CRT television zoom-in, enters the modern leaderboard at position #99, escalates across multi-arena sessions, and climbs all the way back up to #1.',
    videoPath: 'media/videos/02/pong2000-commercial.mp4',
    posterPath: 'media/screenshots/leaderboard.png',
    highlights: [
      '1972 walnut CRT scanline zoom-in opening',
      'Underdog climb from #99 up to pulsating #1 Gold Trophy',
      'Slow-motion rally behind a progressive milky screen',
    ],
  },
];

const COMMANDS = [
  {
    id: 'docker',
    label: 'Docker Compose (Networked LAN Arena)',
    command: 'cd game/multi && docker compose -f docker/compose.yaml up -d --build',
  },
  {
    id: 'multi-dev',
    label: 'Node.js Dev Server (Port 3000)',
    command: 'npm install --legacy-peer-deps && npm run dev',
  },
  {
    id: 'single-dev',
    label: 'Single-Page 2-Player Local Dev (Port 3001)',
    command: 'npm run dev:single',
  },
] as const;

function getInitialTab(): ActiveTab {
  if (typeof window !== 'undefined' && window.location.hash === '#test-it') {
    return 'test-it';
  }
  return 'overview';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(getInitialTab);
  const [heroGifFailed, setHeroGifFailed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#test-it') {
        setActiveTab('test-it');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const openTestIt = () => {
    setActiveTab('test-it');
    window.history.replaceState(null, '', '#test-it');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToSection = (sectionId?: string) => {
    setActiveTab('overview');
    if (sectionId) {
      window.history.replaceState(null, '', `#${sectionId}`);
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      });
    } else {
      window.history.replaceState(null, '', '#overview');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleCopyCommand = async (id: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1800);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d131a] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones (wordmark, single-line nav links, 1 primary CTA) */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0d131a]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => navigateToSection()}
            className="font-display text-xl font-extrabold tracking-tight text-slate-100 hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Pong2000
          </button>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300"
          >
            <button
              type="button"
              onClick={() => navigateToSection()}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeTab === 'overview'
                  ? 'text-white border-emerald-400'
                  : 'border-transparent hover:text-white'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('trailers')}
              className="py-1 border-b-2 border-transparent hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Trailers
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('editions')}
              className="py-1 border-b-2 border-transparent hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Editions
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('screenshots')}
              className="py-1 border-b-2 border-transparent hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Screenshots
            </button>
            <button
              type="button"
              onClick={openTestIt}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeTab === 'test-it'
                  ? 'text-emerald-400 border-emerald-400'
                  : 'border-transparent hover:text-emerald-300'
              }`}
            >
              Test It
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {activeTab === 'test-it' ? (
              <button
                type="button"
                onClick={() => navigateToSection()}
                className="px-4 py-2 text-xs font-semibold text-slate-200 bg-[#151e29] hover:bg-slate-800 border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Overview
              </button>
            ) : (
              <button
                type="button"
                onClick={openTestIt}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Gamepad2 className="w-3.5 h-3.5" />
                Test It
              </button>
            )}
          </div>
        </div>

        {/* Mobile Tab Switcher (compact single row under top bar on narrow viewports) */}
        <div className="md:hidden border-t border-white/10 px-4 py-2 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => navigateToSection()}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeTab === 'overview'
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'text-slate-300 bg-[#151e29]'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => navigateToSection('trailers')}
            className="px-3 py-1.5 text-xs font-medium rounded-md text-slate-300 bg-[#151e29] whitespace-nowrap shrink-0"
          >
            Trailers
          </button>
          <button
            type="button"
            onClick={() => navigateToSection('screenshots')}
            className="px-3 py-1.5 text-xs font-medium rounded-md text-slate-300 bg-[#151e29] whitespace-nowrap shrink-0"
          >
            Screenshots
          </button>
          <button
            type="button"
            onClick={openTestIt}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeTab === 'test-it'
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'text-emerald-300 bg-[#151e29]'
            }`}
          >
            Test It
          </button>
        </div>
      </header>

      <main className="flex-1">
        {activeTab === 'test-it' ? (
          <TestItArena onBackToOverview={() => navigateToSection()} />
        ) : (
          <>
            {/* Hero Section */}
            <section id="overview" className="pt-12 pb-16 sm:pt-16 sm:pb-20 border-b border-white/10">
              <div className="max-w-6xl mx-auto px-4 sm:px-6">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
                  <div className="lg:col-span-6 flex flex-col justify-center">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-emerald-400">
                      <span>1972 Arcade Roots</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>60 Hz Browser Physics</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>LAN &amp; Local 2P</span>
                    </div>

                    <h1
                      className="mt-4 font-display font-extrabold tracking-tight text-slate-50 leading-[1.08]"
                      style={{
                        fontSize: 'clamp(2.25rem, 4.1vw, 3.65rem)',
                        textWrap: 'balance',
                      }}
                    >
                      Classic arcade Pong, built for LAN nights and instant couch play.
                    </h1>

                    <p className="mt-5 text-base sm:text-lg text-slate-300 leading-relaxed max-w-xl">
                      Pong2000 pairs a self-hosted two-player WebSocket arena with an instant
                      single-page local edition. Challenge friends across your local network, train
                      against five AI modes, or launch a shared-keyboard match right inside the Test
                      It tab.
                    </p>

                    <div className="mt-8 flex flex-wrap items-center gap-4">
                      <button
                        type="button"
                        onClick={openTestIt}
                        className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        Test It — Play 2P Now
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateToSection('trailers')}
                        className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-slate-200 bg-[#151e29] hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Film className="w-4 h-4 text-sky-400" />
                        Watch Trailers
                      </button>
                    </div>
                  </div>

                  <div className="lg:col-span-6 flex">
                    <div className="w-full bg-[#151e29] border border-white/10 rounded-xl overflow-hidden flex flex-col justify-between">
                      <div className="flex-1 bg-[#0b1016] flex items-center justify-center min-h-[260px]">
                        {heroGifFailed ? (
                          <div className="p-8 text-center">
                            <Gamepad2 className="w-10 h-10 text-emerald-400 mx-auto" />
                            <p className="mt-3 text-sm font-semibold text-slate-200">
                              Pong2000 Live Two-Player Match
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              60 Hz authoritative simulation with instant local paddle response
                            </p>
                          </div>
                        ) : (
                          <img
                            src={assetUrl('media/screenshots/gameplay-session.gif')}
                            alt="Two Pong2000 players rallying in an active match"
                            referrerPolicy="no-referrer"
                            onError={() => setHeroGifFailed(true)}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="px-5 py-3.5 border-t border-white/10 flex items-center justify-between gap-4 text-xs text-slate-400">
                        <span>Live two-player rally capture</span>
                        <span className="font-mono-tabular text-slate-300">W/S vs ↑/↓</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Full-width quantitative proof strip below hero split */}
                <div className="mt-12 pt-8 border-t border-white/10 grid grid-cols-2 lg:grid-cols-4 gap-6">
                  <div>
                    <div className="font-display text-2xl sm:text-3xl font-bold font-mono-tabular text-slate-100">
                      60 Hz
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Fixed physics tick shared by multi and local editions
                    </div>
                  </div>
                  <div>
                    <div className="font-display text-2xl sm:text-3xl font-bold font-mono-tabular text-emerald-400">
                      5 Modes
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Wall, Gap, Honing, Swipe, and Erratic Demo AI opponents
                    </div>
                  </div>
                  <div>
                    <div className="font-display text-2xl sm:text-3xl font-bold font-mono-tabular text-sky-400">
                      2 Editions
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Self-hosted LAN server plus static browser 2-player play
                    </div>
                  </div>
                  <div>
                    <div className="font-display text-2xl sm:text-3xl font-bold font-mono-tabular text-amber-300">
                      0 Logins
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Instant browser entry with reconnect tokens and SVG emblems
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Promotional Videos Section */}
            <section id="trailers" className="py-16 sm:py-20 border-b border-white/10">
              <div className="max-w-6xl mx-auto px-4 sm:px-6">
                <div className="max-w-2xl">
                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
                    Commercial Trailers
                  </h2>
                  <p className="mt-2 text-base text-slate-300">
                    Two promotional shorts tracing Pong2000 from 1972 CRT origins to 64-court
                    arena climbs and championship finishes.
                  </p>
                </div>

                <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {TRAILERS.map((trailer) => (
                    <article
                      key={trailer.id}
                      className="bg-[#151e29] border border-white/10 rounded-xl overflow-hidden flex flex-col"
                    >
                      <div className="bg-black aspect-video w-full">
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          poster={assetUrl(trailer.posterPath)}
                          className="w-full h-full object-cover"
                        >
                          <source src={assetUrl(trailer.videoPath)} type="video/mp4" />
                          Your browser does not support embedded MP4 playback.
                        </video>
                      </div>

                      <div className="p-6 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-4 text-xs text-slate-400">
                            <span className="font-mono-tabular text-emerald-400">
                              Trailer {trailer.index}
                            </span>
                            <span className="font-mono-tabular">{trailer.meta}</span>
                          </div>
                          <h3 className="mt-2 font-display text-xl font-bold text-slate-100">
                            {trailer.title}
                          </h3>
                          <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                            {trailer.summary}
                          </p>
                        </div>

                        <ul className="mt-5 pt-4 border-t border-white/10 space-y-1.5 text-xs text-slate-400">
                          {trailer.highlights.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            {/* Editions & Capabilities Asymmetric Grid */}
            <section id="editions" className="py-16 sm:py-20 border-b border-white/10">
              <div className="max-w-6xl mx-auto px-4 sm:px-6">
                <div className="max-w-2xl">
                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
                    One Physics Engine, Two Ways to Play
                  </h2>
                  <p className="mt-2 text-base text-slate-300">
                    Both editions run the exact same collision geometry, rally acceleration, and
                    court renderer—choose networked LAN competition or immediate same-keyboard play.
                  </p>
                </div>

                <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 bg-[#151e29] border border-white/10 rounded-xl p-6 sm:p-7 flex flex-col justify-between">
                    <div>
                      <div className="text-xs font-medium text-emerald-400">
                        01. Networked Multiplayer · game/multi
                      </div>
                      <h3 className="mt-2 font-display text-2xl font-bold text-slate-100">
                        Self-Hosted LAN Arena
                      </h3>
                      <p className="mt-3 text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
                        Run a single Node.js or Docker container on your local network. Players join
                        via URL or built-in QR code, pick an emblem or upload a custom WebP avatar,
                        send challenges in the live lobby, and compete on an authoritative 60 Hz
                        server with automatic disconnect grace recovery.
                      </p>
                    </div>

                    <div className="mt-6 pt-5 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="font-semibold text-slate-100">Live Ping &amp; Recovery</div>
                        <div className="mt-1 text-xs text-slate-400">
                          2s RTT checks, outlier-trimmed ping averages, and 10s mid-match reconnects.
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-100">Session Leaderboard</div>
                        <div className="mt-1 text-xs text-slate-400">
                          Ranked player standings, Gold/Silver/Bronze trophies, and overall playtime.
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-100">Runtime Admin Panel</div>
                        <div className="mt-1 text-xs text-slate-400">
                          Adjust paddle height, ball speed, win limits, and Demo modes without restarts.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#151e29] border border-white/10 rounded-xl p-6 sm:p-7 flex flex-col justify-between">
                    <div>
                      <div className="text-xs font-medium text-sky-400">
                        02. Single-Page Local · game/single
                      </div>
                      <h3 className="mt-2 font-display text-2xl font-bold text-slate-100">
                        Instant Couch 2-Player
                      </h3>
                      <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                        Zero server setup. Loads directly into a live match where Player 1 uses{' '}
                        <span className="font-mono-tabular text-emerald-300">W / S</span> and Player
                        2 uses <span className="font-mono-tabular text-sky-300">↑ / ↓</span> on the
                        same keyboard.
                      </p>
                    </div>

                    <div className="mt-6 pt-5 border-t border-white/10">
                      <button
                        type="button"
                        onClick={openTestIt}
                        className="w-full px-4 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Open Test It Tab
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#151e29] border border-white/10 rounded-xl p-6">
                    <div className="text-xs font-medium text-amber-300">
                      03. Solo Practice AI
                    </div>
                    <h3 className="mt-2 font-display text-lg font-bold text-slate-100">
                      Five Built-In Demo Modes
                    </h3>
                    <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                      Challenge Demo Player at any time in Wall, Gap, Honing, Swipe, or Erratic mode
                      —selectable per player or randomized by the Admin pool.
                    </p>
                  </div>

                  <div className="lg:col-span-2 bg-[#151e29] border border-white/10 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div>
                      <div className="text-xs font-medium text-slate-400">
                        04. Offline-Ready Architecture
                      </div>
                      <h3 className="mt-2 font-display text-lg font-bold text-slate-100">
                        Multi-Stage Docker &amp; Static Bundle Builds
                      </h3>
                      <p className="mt-2 text-sm text-slate-300 leading-relaxed max-w-xl">
                        Export the networked arena as an air-gapped Docker image for offline LAN
                        events, or host the single-page edition on any static web server.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateToSection('deploy')}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      View Run Commands
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Screenshots Gallery */}
            <section id="screenshots" className="py-16 sm:py-20 border-b border-white/10">
              <div className="max-w-6xl mx-auto px-4 sm:px-6">
                <div className="max-w-2xl">
                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
                    Inside the Arena
                  </h2>
                  <p className="mt-2 text-base text-slate-300">
                    Browse captures from the live lobby, profile customization, session leaderboard,
                    and runtime Admin console.
                  </p>
                </div>

                <ScreenshotGallery />
              </div>
            </section>

            {/* Run & Deploy Commands */}
            <section id="deploy" className="py-16 sm:py-20">
              <div className="max-w-6xl mx-auto px-4 sm:px-6">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                  <div className="max-w-2xl">
                    <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
                      Run Locally or Self-Host on Your LAN
                    </h2>
                    <p className="mt-2 text-base text-slate-300">
                      Want to play right now without installing anything? Switch to the Test It tab
                      to play a full 2-player local match in this browser window.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openTestIt}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start lg:self-auto"
                  >
                    <Gamepad2 className="w-4 h-4" />
                    Launch Test It Tab
                  </button>
                </div>

                <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-5">
                  {COMMANDS.map((entry) => {
                    const isCopied = copiedId === entry.id;
                    return (
                      <div
                        key={entry.id}
                        className="bg-[#151e29] border border-white/10 rounded-xl p-5 flex flex-col justify-between gap-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-300">
                            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                            {entry.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyCommand(entry.id, entry.command)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-[#0d131a] border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                Copy
                              </>
                            )}
                          </button>
                        </div>

                        <pre className="font-mono-tabular text-xs text-emerald-300 bg-[#0b1016] border border-white/5 rounded-lg p-3 overflow-x-auto">
                          <code>{entry.command}</code>
                        </pre>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-white/10 bg-[#0b1016]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-sm font-bold text-slate-200">Pong2000</span>
            <span aria-hidden="true">·</span>
            <span>MIT License</span>
            <span aria-hidden="true">·</span>
            <span>Static site hosted via GitHub Pages</span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => navigateToSection()}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('trailers')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Trailers
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('screenshots')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Screenshots
            </button>
            <button
              type="button"
              onClick={openTestIt}
              className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors cursor-pointer"
            >
              Test It
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
