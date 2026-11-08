/**
 * Debate Companion Desk Types
 * Aligned with Moot Court Debate Module specifications
 */

export type Side = 'prosecution' | 'defense';
export type CounselSeat = 1 | 2;
export type InterruptionSensitivity = 'aggressive' | 'balanced' | 'conservative';

// Debate data types are defined once, in the website debate module (src/web/lib),
// so the desktop app and the website read and write the same shapes.
export type { BenchQuestion, OralUnit, FollowUpExample } from '../web/lib/debateData';
export type { MatchPrep, PrepMeta } from '../web/lib/matchPrep';
export type { DebateData } from '../web/lib/debateStorage';

export type RoadmapNodeStatus = 'pending' | 'active' | 'completed' | 'interrupted';

export interface RoadmapNode {
  id: string;
  title: string;
  titleZh: string;
  section: string;
  side: Side;
  speaker: string;
  status: RoadmapNodeStatus;
  keyIssues: string[];
  questionIds: string[];
  oralUnitId?: string;
  order: number;
}

export interface SpeechAlignmentResult {
  currentUnitId: string | null;
  progressPercent: number;
  matchedWordsCount: number;
  totalWordsCount: number;
  activeSentence: string;
  matchedFraction: number;
}

export interface InterruptionDecision {
  shouldInterrupt: boolean;
  confidence: number; // 0.0 - 1.0
  urgency: 'high' | 'medium' | 'low';
  rationale: string;
  suggestedQuestionTopic: string;
  recommendedQuestionId?: string;
  customQuestionEn?: string;
  customQuestionZh?: string;
  customFollowUpEn?: string;
  customFollowUpZh?: string;
}

export interface LiveChineseSummary {
  id: string;
  timestamp: number;
  unitId: string;
  textEn: string;
  summaryZh: string;
}

export interface AudioSegment {
  id: string;
  type: 'oral_argument' | 'coach_feedback';
  startTime: number;
  endTime?: number;
  durationSec: number;
  localPath?: string;
  cloudUrl?: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'error';
}

export interface RecordingSession {
  id: string;
  startTime: number;
  endTime?: number;
  side: Side;
  matchId?: string;
  counselSeat?: CounselSeat;
  segments: AudioSegment[];
  isRecording: boolean;
  isCoachFeedbackDetected: boolean;
}

export interface MootTimerRule {
  name: string;
  totalSeconds: number;
  warningSeconds: number;
  overtimeAllowedSeconds: number;
}

export interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  remainingSeconds: number;
  totalSeconds: number;
  isWarningFired: boolean;
  isFinishedFired: boolean;
  isOvertime: boolean;
}

export interface AppSettings {
  showRoadmap: boolean;
  showScriptTracker: boolean;
  showLiveChineseSummary: boolean;
  showAIQuestionPrompts: boolean;
  showTTSHelper: boolean;
  enableSmartTimer: boolean;
  enableAutoBells: boolean;
  enableAutoRecording: boolean;
  enableFeedbackSegmentation: boolean;
  autoHidePopoutSec: number;
  interruptionSensitivity: InterruptionSensitivity;
  ttsSpeed: number;
  ttsVoiceName?: string;
  bridgePort: number;
  targetSide: Side;
  targetSeat: CounselSeat;
}

export interface AuthSession {
  userId: string;
  userName: string;
  userEmail: string;
  token: string;
  role: string;
  authorizedAt: number;
  /** Supabase session handed over by the website on authorization. */
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}
