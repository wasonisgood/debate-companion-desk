import { TTSController, LEGAL_LATIN_GLOSSARY, type PronunciationGloss } from '../controllers/TTSController';

export interface TTSDrillCallbacks {
  onConfirmAsk: (text: string) => void;
  onClose: () => void;
}

export class TTSDrillModalView {
  private container: HTMLElement;
  private ttsController: TTSController;
  private callbacks: TTSDrillCallbacks;
  private currentText: string = '';
  private practiceCount: number = 0;
  private currentRate: number = 1.0;

  constructor(container: HTMLElement, ttsController: TTSController, callbacks: TTSDrillCallbacks) {
    this.container = container;
    this.ttsController = ttsController;
    this.callbacks = callbacks;
  }

  public open(text: string): void {
    this.currentText = text;
    this.practiceCount = 0;
    this.render();
    this.container.style.display = 'flex';
  }

  public close(): void {
    this.ttsController.stop();
    this.container.style.display = 'none';
    this.callbacks.onClose();
  }

  private render(): void {
    const glosses = this.ttsController.getGlossaryForText(this.currentText);

    this.container.innerHTML = `
      <div class="modal-backdrop" style="position: fixed; inset: 0; background: rgba(29, 27, 23, 0.6); backdrop-filter: blur(4px); z-index: 10001; display: flex; align-items: center; justify-content: center; padding: 1rem;">
        <div class="modal-card card" style="width: 540px; max-width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-lg); background: var(--paper);">
          <div class="card-header">
            <div class="card-title">
              <span>🔊 研究員發音練習朗讀小幫手</span>
            </div>
            <button class="btn btn-outline" id="btn-modal-close" style="min-height: 28px; padding: 0.2rem 0.5rem;" type="button">✕</button>
          </div>

          <div style="font-size: 0.85rem; color: var(--ink-2); margin-bottom: 0.8rem; line-height: 1.5;">
            在向辯士提問前，您可以先點擊朗讀聆聽法官標準語調與重音節奏，或自行跟讀練習：
          </div>

          <div class="card" style="background: var(--paper-2); border-left: 4px solid var(--shu); padding: 1rem; margin-bottom: 1rem;">
            <div style="font-family: var(--latin); font-size: 1.15rem; line-height: 1.6; color: var(--ink);">
              "${this.currentText}"
            </div>
          </div>

          <!-- Pronunciation Glosses -->
          ${glosses.length > 0 ? `
            <div style="margin-bottom: 1rem;">
              <div style="font-size: 0.78rem; font-weight: bold; color: var(--shu-ink); margin-bottom: 0.4rem;">
                📌 本題關鍵拉丁法學專有名詞讀音解析：
              </div>
              <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                ${glosses.map(g => `
                  <div style="padding: 0.4rem 0.6rem; background: var(--paper-3); border-radius: var(--radius); font-size: 0.82rem; display: flex; justify-content: space-between;">
                    <span style="font-weight: bold; font-family: var(--latin);">${g.term}</span>
                    <span style="color: var(--shu-ink); font-family: var(--mono);">${g.phonetic}</span>
                    <span style="color: var(--ink-2);">${g.meaningZh}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Speed Toggles & Playback Controls -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.2rem; flex-wrap: wrap; gap: 0.5rem;">
            <div class="pills">
              <button class="pill-item ${this.currentRate === 0.8 ? 'active' : ''}" data-rate="0.8" type="button">0.8x 慢速</button>
              <button class="pill-item ${this.currentRate === 1.0 ? 'active' : ''}" data-rate="1.0" type="button">1.0x 標準</button>
              <button class="pill-item ${this.currentRate === 1.2 ? 'active' : ''}" data-rate="1.2" type="button">1.2x 實戰</button>
            </div>

            <div style="font-size: 0.8rem; font-family: var(--mono); color: var(--ink-3);" id="practice-counter">
              已練習 ${this.practiceCount} 次
            </div>
          </div>

          <div style="display: flex; gap: 0.8rem;">
            <button class="btn btn-outline btn-touch" id="btn-play-tts" style="flex: 1;">
              ▶ 播放朗讀示範
            </button>
            <button class="btn btn-primary btn-touch" id="btn-confirm-ask" style="flex: 1;">
              ✓ 我已熟練，立即提問
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#btn-modal-close')?.addEventListener('click', () => this.close());

    // Rate switcher
    this.container.querySelectorAll('.pill-item[data-rate]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rate = parseFloat(btn.getAttribute('data-rate') || '1.0');
        this.currentRate = rate;
        this.container.querySelectorAll('.pill-item[data-rate]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    this.container.querySelector('#btn-play-tts')?.addEventListener('click', () => {
      this.practiceCount++;
      const counter = this.container.querySelector('#practice-counter');
      if (counter) counter.textContent = `已練習 ${this.practiceCount} 次`;
      this.ttsController.speak(this.currentText, this.currentRate);
    });

    this.container.querySelector('#btn-confirm-ask')?.addEventListener('click', () => {
      this.callbacks.onConfirmAsk(this.currentText);
      this.close();
    });
  }
}
