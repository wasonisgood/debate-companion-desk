import { RecordingModel } from '../models/RecordingModel';
import type { AudioSegment, Side, CounselSeat } from '../types';

/** One encoded chunk from MediaRecorder, with the time it arrived. */
interface TimedChunk { t: number; blob: Blob; }

export interface FinishedSegment {
  segment: AudioSegment;
  /** Playable audio for this segment, or null when no microphone audio was captured. */
  audio: Blob | null;
  /** Final transcript lines spoken inside the segment's time window. */
  transcript: string;
}

/**
 * Records the practice session and cuts it into the segments the model defines
 * (oral argument, coach feedback). Every chunk is timestamped so each segment can
 * be rebuilt as its own audio file.
 */
export class AudioRecordingController {
  private model: RecordingModel;
  private mediaRecorder: any = null;
  private activeStream: any = null;
  private chunks: TimedChunk[] = [];
  private transcripts: { t: number; text: string }[] = [];
  private onSegmentCreated?: (seg: AudioSegment) => void;

  constructor(model?: RecordingModel) {
    this.model = model || new RecordingModel();
  }

  public setOnSegmentCreated(callback: (seg: AudioSegment) => void): void {
    this.onSegmentCreated = callback;
  }

  public isRecording(): boolean {
    return !!this.model.getCurrentSession()?.isRecording;
  }

  public async startRecording(side: Side, seat?: CounselSeat, matchId?: string): Promise<boolean> {
    this.model.startSession(side, seat, matchId);
    this.chunks = [];
    this.transcripts = [];
    this.releaseStream();
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.activeStream = stream;
        const RecorderClass = (window as any).MediaRecorder;
        if (RecorderClass) {
          this.mediaRecorder = new RecorderClass(stream);
          this.mediaRecorder.ondataavailable = (e: any) => {
            if (e.data && e.data.size > 0) this.chunks.push({ t: Date.now(), blob: e.data });
          };
          this.mediaRecorder.start(1000);
        }
      }
    } catch (err) {
      // No microphone (or denied): the session still tracks segments, just without audio.
      console.warn('Recording without audio:', err);
    }
    return true;
  }

  /** Keep a final transcript line so it can be attached to the segment it falls in. */
  public noteTranscript(text: string, at: number = Date.now()): void {
    if (text.trim()) this.transcripts.push({ t: at, text: text.trim() });
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

  /**
   * Stops the recorder, waits for its last chunk, closes the session and returns
   * every segment of that session with its own audio and transcript.
   */
  public async stopRecording(): Promise<FinishedSegment[]> {
    const session = this.model.getCurrentSession();
    if (!session || !session.isRecording) return [];

    await this.stopRecorder();
    this.releaseStream();
    const endedAt = Date.now();
    this.model.stopSession();

    const out: FinishedSegment[] = session.segments.map((seg) => {
      const end = seg.endTime ?? endedAt;
      return {
        segment: seg,
        audio: this.audioFor(seg.startTime, end),
        transcript: this.transcriptFor(seg.startTime, end),
      };
    });
    this.model.clearSyncQueue();
    this.chunks = [];
    this.transcripts = [];
    return out;
  }

  public getModel(): RecordingModel {
    return this.model;
  }

  /** Resolves when MediaRecorder has delivered its final chunk (or after a short timeout). */
  private stopRecorder(): Promise<void> {
    const rec = this.mediaRecorder;
    this.mediaRecorder = null;
    if (!rec) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      rec.onstop = done;
      try {
        if (rec.state !== 'inactive') rec.stop();
        else done();
      } catch {
        done();
      }
      setTimeout(done, 1500);
    });
  }

  private releaseStream(): void {
    if (this.activeStream) {
      try { this.activeStream.getTracks().forEach((track: any) => track.stop()); } catch {}
      this.activeStream = null;
    }
  }

  /**
   * Audio for [start, end]. MediaRecorder writes its container header only into the
   * first chunk, so that chunk is prepended to every later segment to keep it playable.
   */
  private audioFor(start: number, end: number): Blob | null {
    if (!this.chunks.length) return null;
    const inside = this.chunks.filter((c) => c.t >= start - 1000 && c.t <= end + 1000);
    if (!inside.length) return null;
    const header = this.chunks[0];
    const parts = inside[0] === header ? inside : [header, ...inside];
    const type = parts[0].blob.type || 'audio/webm';
    return new Blob(parts.map((c) => c.blob), { type });
  }

  private transcriptFor(start: number, end: number): string {
    return this.transcripts.filter((x) => x.t >= start && x.t <= end).map((x) => x.text).join(' ');
  }
}
