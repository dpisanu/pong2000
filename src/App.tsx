import { useCallback, useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, AlertCircle, X } from 'lucide-react';
import type { ServerEvent } from '../shared/src/protocol.ts';
import type {
  ActiveMatchSync,
  ChallengeInfo,
  LobbyPlayer,
  PlayerProfile,
} from '../shared/src/types.ts';
import { LanShareModal } from './components/LanShareModal.tsx';
import { MatchView } from './game/MatchView.tsx';
import { LobbyView } from './lobby/LobbyView.tsx';
import {
  ArenaClient,
  uploadAvatarFile,
  type ConnectionState,
} from './network/arenaClient.ts';
import { ProfileSetupView } from './profile/ProfileSetupView.tsx';
import {
  loadStoredProfile,
  saveStoredProfile,
  updateStoredRecoveryToken,
} from './storage/profileStorage.ts';

export default function App() {
  const [savedProfile, setSavedProfile] = useState<PlayerProfile | null>(() => {
    const stored = loadStoredProfile();
    return stored ? { nickname: stored.nickname, avatarId: stored.avatarId } : null;
  });
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [selfPlayerId, setSelfPlayerId] = useState<string | null>(null);
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [activeChallenge, setActiveChallenge] = useState<ChallengeInfo | null>(null);
  const [activeMatch, setActiveMatch] = useState<ActiveMatchSync | null>(null);

  const [editingProfile, setEditingProfile] = useState(false);
  const [profileServerError, setProfileServerError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [banner, setBanner] = useState<{ level: 'error' | 'info'; message: string } | null>(
    null,
  );

  const clientRef = useRef<ArenaClient | null>(null);
  const pendingUploadFileRef = useRef<File | null>(null);
  const pendingProfileUpdateRef = useRef<{
    requestId: string;
    profile: PlayerProfile;
  } | null>(null);
  const selfPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    selfPlayerIdRef.current = selfPlayerId;
  }, [selfPlayerId]);

  const showBanner = useCallback((level: 'error' | 'info', message: string) => {
    setBanner({ level, message });
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case 'session.ready': {
          const {
            playerId,
            profile,
            recoveryToken,
            uploadToken: nextUploadToken,
            lobby,
            activeChallenge: nextChallenge,
            activeMatch: nextMatch,
          } = event.payload;

          setSelfPlayerId(playerId);
          setUploadToken(nextUploadToken);
          setLobbyPlayers(lobby);
          setActiveChallenge(nextChallenge);
          setActiveMatch(nextMatch);
          setProfileServerError(null);
          setSavingProfile(false);

          const normalizedProfile: PlayerProfile = {
            nickname: profile.nickname,
            avatarId: profile.avatarId,
          };
          setSavedProfile(normalizedProfile);
          saveStoredProfile({
            ...normalizedProfile,
            recoveryToken,
          });

          // If user picked a custom avatar during initial onboarding, upload it now
          const pendingFile = pendingUploadFileRef.current;
          if (pendingFile) {
            pendingUploadFileRef.current = null;
            void uploadAvatarFile(pendingFile, nextUploadToken)
              .then((uploaded) => {
                const updated: PlayerProfile = {
                  nickname: normalizedProfile.nickname,
                  avatarId: uploaded.avatarId,
                };
                setSavedProfile(updated);
                saveStoredProfile({
                  ...updated,
                  recoveryToken,
                });
                clientRef.current?.updateProfile(updated);
              })
              .catch((err) => {
                showBanner(
                  'error',
                  err instanceof Error ? err.message : 'Failed to upload custom avatar.',
                );
              });
          }
          break;
        }
        case 'lobby.snapshot': {
          setLobbyPlayers(event.payload.players);
          break;
        }
        case 'lobby.player.upsert': {
          const incoming = event.payload.player;
          setLobbyPlayers((prev) => {
            const idx = prev.findIndex((p) => p.playerId === incoming.playerId);
            if (idx === -1) return [...prev, incoming];
            const copy = [...prev];
            copy[idx] = incoming;
            return copy;
          });
          break;
        }
        case 'lobby.player.remove': {
          const removedId = event.payload.playerId;
          setLobbyPlayers((prev) => prev.filter((p) => p.playerId !== removedId));
          break;
        }
        case 'challenge.received': {
          setActiveChallenge(event.payload.challenge);
          break;
        }
        case 'challenge.updated': {
          const ch = event.payload.challenge;
          setActiveChallenge((prev) => {
            if (!prev || prev.challengeId !== ch.challengeId) return prev;
            return null;
          });
          if (ch.status === 'DECLINED' || ch.status === 'EXPIRED' || ch.status === 'INVALIDATED') {
            showBanner('info', ch.reason || `Challenge ${ch.status.toLowerCase()}.`);
          }
          break;
        }
        case 'match.started': {
          setActiveChallenge(null);
          setBanner(null);
          setActiveMatch({
            matchId: event.payload.matchId,
            yourSide: event.payload.yourSide,
            participants: event.payload.participants,
            snapshot: event.payload.snapshot,
            rematch: {
              matchId: event.payload.matchId,
              requestedByPlayerId: null,
              acceptedByPlayerId: null,
              status: 'NONE',
            },
            winnerPlayerId: null,
            outcomeReason: null,
          });
          break;
        }
        case 'match.snapshot': {
          const snap = event.payload;
          setActiveMatch((prev) => {
            if (!prev || prev.matchId !== snap.matchId) return prev;
            if (snap.tick < prev.snapshot.tick) return prev;
            return {
              ...prev,
              snapshot: snap,
            };
          });
          break;
        }
        case 'match.phase': {
          const p = event.payload;
          setActiveMatch((prev) => {
            if (!prev || prev.matchId !== p.matchId) return prev;
            return {
              ...prev,
              participants: p.participants ?? prev.participants,
              snapshot: {
                ...prev.snapshot,
                phase: p.phase,
                countdownEndsAt: p.countdownEndsAt,
                pausedReason: p.pausedReason,
                pauseExpiresAt: p.pauseExpiresAt,
                disconnectedPlayerId: p.disconnectedPlayerId,
              },
            };
          });
          break;
        }
        case 'match.finished': {
          const fin = event.payload;
          setActiveMatch((prev) => {
            if (!prev || prev.matchId !== fin.matchId) return prev;
            return {
              ...prev,
              winnerPlayerId: fin.winnerPlayerId,
              outcomeReason: fin.reason,
              snapshot: {
                ...prev.snapshot,
                phase: fin.reason === 'SCORE_LIMIT' ? 'FINISHED' : 'FORFEITED',
                score: fin.finalScore,
              },
            };
          });
          break;
        }
        case 'match.rematch.updated': {
          const rem = event.payload;
          setActiveMatch((prev) => {
            if (!prev || prev.matchId !== rem.matchId) return prev;
            return {
              ...prev,
              rematch: rem,
            };
          });
          break;
        }
        case 'command.ack': {
          const pending = pendingProfileUpdateRef.current;
          if (pending && event.requestId === pending.requestId) {
            pendingProfileUpdateRef.current = null;
            setSavingProfile(false);
            setProfileServerError(null);
            setSavedProfile(pending.profile);
            const stored = loadStoredProfile();
            saveStoredProfile({
              ...pending.profile,
              recoveryToken: stored?.recoveryToken,
            });
            setEditingProfile(false);
          }
          break;
        }
        case 'command.error': {
          // Handle rejected profile update in edit modal
          const pending = pendingProfileUpdateRef.current;
          if (pending && event.requestId === pending.requestId) {
            pendingProfileUpdateRef.current = null;
            setSavingProfile(false);
            setProfileServerError(event.payload.message);
            break;
          }

          // Handle rejected initial handshake due to taken nickname or invalid profile
          if (
            !selfPlayerIdRef.current &&
            (event.payload.code === 'NICKNAME_TAKEN' || event.payload.code === 'INVALID_PROFILE')
          ) {
            setSavingProfile(false);
            setProfileServerError(event.payload.message);
            setSavedProfile(null);
            clientRef.current?.disconnect();
            break;
          }

          showBanner('error', event.payload.message);
          break;
        }
        case 'server.notice': {
          showBanner(
            event.payload.level === 'warning' ? 'error' : 'info',
            event.payload.message,
          );
          break;
        }
      }
    },
    [showBanner],
  );

  // Initialize ArenaClient once
  useEffect(() => {
    const client = new ArenaClient({
      onConnectionState: (state) => {
        setConnectionState(state);
      },
      onEvent: handleServerEvent,
      onTransportError: (msg) => showBanner('error', msg),
    });
    clientRef.current = client;

    const stored = loadStoredProfile();
    if (stored) {
      client.connect(
        { nickname: stored.nickname, avatarId: stored.avatarId },
        stored.recoveryToken,
      );
    }

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [handleServerEvent, showBanner]);

  // Keep ArenaClient's stored recovery token synced when profile updates
  useEffect(() => {
    if (!savedProfile) return;
    const stored = loadStoredProfile();
    if (stored?.recoveryToken) {
      updateStoredRecoveryToken(stored.recoveryToken);
    }
  }, [savedProfile]);

  const handleSaveOnboarding = (profile: PlayerProfile, pendingFile?: File | null) => {
    pendingUploadFileRef.current = pendingFile ?? null;
    setProfileServerError(null);
    setSavingProfile(true);
    setSavedProfile(profile);
    saveStoredProfile(profile);
    clientRef.current?.connect(profile);
  };

  const handleSaveEditProfile = (profile: PlayerProfile) => {
    setProfileServerError(null);
    const requestId = clientRef.current?.updateProfile(profile);
    if (!requestId) {
      setProfileServerError('Not connected to server. Please wait to reconnect.');
      return;
    }
    setSavingProfile(true);
    pendingProfileUpdateRef.current = { requestId, profile };
  };

  const handleReturnToLobby = () => {
    clientRef.current?.returnToLobby();
    setActiveMatch(null);
  };

  // Show onboarding screen until player configures a unique nickname & avatar
  if (!savedProfile) {
    const stored = loadStoredProfile();
    return (
      <ProfileSetupView
        mode="onboarding"
        initialProfile={
          stored ? { nickname: stored.nickname, avatarId: stored.avatarId } : null
        }
        uploadToken={null}
        serverError={profileServerError}
        saving={savingProfile}
        onClearServerError={() => setProfileServerError(null)}
        onSave={handleSaveOnboarding}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0d131a] text-slate-100 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="border-b border-white/10 bg-[#111922]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <span className="font-display text-2xl font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            LAN Pong Arena
          </span>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <span className="inline-flex items-center gap-2 whitespace-nowrap shrink-0">
              {connectionState === 'CONNECTED' ? (
                <>
                  <Wifi className="w-4 h-4 text-emerald-400" />
                  <span className="text-slate-200">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-300">
                    {connectionState === 'RECONNECTING' ? 'Reconnecting…' : 'Connecting…'}
                  </span>
                </>
              )}
            </span>

            {!activeMatch && (
              <button
                type="button"
                onClick={() => {
                  setProfileServerError(null);
                  setEditingProfile(true);
                }}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                Edit Profile
              </button>
            )}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Share LAN URL
            </button>
          </div>
        </div>
      </header>

      {/* Connection warning or error notice */}
      {connectionState === 'RECONNECTING' && (
        <div
          role="status"
          className="bg-amber-950/60 border-b border-amber-500/30 px-6 py-2.5 text-center text-xs font-medium text-amber-200"
        >
          Connection interrupted. Attempting to reconnect and restore your session…
        </div>
      )}

      {banner && (
        <div
          role="alert"
          className={`border-b px-6 py-2.5 ${
            banner.level === 'error'
              ? 'bg-red-950/60 border-red-500/30 text-red-200'
              : 'bg-slate-800/80 border-white/10 text-slate-200'
          }`}
        >
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 text-xs font-medium">
            <span className="inline-flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {banner.message}
            </span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              aria-label="Dismiss message"
              className="p-1 hover:bg-white/10 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content: Match Arena or Live Lobby */}
      <div className="flex-1">
        {activeMatch && selfPlayerId ? (
          <MatchView
            match={activeMatch}
            selfPlayerId={selfPlayerId}
            onSendInput={(matchId, direction, seq) =>
              clientRef.current?.sendMatchInput(matchId, direction, seq)
            }
            onLeaveMatch={(matchId) => clientRef.current?.leaveMatch(matchId)}
            onRequestRematch={(matchId) => clientRef.current?.requestRematch(matchId)}
            onAcceptRematch={(matchId) => clientRef.current?.acceptRematch(matchId)}
            onReturnToLobby={handleReturnToLobby}
          />
        ) : (
          <LobbyView
            selfPlayerId={selfPlayerId}
            players={lobbyPlayers}
            activeChallenge={activeChallenge}
            connected={connectionState === 'CONNECTED'}
            onChallenge={(targetId) => clientRef.current?.createChallenge(targetId)}
            onAcceptChallenge={(id) => clientRef.current?.acceptChallenge(id)}
            onDeclineChallenge={(id) => clientRef.current?.declineChallenge(id)}
            onCancelChallenge={(id) => clientRef.current?.cancelChallenge(id)}
            onOpenShare={() => setShareOpen(true)}
            onEditProfile={() => {
              setProfileServerError(null);
              setEditingProfile(true);
            }}
          />
        )}
      </div>

      {editingProfile && (
        <ProfileSetupView
          mode="edit"
          initialProfile={savedProfile}
          uploadToken={uploadToken}
          serverError={profileServerError}
          saving={savingProfile}
          onClearServerError={() => setProfileServerError(null)}
          onSave={handleSaveEditProfile}
          onCancel={() => {
            pendingProfileUpdateRef.current = null;
            setSavingProfile(false);
            setProfileServerError(null);
            setEditingProfile(false);
          }}
        />
      )}

      {shareOpen && <LanShareModal onClose={() => setShareOpen(false)} />}
    </div>
  );
}
