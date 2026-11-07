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
        matchedFraction: 0,
        isKeyInterruptionPoint: false
      };
    }

    const spokenWords = spokenTranscript
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 0);

    // Compute longest matching prefix / fuzzy sliding match
    let matchedCount = 0;
    const spokenSet = new Set(spokenWords.slice(-15)); // focus on recent words

    for (let i = 0; i < this.unitWords.length; i++) {
      if (spokenSet.has(this.unitWords[i])) {
        matchedCount = Math.max(matchedCount, i + 1);
      }
    }

    // Fallback if direct match was low, estimate based on transcript length
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

    // Check if this position is a key legal assertion (ideal interruption point)
    const lowerSentence = activeSentence.toLowerCase();
    const lowerSpoken = spokenTranscript.toLowerCase();
    const isKeyInterruptionPoint =
      lowerSentence.includes('effective control') ||
      lowerSentence.includes('self-defence') ||
      lowerSentence.includes('article 8') ||
      lowerSentence.includes('article 51') ||
      lowerSentence.includes('proportionality') ||
      lowerSentence.includes('bombardment') ||
      lowerSentence.includes('humanitarian') ||
      lowerSpoken.includes('effective control') ||
      lowerSpoken.includes('self-defence') ||
      lowerSpoken.includes('article 8') ||
      lowerSpoken.includes('article 51') ||
      lowerSpoken.includes('proportionality');

    const recommendedQuestionId = this.activeUnit.qa && this.activeUnit.qa.length > 0
      ? this.activeUnit.qa[0]
      : undefined;

    return {
      currentUnitId: this.activeUnit.id,
      progressPercent,
      matchedWordsCount: matchedCount,
      totalWordsCount: this.unitWords.length,
      activeSentence,
      matchedFraction,
      isKeyInterruptionPoint,
      recommendedQuestionId
    };
  }
}
