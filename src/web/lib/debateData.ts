/**
 * Auto-generated Debate Practice Module dataset from official Moot Court documents.
 */

export interface BenchQuestion {
  id: string;
  title: string;
  side: 'prosecution' | 'defense';
  category: string;
  where: string;
  whereZh: string;
  issue: string;
  questionEn: string;
  questionZh: string;
  simplified?: string;
  followUp?: string;
  followUpZh?: string;
  structure: string[];
  sampleEn: string;
  sampleZh: string;
  /** Which counsel answers this question; absent = derived from script markers / keywords. */
  seat?: 1 | 2;
  /** Set when the question was prepared for a specific match (對戰準備). */
  match?: string;
}

export interface OralUnit {
  id: string;
  side: 'prosecution' | 'defense';
  speaker: string;
  speakerId: 'yang' | 'chen';
  section: string;
  textEn: string;
  notesZh: string;
  qa?: string[];
  /** Explicit seat chosen in the editor; absent = derived from the section. */
  seat?: 1 | 2;
}

export interface FollowUpExample {
  title: string;
  side: 'prosecution' | 'defense';
  speaker: string;
  dialogue: { role: 'judge' | 'counsel'; text: string }[];
}

