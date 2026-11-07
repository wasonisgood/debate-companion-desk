import type { RoadmapNode } from '../types';
import { ArgumentRoadmapModel } from '../models/ArgumentRoadmapModel';

export interface RoadmapViewCallbacks {
  onSelectNode: (nodeId: string) => void;
}

export class RoadmapView {
  private container: HTMLElement;
  private model: ArgumentRoadmapModel;
  private callbacks: RoadmapViewCallbacks;

  constructor(container: HTMLElement, model: ArgumentRoadmapModel, callbacks: RoadmapViewCallbacks) {
    this.container = container;
    this.model = model;
    this.callbacks = callbacks;
    this.render();
  }

  public setModel(model: ArgumentRoadmapModel): void {
    this.model = model;
    this.render();
  }

  public render(): void {
    const nodes = this.model.getNodes();
    const progress = this.model.getProgressPercentage();

    this.container.innerHTML = `
      <div class="col-roadmap">
        <div class="panel-header">
          <div class="panel-title">
            <span>🗺 辯論爭點架構圖</span>
            <span class="badge badge-ainezu">${progress}%</span>
          </div>
          <span class="badge">${nodes.length} 個論點階段</span>
        </div>

        <div class="panel-body roadmap-container">
          ${nodes.map((node, idx) => `
            <div class="roadmap-node ${node.status}" data-node-id="${node.id}">
              <div class="node-header">
                <span class="node-tag">節點 ${idx + 1} · ${node.speaker}</span>
                <span class="badge ${this.statusBadgeClass(node.status)}">${this.statusLabel(node.status)}</span>
              </div>
              <div class="node-title">${node.title}</div>
              <div class="node-title-zh">${node.titleZh}</div>

              <div class="node-meta">
                ${node.questionIds.map(qid => `
                  <span class="node-pill-question has-pending" title="關聯題目">
                    ❓ ${qid}
                  </span>
                `).join('')}
              </div>
            </div>
            ${idx < nodes.length - 1 ? `<div class="roadmap-connector ${node.status === 'completed' ? 'active' : ''}"></div>` : ''}
          `).join('')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const nodeEls = this.container.querySelectorAll('.roadmap-node');
    nodeEls.forEach(el => {
      el.addEventListener('click', () => {
        const nodeId = el.getAttribute('data-node-id');
        if (nodeId) {
          this.callbacks.onSelectNode(nodeId);
        }
      });
    });
  }

  private statusBadgeClass(status: string): string {
    switch (status) {
      case 'active': return 'badge-shu';
      case 'completed': return 'badge-koke';
      case 'interrupted': return 'badge-ainezu';
      default: return '';
    }
  }

  private statusLabel(status: string): string {
    switch (status) {
      case 'active': return '● 朗讀進行中';
      case 'completed': return '✓ 已完成';
      case 'interrupted': return '⚡ 提問中斷點';
      default: return '等待中';
    }
  }
}
