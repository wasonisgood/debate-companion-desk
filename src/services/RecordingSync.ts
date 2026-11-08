import { saveRecord, type RecordInput } from '../web/lib/debateRecords';
import type { FinishedSegment } from '../controllers/AudioRecordingController';
import type { Side } from '../types';

export interface SyncContext {
  side: Side;
  /** Human title for the round, e.g. "控方 · 第 3 回合". */
  roundTitle: string;
  sessionId: string;
  matchId?: string;
}

export interface SyncSummary {
  saved: number;
  queued: number;
  failed: number;
}

const LABEL = { oral_argument: '口說段落', coach_feedback: '老師講評' } as const;

/**
 * Uploads each finished segment as its own record with its own audio, through the
 * website's record storage (same account, same rules, same offline queue). Segment
 * status is written back so the UI can show what is in the cloud.
 */
export async function syncFinishedSegments(items: FinishedSegment[], ctx: SyncContext): Promise<SyncSummary> {
  const summary: SyncSummary = { saved: 0, queued: 0, failed: 0 };
  for (const item of items) {
    const { segment: seg, audio, transcript } = item;
    const label = LABEL[seg.type];
    const rec: RecordInput = {
      kind: 'coach',
      side: ctx.side,
      target_id: seg.id,
      title: `${label} · ${ctx.roundTitle}`,
      stage: seg.type,
      duration_sec: seg.durationSec,
      engine: 'desktop-live',
      transcript,
      detail: { segment: seg.type, session: ctx.sessionId, match: ctx.matchId ?? '' },
    };
    seg.syncStatus = 'syncing';
    try {
      const res = await saveRecord(rec, audio, audio ? `桌面即時陪練錄音（${label}）` : '');
      if (res.error && !res.queued) {
        seg.syncStatus = 'error';
        summary.failed++;
      } else if (res.queued) {
        seg.syncStatus = 'pending';
        summary.queued++;
      } else {
        seg.syncStatus = 'synced';
        seg.cloudUrl = res.id ? `record:${res.id}` : undefined;
        summary.saved++;
      }
    } catch {
      seg.syncStatus = 'error';
      summary.failed++;
    }
  }
  return summary;
}
