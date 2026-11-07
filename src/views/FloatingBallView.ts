export interface FloatingBallCallbacks {
  onExpandWindow: () => void;
  onToggleTimer: () => void;
  onTagCoachFeedback: () => void;
  onOpenSettings: () => void;
  onTriggerRandomQuestion: () => void;
}

export class FloatingBallView {
  private container: HTMLElement;
  private callbacks: FloatingBallCallbacks;
  private isMenuOpen: boolean = false;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private posX: number = 24;
  private posY: number = 24;

  constructor(container: HTMLElement, callbacks: FloatingBallCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  public render(): void {
    this.container.id = 'floating-ball-widget';
    this.container.innerHTML = `
      <div class="floating-ball-inner">
        <span class="floating-ball-icon" id="fb-icon">⚖</span>
        <span class="floating-ball-timer" id="fb-timer">15:00</span>
      </div>

      <div class="floating-quick-menu" id="fb-quick-menu">
        <div style="font-size: 0.72rem; font-weight: bold; color: var(--ink-3); margin-bottom: 2px;">
          陪伴台帳懸浮捷徑
        </div>
        <button class="quick-menu-item" id="fb-action-expand">
          <span>⤢</span> 展開主視窗
        </button>
        <button class="quick-menu-item" id="fb-action-timer">
          <span>⏱</span> 暫停 / 繼續計時
        </button>
        <button class="quick-menu-item" id="fb-action-feedback">
          <span>🎙</span> 標記老師講評段落
        </button>
        <button class="quick-menu-item" id="fb-action-question">
          <span>⚡</span> 即時發起提問
        </button>
        <button class="quick-menu-item" id="fb-action-settings">
          <span>⚙</span> 快速偏好設定
        </button>
      </div>
    `;

    this.bindEvents();
  }

  public updateState(remainingSec: number, isRecording: boolean, hasSync: boolean): void {
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    const clock = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const timerEl = this.container.querySelector('#fb-timer');
    if (timerEl) timerEl.textContent = clock;

    if (isRecording) {
      this.container.classList.add('recording');
    } else {
      this.container.classList.remove('recording');
    }
  }

  public triggerAlert(): void {
    this.container.classList.add('alert-trigger');
    setTimeout(() => {
      this.container.classList.remove('alert-trigger');
    }, 4000);
  }

  private bindEvents(): void {
    // Click or tap to toggle radial quick menu
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.quick-menu-item')) return;
      this.toggleMenu();
    });

    const menu = this.container.querySelector('#fb-quick-menu');

    this.container.querySelector('#fb-action-expand')?.addEventListener('click', () => {
      this.closeMenu();
      this.callbacks.onExpandWindow();
    });

    this.container.querySelector('#fb-action-timer')?.addEventListener('click', () => {
      this.callbacks.onToggleTimer();
    });

    this.container.querySelector('#fb-action-feedback')?.addEventListener('click', () => {
      this.closeMenu();
      this.callbacks.onTagCoachFeedback();
    });

    this.container.querySelector('#fb-action-question')?.addEventListener('click', () => {
      this.closeMenu();
      this.callbacks.onTriggerRandomQuestion();
    });

    this.container.querySelector('#fb-action-settings')?.addEventListener('click', () => {
      this.closeMenu();
      this.callbacks.onOpenSettings();
    });

    // Touch & Mouse Dragging implementation
    this.setupDragging();
  }

  private toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
    const menu = this.container.querySelector('#fb-quick-menu');
    if (this.isMenuOpen) {
      menu?.classList.add('open');
    } else {
      menu?.classList.remove('open');
    }
  }

  private closeMenu(): void {
    this.isMenuOpen = false;
    this.container.querySelector('#fb-quick-menu')?.classList.remove('open');
  }

  private setupDragging(): void {
    const onStart = (clientX: number, clientY: number) => {
      this.isDragging = true;
      this.dragStartX = clientX - this.container.offsetLeft;
      this.dragStartY = clientY - this.container.offsetTop;
    };

    const onMove = (clientX: number, clientY: number) => {
      if (!this.isDragging) return;
      const left = clientX - this.dragStartX;
      const top = clientY - this.dragStartY;
      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
      this.container.style.bottom = 'auto';
      this.container.style.right = 'auto';
    };

    const onEnd = () => {
      this.isDragging = false;
    };

    this.container.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);

    this.container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        onStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchend', onEnd);
  }
}
