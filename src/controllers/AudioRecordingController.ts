import { RecordingModel } from '../models/RecordingModel';
import type { AudioSegment, Side, CounselSeat } from '../types';

export class AudioRecordingController {
  private model: RecordingModel;
  private mediaRecorder: any = null;
  private activeStream: any = null;
  private audioChunks: Blob[] = [];
  private onSegmentCreated?: (seg: AudioSegment) => void;

  constructor(model?: RecordingModel) {
    this.model = model || new RecordingModel();
  }

  public setOnSegmentCreated(callback: (seg: AudioSegment) => void): void {
    this.onSegmentCreated = callback;
  }

  public async startRecording(side: Side, seat?: CounselSeat, matchId?: string): Promise<boolean> {
    try {
      this.model.startSession(side, seat, matchId);
      this.audioChunks = [];

      // Clean up any previously unclosed stream
      if (this.activeStream) {
        try {
          this.activeStream.getTracks().forEach((track: any) => track.stop());
        } catch (_) {}
        this.activeStream = null;
      }

      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.activeStream = stream;
        const RecorderClass = (window as any).MediaRecorder;
        if (RecorderClass) {
          this.mediaRecorder = new RecorderClass(stream);
          this.mediaRecorder.ondataavailable = (e: any) => {
            if (e.data && e.data.size > 0) {
              this.audioChunks.push(e.data);
            }
          };
          this.mediaRecorder.start(1000);
        }
      }
      return true;
    } catch (_) {
      // Graceful fallback for non-mic or testing environments
      return true;
    }
  }

  /**
   * Evaluates spoken transcript to detect if the coach/adjudicator feedback stage has commenced.
   */
  public evaluateFeedbackTriggers(transcript: string): boolean {
    const lower = transcript.toLowerCase();
    const isFeedbackTrigger =
      lower.includes('老師講評') ||
      lower.includes('裁判講評') ||
      lower.includes('評語') ||
      lower.includes('feedback') ||
      lower.includes('comments') ||
      lower.includes('overall good job') ||
      lower.includes('整體來說') ||
      lower.includes('剛剛那一段') ||
      lower.includes('我們來看一下剛才');

    if (isFeedbackTrigger) {
      const seg = this.model.detectAndSplitCoachFeedback();
      if (seg && this.onSegmentCreated) {
        this.onSegmentCreated(seg);
      }
      return true;
    }
    return false;
  }

  public stopRecording(): AudioSegment[] {
    if (this.mediaRecorder) {
      try {
        if (this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
      } catch (_) {}
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder = null;
    }

    if (this.activeStream) {
      try {
        this.activeStream.getTracks().forEach((track: any) => track.stop());
      } catch (_) {}
      this.activeStream = null;
    }

    this.audioChunks = [];
    this.model.stopSession();
    return this.model.getSyncQueue();
  }

  public getModel(): RecordingModel {
    return this.model;
  }
}
