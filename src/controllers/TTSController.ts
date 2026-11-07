export interface PronunciationGloss {
  term: string;
  phonetic: string;
  meaningZh: string;
}

export const LEGAL_LATIN_GLOSSARY: PronunciationGloss[] = [
  { term: 'jus cogens', phonetic: '/juːs ˈkoʊdʒɛnz/ (約斯‧柯金斯)', meaningZh: '國際法絕對強行律' },
  { term: 'opinio juris', phonetic: '/oʊˈpɪnioʊ ˈjʊərɪs/ (歐皮尼歐‧尤里斯)', meaningZh: '法律確信' },
  { term: 'chapeau', phonetic: '/ʃæˈpoʊ/ (夏波)', meaningZh: '前言總帽條款' },
  { term: 'ratione materiae', phonetic: '/ˌræʃiˈoʊni məˈtɪərieɪ/ (拉提歐內‧馬提里埃)', meaningZh: '事物管轄權' },
  { term: 'ratione personae', phonetic: '/ˌræʃiˈoʊni pərˈsoʊni/ (拉提歐內‧佩索內)', meaningZh: '對人管轄權' },
  { term: 'mens rea', phonetic: '/mɛnz ˈreɪə/ (門斯‧雷亞)', meaningZh: '犯罪故意／主觀要件' },
  { term: 'ultra vires', phonetic: '/ˌʌltrə ˈvaɪriːz/ (奧特拉‧拜里斯)', meaningZh: '越權行為' },
  { term: 'proprio motu', phonetic: '/ˈproʊprioʊ ˈmoʊtuː/ (普羅皮歐‧莫圖)', meaningZh: '法院依職權自動發起' },
  { term: 'prima facie', phonetic: '/ˌpraɪmə ˈfeɪʃii/ (普萊瑪‧費雪)', meaningZh: '表面初步成立' }
];

export class TTSController {
  private synth: any = null;
  private isSpeaking: boolean = false;
  private currentUtterance: any = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  public speak(text: string, rate: number = 1.0, onEnd?: () => void): boolean {
    if (!this.synth) {
      if (onEnd) onEnd();
      return false;
    }

    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = rate;
    utterance.pitch = 1.0;

    // Pick English voice if available
    const voices = this.synth.getVoices();
    const enVoice = voices.find((v: any) => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('David') || v.name.includes('Zira')));
    if (enVoice) {
      utterance.voice = enVoice;
    }

    utterance.onend = () => {
      this.isSpeaking = false;
      this.currentUtterance = null;
      if (onEnd) onEnd();
    };

    utterance.onerror = () => {
      this.isSpeaking = false;
      this.currentUtterance = null;
      if (onEnd) onEnd();
    };

    this.isSpeaking = true;
    this.currentUtterance = utterance;
    this.synth.speak(utterance);
    return true;
  }

  public stop(): void {
    if (this.synth) {
      try {
        this.synth.cancel();
      } catch (_) {}
    }
    this.isSpeaking = false;
    this.currentUtterance = null;
  }

  public getGlossaryForText(text: string): PronunciationGloss[] {
    const lower = text.toLowerCase();
    return LEGAL_LATIN_GLOSSARY.filter(item => lower.includes(item.term.toLowerCase()));
  }
}
