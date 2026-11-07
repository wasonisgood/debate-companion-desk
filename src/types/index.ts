/**
 * Debate Companion Desk Types
 * Aligned with Moot Court Debate Module specifications
 */

export type Side = 'prosecution' | 'defense';
export type CounselSeat = 1 | 2;
export type InterruptionSensitivity = 'aggressive' | 'balanced' | 'conservative';

export interface BenchQuestion {
  id: string;
  title: string;
  side: Side;
  category: string;
  where: string;
  whereZh: string;
  issue: string;
  questionEn: string;
  questionZh: string;
  simplified?: string;
  followUp?: string;
  followUpZh?: string;
  structure: string[];
  sampleEn: string;
  sampleZh: string;
  seat?: CounselSeat;
  match?: string;
}

export interface OralUnit {
  id: string;
  side: Side;
  speaker: string;
  speakerId: 'yang' | 'chen';
  section: string;
  textEn: string;
  notesZh: string;
  qa?: string[];
  seat?: CounselSeat;
}

export interface FollowUpExample {
  title: string;
  side: Side;
  speaker: string;
  dialogue: { role: 'judge' | 'counsel'; text: string }[];
}

export interface MatchPrep {
  id: string;
  matchNumber?: string;
  side: Side;
  opponentTeam?: string;
  roundName?: string;
  scheduledAt?: string;
  notes?: string;
  judgeNames?: string[];
  focusQuestions?: string[];
}

export interface PrepMeta {
  teamNumber?: string;
  factsSummary?: string;
  applicantMemorialOverview?: string;
  respondentMemorialOverview?: string;
}

export interface DebateData {
  prosecutionQuestions: BenchQuestion[];
  defenseQuestions: BenchQuestion[];
  prosecutionOral: OralUnit[];
  defenseOral: OralUnit[];
  followUpExamples: FollowUpExample[];
  matches?: MatchPrep[];
  prep?: PrepMeta;
}

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
}
