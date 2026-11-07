import type { RecordingSession, AudioSegment, Side, CounselSeat } from '../types';

export class RecordingModel {
  private currentSession: RecordingSession | null = null;
  private syncQueue: AudioSegment[] = [];

  constructor() {}

  public startSession(side: Side, seat?: CounselSeat, matchId?: string): RecordingSession {
    const session: RecordingSession = {
      id: `rec-${Date.now()}`,
      startTime: Date.now(),
      side,
      counselSeat: seat,
      matchId,
      segments: [
        {
          id: `seg-oral-${Date.now()}`,
          type: 'oral_argument',
          startTime: Date.now(),
          durationSec: 0,
          syncStatus: 'pending'
        }
      ],
      isRecording: true,
      isCoachFeedbackDetected: false
    };

    this.currentSession = session;
    return session;
  }

  public getCurrentSession(): RecordingSession | null {
    return this.currentSession;
  }

  /**
   * Automatically isolates and splits out the coach/adjudicator feedback segment.
   * ("把老師講評的部份額外的識別出來然後單獨把這一段切成錄切成1段然後也是云端進行同步")
   */
  public detectAndSplitCoachFeedback(): AudioSegment | null {
    if (!this.currentSession || !this.currentSession.isRecording) return null;
    if (this.currentSession.isCoachFeedbackDetected) return null;

    const now = Date.now();
    // Close the current oral argument segment
    const activeSeg = this.currentSession.segments[this.currentSession.segments.length - 1];
    if (activeSeg) {
      activeSeg.endTime = now;
      activeSeg.durationSec = Math.round((now - activeSeg.startTime) / 1000);
      this.syncQueue.push(activeSeg);
    }

    // Start a dedicated coach feedback segment
    const feedbackSeg: AudioSegment = {
      id: `seg-coach-${Date.now()}`,
      type: 'coach_feedback',
      startTime: now,
      durationSec: 0,
      syncStatus: 'pending'
    };

    this.currentSession.segments.push(feedbackSeg);
    this.currentSession.isCoachFeedbackDetected = true;
    return feedbackSeg;
  }

  public stopSession(): RecordingSession | null {
    if (!this.currentSession) return null;

    const now = Date.now();
    this.currentSession.endTime = now;
    this.currentSession.isRecording = false;

    // Finalize active segment
    const lastSeg = this.currentSession.segments[this.currentSession.segments.length - 1];
    if (lastSeg && !lastSeg.endTime) {
      lastSeg.endTime = now;
      lastSeg.durationSec = Math.round((now - lastSeg.startTime) / 1000);
      this.syncQueue.push(lastSeg);
    }

    const completed = this.currentSession;
    return completed;
  }

  public getSyncQueue(): AudioSegment[] {
    return this.syncQueue;
  }

  public markSegmentSynced(segmentId: string, cloudUrl: string): void {
    const item = this.syncQueue.find(s => s.id === segmentId);
    if (item) {
      item.syncStatus = 'synced';
      item.cloudUrl = cloudUrl;
    }
  }
}
