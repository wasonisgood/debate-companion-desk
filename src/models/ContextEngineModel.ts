import type { Side, CounselSeat, PrepMeta, MatchPrep } from '../types';

export interface ContextPayload {
  side: Side;
  seat: CounselSeat;
  opposingParty: string;
  roundName: string;
  ourMemorialSummary: string;
  opponentMemorialSummary: string;
  factsOverview: string;
  activeLegalIssues: string[];
}

export class ContextEngineModel {
  private currentSide: Side = 'prosecution';
  private currentSeat: CounselSeat = 1;
  private prepMeta: PrepMeta = { team: "", facts: "", factsName: "" };
  private activeMatch: MatchPrep | null = null;

  constructor(side: Side = 'prosecution', seat: CounselSeat = 1, prepMeta?: PrepMeta, match?: MatchPrep) {
    this.currentSide = side;
    this.currentSeat = seat;
    if (prepMeta) this.prepMeta = prepMeta;
    if (match) this.activeMatch = match;
  }

  public setSide(side: Side): void {
    this.currentSide = side;
  }

  public getSide(): Side {
    return this.currentSide;
  }

  public setSeat(seat: CounselSeat): void {
    this.currentSeat = seat;
  }

  public getSeat(): CounselSeat {
    return this.currentSeat;
  }

  public setPrepMeta(meta: PrepMeta): void {
    this.prepMeta = meta;
  }

  public setActiveMatch(match: MatchPrep | null): void {
    this.activeMatch = match;
  }

  /**
   * Builds an optimized judicial prompt context ensuring accurate legal scope
   * with minimal token overhead for real-time responsiveness.
   */
  public buildPromptContext(spokenTranscript: string, activeSection: string): string {
    const isApplicant = this.currentSide === 'prosecution';
    const sideLabel = isApplicant ? 'Applicant (正方 / 申請方)' : 'Respondent (反方 / 被申請方)';
    const opponentLabel = isApplicant ? 'Respondent (被申請方)' : 'Applicant (申請方)';

    // Our position: the priorities of the active match; the opponent's: the headings
    // of the memorial imported for that match (對方書狀). Falls back to the standing focus.
    const opponentMemorial = this.activeMatch?.memorial
      ? this.activeMatch.memorial.paras.slice(0, 8).map((p) => p.head).filter(Boolean).join('; ')
      : '';
    const ourPriorities = this.activeMatch?.assess.priorities.filter(Boolean).join('; ') ?? '';
    const ourMemorial = ourPriorities || (isApplicant
      ? 'Focus on UN Charter Art 2(4), state attribution under ILC Art 8, and Additional Protocol I distinction.'
      : 'Focus on UN Charter Art 51 self-defence, absence of attribution, and target proportionality.');
    const opponentCore = opponentMemorial || (isApplicant
      ? 'Anticipate self-defence justifications and lack of state responsibility.'
      : 'Anticipate claims of territorial sovereignty violations.');

    const facts = this.prepMeta.facts?.trim().slice(0, 1200)
      || 'Dispute regarding cross-border military strikes and civilian casualty allegations.';

    return `
[JUDICIAL CONTEXT]
- Court: International Court of Justice (Bench Practice)
- Practicing Side: ${sideLabel} (Counsel Seat ${this.currentSeat})
- Opponent: ${opponentLabel} (${this.activeMatch?.oppTeam || 'Unknown Opponent'})
- Active Stage: ${activeSection}

[FACTS & MEMORIALS]
- Moot Problem / Facts: ${facts}
- Our Memorial Core: ${ourMemorial}
- Opponent Counter-Memorial Core: ${opponentCore}

[DEBATER SPOKEN CONTENT]
"${spokenTranscript}"

[ROLE & TASK]
You are a sharp, probing Judge on the ICJ bench. In light of both our memorial and the opponent's memorial, identify vulnerabilities, unsupported factual claims, or legal leaps in the debater's spoken argument. Ask ONE concise, incisive bench question in English. Provide a brief Chinese translation and expected answer key.
`.trim();
  }
}
