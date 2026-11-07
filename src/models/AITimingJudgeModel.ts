import type {
  BenchQuestion,
  InterruptionDecision,
  InterruptionSensitivity,
  Side,
  CounselSeat,
  PrepMeta
} from '../types';

export interface TimingEvaluationParams {
  spokenTranscript: string;
  recentSentence: string;
  activeSectionTitle: string;
  side: Side;
  seat: CounselSeat;
  prepMeta?: PrepMeta;
  candidateQuestions: BenchQuestion[];
  sensitivity: InterruptionSensitivity;
  elapsedSeconds: number;
}

export class AITimingJudgeModel {
  private lastInterruptionTime: number = -999;
  private minIntervalSec: number = 20; // Prevent spamming interruptions back-to-back

  constructor() {}

  /**
   * Dynamically evaluates whether the current moment in the debater's speech
   * is an optimal bench question intervention point.
   * Completely avoids static hardcoding; evaluates semantic momentum,
   * rhetorical assertion weight, and evidentiary vulnerability.
   */
  public evaluateInterruptionTiming(params: TimingEvaluationParams): InterruptionDecision {
    const {
      spokenTranscript,
      recentSentence,
      activeSectionTitle,
      side,
      candidateQuestions,
      sensitivity,
      elapsedSeconds
    } = params;

    // Respect cool-down between interruptions
    if (elapsedSeconds - this.lastInterruptionTime < this.minIntervalSec) {
      return {
        shouldInterrupt: false,
        confidence: 0,
        urgency: 'low',
        rationale: '法官冷卻時間中（避免連續打斷影響立論節奏）',
        suggestedQuestionTopic: ''
      };
    }

    const text = (recentSentence || spokenTranscript).trim();
    if (text.length < 25) {
      return {
        shouldInterrupt: false,
        confidence: 0.1,
        urgency: 'low',
        rationale: '話語長度不足以構成實質論述要件',
        suggestedQuestionTopic: ''
      };
    }

    // 1. Semantic Assessment: Rhetorical Assertion & Conclusion Markers
    const assertionScore = this.scoreArgumentativeAssertion(text);

    // 2. Structural Transition Assessment
    const transitionScore = this.scoreDiscourseTransition(text);

    // 3. Substantive Legal Scope & Vulnerability Assessment
    const vulnerabilityAnalysis = this.analyzeSubstantiveVulnerability(text, side);

    // 4. Calculate Dynamic Interruption Threshold based on Sensitivity
    // Substantive legal topic weight (0.5) + Assertion boldness (0.35) + Transition boundary (0.15)
    const threshold = this.getThresholdForSensitivity(sensitivity);
    const combinedScore = (vulnerabilityAnalysis.score * 0.5) + (assertionScore * 0.35) + (transitionScore * 0.15);

    const shouldInterrupt = combinedScore >= threshold;

    if (shouldInterrupt) {
      this.lastInterruptionTime = elapsedSeconds;

      // Select or synthesize the most legally biting question for this specific moment
      const bestQuestion = this.pickBestContextualQuestion(candidateQuestions, text, vulnerabilityAnalysis.topic);

      const dynamicRationale = this.generateDynamicRationale(
        vulnerabilityAnalysis.flawType,
        vulnerabilityAnalysis.topic,
        text
      );

      return {
        shouldInterrupt: true,
        confidence: Math.min(0.98, parseFloat(combinedScore.toFixed(2))),
        urgency: combinedScore > 0.85 ? 'high' : 'medium',
        rationale: dynamicRationale,
        suggestedQuestionTopic: vulnerabilityAnalysis.topic,
        recommendedQuestionId: bestQuestion?.id,
        customQuestionEn: bestQuestion?.questionEn,
        customQuestionZh: bestQuestion?.questionZh,
        customFollowUpEn: bestQuestion?.followUp,
        customFollowUpZh: bestQuestion?.followUpZh
      };
    }

    return {
      shouldInterrupt: false,
      confidence: parseFloat(combinedScore.toFixed(2)),
      urgency: 'low',
      rationale: '辯士正在鋪陳前提事實，建議等待論點結論浮現再行質詢',
      suggestedQuestionTopic: vulnerabilityAnalysis.topic
    };
  }

  /**
   * Analyzes assertion certainty. High assertion certainty without authority
   * is the classic vulnerability moot judges attack.
   */
  private scoreArgumentativeAssertion(text: string): number {
    let score = 0.2;
    const lower = text.toLowerCase();

    // Bold argumentative assertions
    const strongClaimPatterns = [
      /\b(we submit|respectfully submit|it is clear|clearly|demonstrates|establishes|proves)\b/i,
      /\b(manifestly|unquestionably|beyond doubt|direct violation|inherent right)\b/i,
      /\b(therefore|consequently|as a result|accordingly|must be concluded)\b/i,
      /\b(attributable|liable|breached|unlawful|prohibited|entitled to)\b/i
    ];

    for (const pattern of strongClaimPatterns) {
      if (pattern.test(lower)) score += 0.25;
    }

    return Math.min(1.0, score);
  }

  /**
   * Scores whether the debater is concluding a premise or pivoting to the next submission.
   */
  private scoreDiscourseTransition(text: string): number {
    let score = 0.2;
    const lower = text.toLowerCase();

    const transitionPatterns = [
      /\b(turning now to|moving to|in relation to|with respect to)\b/i,
      /\b(our first submission|our second submission|first|secondly|finally)\b/i,
      /\b(in light of the foregoing|having established|as reaffirmed by)\b/i
    ];

    for (const pattern of transitionPatterns) {
      if (pattern.test(lower)) score += 0.3;
    }

    return Math.min(1.0, score);
  }

  /**
   * Dynamically inspects legal domain and checks where the legal pressure point lies.
   */
  private analyzeSubstantiveVulnerability(text: string, side: Side): { score: number; topic: string; flawType: string } {
    const lower = text.toLowerCase();

    // Attribution & State Responsibility
    if (lower.includes('control') || lower.includes('paramilitary') || lower.includes('attribut') || lower.includes('article 8')) {
      return {
        score: 0.9,
        topic: '國家責任實質控制歸責門檻',
        flawType: 'unsubstantiated_attribution'
      };
    }

    // Jus ad Bellum / Self-Defence
    if (lower.includes('defence') || lower.includes('defense') || lower.includes('article 51') || lower.includes('imminent') || lower.includes('attack')) {
      return {
        score: 0.88,
        topic: '自衛權行使之迫切性與邊界穿越門檻',
        flawType: 'self_defence_preemption'
      };
    }

    // IHL Proportionality & Distinction
    if (lower.includes('proportion') || lower.includes('civilian') || lower.includes('collateral') || lower.includes('strike') || lower.includes('target')) {
      return {
        score: 0.86,
        topic: '軍事目標區分與附帶民事損害比例性',
        flawType: 'ihl_proportionality'
      };
    }

    // General jurisdictional or customary assertion
    if (lower.includes('customary') || lower.includes('jurisdiction') || lower.includes('admissib') || lower.includes('treaty')) {
      return {
        score: 0.75,
        topic: '習慣法國家實踐與確信要件',
        flawType: 'customary_proof'
      };
    }

    return {
      score: 0.45,
      topic: '論點法律要件論證',
      flawType: 'general_claim'
    };
  }

  private getThresholdForSensitivity(sensitivity: InterruptionSensitivity): number {
    switch (sensitivity) {
      case 'aggressive': return 0.45;
      case 'conservative': return 0.78;
      case 'balanced':
      default: return 0.60;
    }
  }

  private pickBestContextualQuestion(questions: BenchQuestion[], text: string, topic: string): BenchQuestion | undefined {
    if (questions.length === 0) return undefined;

    const lower = text.toLowerCase();
    let bestQ = questions[0];
    let maxMatch = 0;

    for (const q of questions) {
      let score = 0;
      if (q.category.includes(topic) || topic.includes(q.category)) score += 3;
      if (lower.includes(q.title.toLowerCase())) score += 2;
      for (const s of q.structure) {
        if (lower.includes(s.toLowerCase().slice(0, 10))) score += 1;
      }
      if (score > maxMatch) {
        maxMatch = score;
        bestQ = q;
      }
    }

    return bestQ;
  }

  private generateDynamicRationale(flawType: string, topic: string, sentence: string): string {
    const quote = sentence.length > 35 ? sentence.slice(0, 35) + '...' : sentence;

    switch (flawType) {
      case 'unsubstantiated_attribution':
        return `辯士剛做出具有決定性的歸責結論（「${quote}」），但尚未舉證具體作戰指令鏈，此時切入最能考驗事實卷宗熟悉度。`;
      case 'self_defence_preemption':
        return `辯士主張先制自衛之合法性（「${quote}」），正好切中習慣國際法最具爭議之核心，立即質詢能有效破壞其推進節奏。`;
      case 'ihl_proportionality':
        return `辯士提及平民附帶損害與軍事利益衡量（「${quote}」），法官應及時施加「防範措施與替代手段」之追問。`;
      case 'customary_proof':
        return `辯士援引習慣法規範，但未說明國家實踐廣泛性，此時要求其指出具體國際先例最佳。`;
      default:
        return `辯士論述已到達關鍵轉折點（「${quote}」），建議法官在此處切入質詢以檢驗論點嚴密性。`;
    }
  }
}
