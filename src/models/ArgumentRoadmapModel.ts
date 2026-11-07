import type { RoadmapNode, OralUnit, BenchQuestion, Side, CounselSeat } from '../types';

export class ArgumentRoadmapModel {
  private nodes: RoadmapNode[] = [];
  private activeNodeId: string | null = null;

  constructor(oralUnits: OralUnit[], questions: BenchQuestion[]) {
    this.buildFromUnits(oralUnits, questions);
  }

  public buildFromUnits(oralUnits: OralUnit[], questions: BenchQuestion[]): void {
    this.nodes = oralUnits.map((u, idx) => {
      // Find questions linked to this section or qa
      const linkedQuestions = questions.filter(
        q => (u.qa && u.qa.includes(q.id)) || q.where.toLowerCase().includes(u.section.toLowerCase())
      );

      return {
        id: u.id,
        title: u.section,
        titleZh: u.notesZh.split('：')[0] || u.notesZh.slice(0, 20),
        section: u.section,
        side: u.side,
        speaker: u.speaker,
        status: idx === 0 ? 'active' : 'pending',
        keyIssues: linkedQuestions.map(q => q.issue),
        questionIds: linkedQuestions.map(q => q.id),
        oralUnitId: u.id,
        order: idx
      };
    });

    if (this.nodes.length > 0) {
      this.activeNodeId = this.nodes[0].id;
    }
  }

  public getNodes(): RoadmapNode[] {
    return this.nodes;
  }

  public getActiveNode(): RoadmapNode | undefined {
    return this.nodes.find(n => n.id === this.activeNodeId);
  }

  public setActiveNode(nodeId: string): void {
    let found = false;
    for (const node of this.nodes) {
      if (node.id === nodeId) {
        node.status = 'active';
        this.activeNodeId = nodeId;
        found = true;
      } else if (!found) {
        node.status = 'completed';
      } else {
        node.status = 'pending';
      }
    }
  }

  public markNodeInterrupted(nodeId: string): void {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      node.status = 'interrupted';
    }
  }

  public advanceToNextNode(): RoadmapNode | null {
    const currentIndex = this.nodes.findIndex(n => n.id === this.activeNodeId);
    if (currentIndex >= 0 && currentIndex < this.nodes.length - 1) {
      this.nodes[currentIndex].status = 'completed';
      const nextNode = this.nodes[currentIndex + 1];
      nextNode.status = 'active';
      this.activeNodeId = nextNode.id;
      return nextNode;
    }
    return null;
  }

  public getProgressPercentage(): number {
    if (this.nodes.length === 0) return 0;
    const completedCount = this.nodes.filter(n => n.status === 'completed').length;
    const activeBonus = this.nodes.some(n => n.status === 'active') ? 0.5 : 0;
    return Math.min(100, Math.round(((completedCount + activeBonus) / this.nodes.length) * 100));
  }
}
