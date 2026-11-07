import type { DebateData, BenchQuestion, OralUnit, Side, CounselSeat } from '../types';

export class DebateModel {
  private data: DebateData;

  constructor(initialData?: Partial<DebateData>) {
    this.data = {
      prosecutionQuestions: initialData?.prosecutionQuestions ?? this.defaultProsecutionQuestions(),
      defenseQuestions: initialData?.defenseQuestions ?? this.defaultDefenseQuestions(),
      prosecutionOral: initialData?.prosecutionOral ?? this.defaultProsecutionOral(),
      defenseOral: initialData?.defenseOral ?? this.defaultDefenseOral(),
      followUpExamples: initialData?.followUpExamples ?? [],
      matches: initialData?.matches ?? [],
      prep: initialData?.prep ?? {
        teamNumber: 'Team 42',
        factsSummary: 'Statement of Agreed Facts regarding extraterritorial airstrike and medical convoy incident in contested territory.',
        applicantMemorialOverview: 'Applicant submits that the State breached Article 2(4) of the UN Charter and customary international humanitarian law regarding target distinction and proportionality.',
        respondentMemorialOverview: 'Respondent contends the military operation complied with the law of self-defence under Article 51 and all reasonable precautions were taken.'
      }
    };
  }

  public getData(): DebateData {
    return this.data;
  }

  public updateData(newData: Partial<DebateData>): void {
    this.data = { ...this.data, ...newData };
  }

  public getQuestionsForSide(side: Side, seat?: CounselSeat): BenchQuestion[] {
    const list = side === 'prosecution' ? this.data.prosecutionQuestions : this.data.defenseQuestions;
    if (!seat) return list;
    return list.filter(q => !q.seat || q.seat === seat);
  }

  public getOralUnitsForSide(side: Side, seat?: CounselSeat): OralUnit[] {
    const list = side === 'prosecution' ? this.data.prosecutionOral : this.data.defenseOral;
    if (!seat) return list;
    return list.filter(u => !u.seat || u.seat === seat);
  }

  public findQuestionById(id: string): BenchQuestion | undefined {
    return [...this.data.prosecutionQuestions, ...this.data.defenseQuestions].find(q => q.id === id);
  }

  public findOralUnitById(id: string): OralUnit | undefined {
    return [...this.data.prosecutionOral, ...this.data.defenseOral].find(u => u.id === id);
  }

  private defaultProsecutionQuestions(): BenchQuestion[] {
    return [
      {
        id: 'P-01',
        title: 'Jurisdiction & Attribution under ILC Draft Articles',
        side: 'prosecution',
        category: 'Jurisdiction & Attribution',
        where: 'Opening statement / Attribution argument',
        whereZh: '開場陳述 / 歸責爭點段落',
        issue: 'State responsibility for paramilitary operations',
        questionEn: 'Counsel, what is your legal threshold for establishing effective control over the paramilitary group under Article 8 of the ILC Articles on State Responsibility?',
        questionZh: '訴訟代理人，依據國家責任條款第八條，您主張證明對民兵組織實質控制的具體法律門檻為何？',
        simplified: 'Threshold for effective control under Article 8.',
        followUp: 'If the Court applies the overall control test from Tadić rather than Nicaragua, does your claim of attribution still stand?',
        followUpZh: '若法院適用塔迪奇案的整體控制標準而非尼加拉瓜案標準，您的歸責主張是否依然成立？',
        structure: ['Cite ICJ Nicaragua and Bosnian Genocide precedents', 'Apply effective control vs overall control', 'Highlight direct operational planning instructions'],
        sampleEn: 'Mr. President, Members of the Court, under Article 8, the Applicant relies on the strict effective control standard established in Nicaragua and reaffirmed in Bosnian Genocide. The evidence clearly shows that the Respondent provided operational commands for each specific sortie.',
        sampleZh: '庭上，申請方依據尼加拉瓜案及波士尼亞種族滅絕案確立的實質控制標準，證據顯示被申請方對每次出擊均下達具體作戰指令。',
        seat: 1
      },
      {
        id: 'P-02',
        title: 'Proportionality in Airstrike Target Distinction',
        side: 'prosecution',
        category: 'IHL Targeting',
        where: 'Merits Count 2 - Aerial Bombardment',
        whereZh: '本案爭點二：空襲與目標區分',
        issue: 'Anticipated civilian harm vs concrete military advantage',
        questionEn: 'Counsel, did the commander undertake an adequate assessment of anticipated civilian casualties prior to launching the strike against the bridge convoy?',
        questionZh: '訴訟代理人，在對橋樑車隊發動空襲前，指揮官是否已對預期平民傷亡進行充分評估？',
        simplified: 'Did the commander assess civilian harm before targeting?',
        followUp: 'Does the presence of a dual-use communication node justify incidental destruction of an adjacent medical vehicle?',
        followUpZh: '軍民兩用通信節點之存在，能否合理化波及附隨醫療車輛的毀損？',
        structure: ['Article 57 of Additional Protocol I', 'Procautionary measures', 'Excessive collateral damage standard'],
        sampleEn: 'The rule of proportionality in Article 51(5)(b) of Additional Protocol I prohibits any attack expected to cause incidental loss of civilian life which would be excessive in relation to the concrete and direct military advantage anticipated.',
        sampleZh: '第一附加議定書第51條第5項(b)款明確禁止任何預期造成平民傷亡過當於具體直接軍事利益之攻擊。',
        seat: 2
      }
    ];
  }

  private defaultDefenseQuestions(): BenchQuestion[] {
    return [
      {
        id: 'D-01',
        title: 'Article 51 Inherent Right of Self-Defence',
        side: 'defense',
        category: 'Jus ad Bellum',
        where: 'Count 1 - Justification of Preemptive Action',
        whereZh: '爭點一：自衛權與先制行動之合法性',
        issue: 'Armed attack threshold and immediacy',
        questionEn: 'Counsel for the Respondent, how can you claim self-defence under Article 51 when no armed attack had yet crossed the border at the time of the missile launch?',
        questionZh: '被申請方代理人，在飛彈發射時尚未有武裝攻擊跨越邊界，您如何依聯合國憲章第51條主張自衛權？',
        simplified: 'How does self-defence apply before border crossing?',
        followUp: 'Is imminent armed attack sufficient under customary international law, and where is the state practice?',
        followUpZh: '習慣國際法中「迫在眉睫的武裝攻擊」是否足夠，您能指出哪些國家實踐？',
        structure: ['Caroline doctrine criteria', 'Accumulation of events theory', 'Necessity and immediacy requirements'],
        sampleEn: 'Your Excellencies, the Respondent acted pursuant to the inherent right of self-defence under Article 51 of the UN Charter, informed by the Caroline doctrine, in response to an instantaneous and overwhelming threat.',
        sampleZh: '庭上，被申請方係依聯合國憲章第51條固有之自衛權行使，結合卡羅琳案標準，針對即時且壓倒性之迫切威脅採取必要行動。',
        seat: 1
      }
    ];
  }

  private defaultProsecutionOral(): OralUnit[] {
    return [
      {
        id: 'PO-01',
        side: 'prosecution',
        speaker: 'Counsel Yang',
        speakerId: 'yang',
        section: 'Introduction & Roadmap',
        textEn: 'Mr. President, Members of the Court, it is my privilege to appear before you today representing the Applicant. This case touches upon fundamental principles of international order: the prohibition of the use of force under Article 2(4) of the United Nations Charter, and the inviolable protections afforded to humanitarian personnel under customary international humanitarian law. Today, my co-counsel and I will present two main submissions. First, the Respondent violated international law through unauthorized cross-border military incursions. Second, the aerial bombardment conducted on October 14th breached the fundamental principles of distinction and proportionality.',
        notesZh: '開場陳述：代表申請方出席，提出聯合國憲章第2條第4項禁止使用武力原則，以及人道救助人員保護。分為兩大論點：越境軍事入侵違法，以及10月14日空襲違反目標區分與比例原則。',
        qa: ['P-01'],
        seat: 1
      },
      {
        id: 'PO-02',
        side: 'prosecution',
        speaker: 'Counsel Yang',
        speakerId: 'yang',
        section: 'Count 1: State Responsibility & Attribution',
        textEn: 'Turning to our first submission, the actions of the Blue Brigade paramilitary force are directly attributable to the Respondent under Article 8 of the International Law Commission Draft Articles on State Responsibility. As established in the seminal Nicaragua judgment and reaffirmed by this Court in the Bosnian Genocide case, conduct is attributable to a State if the group acted under the effective control of that State. Here, the record demonstrates unequivocal operational command, continuous logistical provisioning, and tactical instruction issued directly from the Respondent Ministry of Defence.',
        notesZh: '第一爭點：民兵武裝行動依ILC國家責任條款第8條可歸責於被申請方。援引尼加拉瓜案與波士尼亞種族滅絕案之實質控制標準，記錄顯示國防部直接指揮補給。',
        qa: ['P-01'],
        seat: 1
      },
      {
        id: 'PO-03',
        side: 'prosecution',
        speaker: 'Counsel Chen',
        speakerId: 'chen',
        section: 'Count 2: Breach of Distinction & Proportionality',
        textEn: 'May it please the Court, I shall address the second submission regarding the aerial bombardment of the bridge convoy. Under Article 57 of Additional Protocol I, which reflects customary international law, belligerents must do everything feasible to verify that targets are military objectives. In this instance, the commander possessed clear intelligence that a marked humanitarian relief vehicle had joined the convoy. Despite this knowledge, guided munitions were deployed without delay or verification, inflicting excessive civilian harm that far outweighed any anticipated military advantage.',
        notesZh: '第二爭點：橋樑空襲違反第一附加議定書第57條可行防範措施。指揮官已知悉有人道救援車輛混入車隊，仍未經核實發射導引飛彈，違反比例原則。',
        qa: ['P-02'],
        seat: 2
      }
    ];
  }

  private defaultDefenseOral(): OralUnit[] {
    return [
      {
        id: 'DO-01',
        side: 'defense',
        speaker: 'Counsel Wang',
        speakerId: 'yang',
        section: 'Introduction & Self-Defence Plea',
        textEn: 'Mr. President, Members of the Court, the Respondent asks this Chamber to evaluate the events of this dispute within their true factual and strategic context. The Respondent faced an imminent, coordinated armed assault orchestrated from across the border. Under Article 51 of the Charter of the United Nations, nothing shall impair the inherent right of individual or collective self-defence when confronted with an armed attack. Our response was strictly necessary, scrupulously proportionate, and executed only after all peaceful diplomatic avenues had been systematically exhausted.',
        notesZh: '被申請方開場：強調面臨迫在眉睫的跨界武裝攻擊，依聯合國憲章第51條行使自衛權，合乎必要性與比例性要求。',
        qa: ['D-01'],
        seat: 1
      }
    ];
  }
}
