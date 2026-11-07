import type { OralUnit, SpeechAlignmentResult } from '../types';

export class AlignmentController {
  private activeUnit: OralUnit | null = null;
  private unitWords: string[] = [];

  constructor(unit?: OralUnit) {
    if (unit) {
      this.setActiveUnit(unit);
    }
  }

  public setActiveUnit(unit: OralUnit): void {
    this.activeUnit = unit;
    this.unitWords = unit.textEn
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  public alignSpeech(spokenTranscript: string): SpeechAlignmentResult {
    if (!this.activeUnit || this.unitWords.length === 0) {
      return {
        currentUnitId: null,
        progressPercent: 0,
        matchedWordsCount: 0,
        totalWordsCount: 0,
        activeSentence: '',
        matchedFraction: 0
      };
    }

    const spokenWords = spokenTranscript
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 0);

    // Sequential prefix matching against unitWords
    let matchedCount = 0;
    let speechIdx = 0;
    for (let i = 0; i < this.unitWords.length && speechIdx < spokenWords.length; i++) {
      if (this.unitWords[i] === spokenWords[speechIdx]) {
        matchedCount = i + 1;
        speechIdx++;
      }
    }

    // Fallback if direct sequential match was low, estimate based on transcript length
    if (matchedCount === 0 && spokenWords.length > 0) {
      matchedCount = Math.min(this.unitWords.length, spokenWords.length);
    }

    const matchedFraction = Math.min(1, matchedCount / this.unitWords.length);
    const progressPercent = Math.round(matchedFraction * 100);

    // Determine current active sentence
    const sentences = this.activeUnit.textEn.split(/(?<=[.?!])\s+/);
    const sentenceIndex = Math.min(
      sentences.length - 1,
      Math.floor(matchedFraction * sentences.length)
    );
    const activeSentence = sentences[sentenceIndex] || '';

    return {
      currentUnitId: this.activeUnit.id,
      progressPercent,
      matchedWordsCount: matchedCount,
      totalWordsCount: this.unitWords.length,
      activeSentence,
      matchedFraction
    };
  }
}
