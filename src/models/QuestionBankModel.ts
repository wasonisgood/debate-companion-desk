import type { BenchQuestion, LiveChineseSummary, OralUnit, Side } from '../types';

export class QuestionBankModel {
  private questions: BenchQuestion[] = [];
  private summaries: LiveChineseSummary[] = [];

  constructor(questions: BenchQuestion[] = []) {
    this.questions = questions;
  }

  public setQuestions(questions: BenchQuestion[]): void {
    this.questions = questions;
  }

  public findBestQuestionForText(text: string, side: Side): BenchQuestion | null {
    const lower = text.toLowerCase();
    const sideQuestions = this.questions.filter(q => q.side === side);

    let bestMatch: BenchQuestion | null = null;
    let highestScore = 0;

    for (const q of sideQuestions) {
      let score = 0;
      const keywords = [...q.structure, q.category, q.issue, q.where];
      for (const kw of keywords) {
        if (kw && lower.includes(kw.toLowerCase())) {
          score += 2;
        }
      }
      // Check for legal term overlaps
      const keyLegalTerms = ['effective control', 'self-defence', 'proportionality', 'attribution', 'article 8', 'article 51', 'article 2(4)', 'additional protocol'];
      for (const term of keyLegalTerms) {
        if (lower.includes(term) && q.questionEn.toLowerCase().includes(term)) {
          score += 3;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = q;
      }
    }

    return bestMatch || (sideQuestions.length > 0 ? sideQuestions[0] : null);
  }

  /**
   * 隨念隨摘: the Chinese summary of the oral section being read. It is the
   * authored Chinese note of that section (OralUnit.notesZh), so it is always the
   * reviewed text for that part of the argument, never a guess from keywords.
   */
  public addChineseSummary(unit: OralUnit, transcript: string): LiveChineseSummary {
    const summaryZh = unit.notesZh?.trim() || '（此段尚未建立中文摘要）';
    const textEn = transcript;
    const unitId = unit.id;
    const entry: LiveChineseSummary = {
      id: `sum-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      unitId,
      textEn,
      summaryZh
    };

    this.summaries.push(entry);
    return entry;
  }

  public getSummaries(): LiveChineseSummary[] {
    return this.summaries;
  }

  public clearSummaries(): void {
    this.summaries = [];
  }
}
