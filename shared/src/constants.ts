export const PROTOCOL_VERSION = 1 as const;

export const ARENA_ASPECT = 1.6; // 16:10 logical court aspect ratio

// Normalized [0, 1] court geometry (paddle & ball dimensions tuned for 16:10)
export const PADDLE_MARGIN_X = 0.035;
export const PADDLE_WIDTH = 0.016;
export const PADDLE_HEIGHT = 0.19;
export const PADDLE_SPEED = 0.92; // normalized Y units / second

export const BALL_RADIUS_Y = 0.016;
export const BALL_RADIUS_X = BALL_RADIUS_Y / ARENA_ASPECT; // 0.01 in normalized X

// Velocities in height-normalized units/second (X velocity divided by ARENA_ASPECT when updating x)
export const BALL_INITIAL_SPEED = 0.72;
export const BALL_SPEED_INCREMENT = 0.045;
export const BALL_MAX_SPEED = 1.48;
export const MAX_BOUNCE_ANGLE_RAD = (50 * Math.PI) / 180;

export const WIN_SCORE = 5;

export const SIMULATION_HZ = 60;
export const SIMULATION_DT_SEC = 1 / SIMULATION_HZ;
export const SIMULATION_DT_MS = 1000 / SIMULATION_HZ;
export const SNAPSHOT_INTERVAL_TICKS = 2; // 30 Hz broadcast
export const MAX_CATCHUP_STEPS = 4;

export const INITIAL_COUNTDOWN_MS = 3000;
export const POINT_COUNTDOWN_MS = 1500;
export const RESUME_COUNTDOWN_MS = 2000;

export const CHALLENGE_EXPIRY_MS = 30_000;
export const DISCONNECT_GRACE_MS = 10_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_TIMEOUT_MS = 15_000;

export const MAX_NICKNAME_LENGTH = 24;
export const MIN_NICKNAME_LENGTH = 1;
export const MAX_AVATAR_BYTES = 1_048_576; // 1 MiB
export const AVATAR_OUTPUT_SIZE = 256;
export const MAX_WS_PAYLOAD_BYTES = 16_384; // 16 KiB

export interface BundledAvatar {
  id: string;
  label: string;
  url: string;
}

export const BUNDLED_AVATARS: readonly BundledAvatar[] = [
  { id: 'gallery:ace-paddle', label: 'Ace Paddle', url: '/avatars/ace-paddle.svg' },
  { id: 'gallery:rally-fox', label: 'Rally Fox', url: '/avatars/rally-fox.svg' },
  { id: 'gallery:spin-owl', label: 'Spin Owl', url: '/avatars/spin-owl.svg' },
  { id: 'gallery:net-falcon', label: 'Net Falcon', url: '/avatars/net-falcon.svg' },
  { id: 'gallery:corner-bear', label: 'Corner Bear', url: '/avatars/corner-bear.svg' },
  { id: 'gallery:smash-tiger', label: 'Smash Tiger', url: '/avatars/smash-tiger.svg' },
  { id: 'gallery:baseline-wolf', label: 'Baseline Wolf', url: '/avatars/baseline-wolf.svg' },
  { id: 'gallery:volley-cat', label: 'Volley Cat', url: '/avatars/volley-cat.svg' },
] as const;

export const DEFAULT_AVATAR_ID = BUNDLED_AVATARS[0].id;
export const DEFAULT_AVATAR_URL = '/avatars/default.svg';
