import type { BenchQuestion, LiveChineseSummary, Side } from '../types';

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
   * Generates dynamic follow-up question based on debater's actual response.
   */
  public generateDynamicFollowUp(debaterAnswer: string, originalQuestion: BenchQuestion): { followUpEn: string; followUpZh: string } {
    const ansLower = debaterAnswer.toLowerCase();

    // Check specific legal weaknesses in debater's response
    if (ansLower.includes('effective control') || ansLower.includes('nicaragua')) {
      return {
        followUpEn: 'Counsel, if the Court determines that effective control requires evidence of issuance of directions for each specific operation, what concrete document in the record proves that direct order?',
        followUpZh: '訴訟代理人，若法院認定實質控制需針對每次具體行動下達指令，卷內哪一項具體證據能證明該直接命令？'
      };
    }

    if (ansLower.includes('self-defence') || ansLower.includes('article 51') || ansLower.includes('attack')) {
      return {
        followUpEn: 'Even accepting an imminent threat, Counsel, does Article 51 permit extraterritorial force before an actual armed attack has occurred?',
        followUpZh: '代理人，即便存在迫切威脅，第51條是否允許在武裝攻擊實際發生前行使境外武力？'
      };
    }

    if (ansLower.includes('proportionality') || ansLower.includes('civilian') || ansLower.includes('collateral')) {
      return {
        followUpEn: 'Counsel, what reasonable alternative weapon or tactics could the commander have deployed to minimize the civilian death toll here?',
        followUpZh: '代理人，指揮官當時能採用何種合理替代武器或戰術，以最大程度減少平民傷亡？'
      };
    }

    // Default follow-up from question or jurisprudential authority probe
    if (originalQuestion.followUp) {
      return {
        followUpEn: originalQuestion.followUp,
        followUpZh: originalQuestion.followUpZh || '請問您該主張的主要權威法理為何？'
      };
    }

    return {
      followUpEn: 'Counsel, what is your primary authority for that interpretation of international law?',
      followUpZh: '訴訟代理人，您對該國際法解釋的主要權威根據為何？'
    };
  }

  /**
   * Generates real-time simplified Chinese summary for spoken segments ("隨念隨摘").
   */
  public addChineseSummary(unitId: string, textEn: string): LiveChineseSummary {
    let summaryZh = '';
    const lower = textEn.toLowerCase();

    if (lower.includes('representing the applicant') || lower.includes('privilege to appear')) {
      summaryZh = '代理人向法院致意，代表申請方開庭，揭示本案核心爭點與申訴綱要。';
    } else if (lower.includes('article 2(4)') || lower.includes('prohibition of the use of force')) {
      summaryZh = '援引聯合國憲章第2(4)條，主張禁止武力威脅或使用之國際強行法規範。';
    } else if (lower.includes('effective control') || lower.includes('article 8')) {
      summaryZh = '主張民兵行動依ILC第8條可歸責於被申請方，援引尼加拉瓜案「實質控制」標準。';
    } else if (lower.includes('self-defence') || lower.includes('article 51')) {
      summaryZh = '主張依憲章第51條行使自衛權，強調迫切威脅與必要性、比例性原則。';
    } else if (lower.includes('proportionality') || lower.includes('additional protocol i')) {
      summaryZh = '主張空襲違反第一附加議定書比例原則，附帶平民傷亡過度於預期軍事利益。';
    } else if (lower.includes('distinction') || lower.includes('humanitarian')) {
      summaryZh = '強調人道救助車輛應受特別保護，交戰方未盡可行防範措施區分軍民目標。';
    } else {
      // General concise gloss extraction
      summaryZh = `論點摘要：陳述關於 ${textEn.slice(0, 40).replace(/[^a-zA-Z\s]/g, '')}... 之法律爭點與事實論述。`;
    }

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
