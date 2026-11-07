import { Icons } from './icons';

export interface FloatingBallCallbacks {
  onExpandWindow: () => void;
  onToggleTimer: () => void;
  onTagCoachFeedback: () => void;
  onOpenSettings: () => void;
  onTriggerRandomQuestion: () => void;
  onOpenTTSDrill: () => void;
}

export class FloatingBallView {
  private container: HTMLElement;
  private callbacks: FloatingBallCallbacks;
  private isMenuOpen: boolean = false;
  private isDragging: boolean = false;
  private startPointerX: number = 0;
  private startPointerY: number = 0;
  private startElemX: number = 0;
  private startElemY: number = 0;
  private hasMoved: boolean = false;

  private currentRemainingSec: number = 900;
  private isCurrentlyRecording: boolean = false;

  constructor(container: HTMLElement, callbacks: FloatingBallCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  public render(): void {
    this.container.id = 'floating-ball-widget';
    this.container.innerHTML = `
      <div class="floating-ball-inner" id="fb-trigger" title="點擊展開陪伴快捷功能，拖曳可自訂位置">
        <span class="floating-ball-icon" id="fb-icon">
          ${Icons.scales('', 20)}
        </span>
        <span class="floating-ball-timer" id="fb-timer">15:00</span>
      </div>

      <div class="floating-quick-menu" id="fb-quick-menu">
        <div class="quick-menu-header">
          <span class="app-seal" style="width: 18px; height: 18px; font-size: 0.68rem;">辯</span>
          <span>陪伴台帳懸浮捷徑</span>
        </div>
        <button class="quick-menu-item" id="fb-action-expand" type="button">
          ${Icons.expand('', 14)}
          <span>展開主工作區</span>
        </button>
        <button class="quick-menu-item" id="fb-action-timer" type="button">
          ${Icons.timer('', 14)}
          <span>暫停 / 繼續計時</span>
        </button>
        <button class="quick-menu-item" id="fb-action-feedback" type="button">
          ${Icons.tag('', 14)}
          <span>標記老師講評段落</span>
        </button>
        <button class="quick-menu-item" id="fb-action-tts" type="button">
          ${Icons.speaker('', 14)}
          <span>發音朗讀小幫手</span>
        </button>
        <button class="quick-menu-item" id="fb-action-question" type="button">
          ${Icons.zap('', 14)}
          <span>即時提問提示</span>
        </button>
        <button class="quick-menu-item" id="fb-action-settings" type="button">
          ${Icons.settings('', 14)}
          <span>偏好設定</span>
        </button>
      </div>
    `;

    this.bindEvents();
  }

  public updateState(remainingSec: number, isRecording: boolean, hasSync: boolean): void {
    this.currentRemainingSec = remainingSec;
    this.isCurrentlyRecording = isRecording;

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
    const trigger = this.container.querySelector('#fb-trigger');
    trigger?.addEventListener('click', (e) => {
      if (this.hasMoved) return; // Prevent menu toggle if user was dragging
      e.stopPropagation();
      this.toggleMenu();
    });

    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!this.container.contains(target)) {
        this.closeMenu();
      }
    });

    // Quick action buttons
    this.container.querySelector('#fb-action-expand')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.callbacks.onExpandWindow();
    });

    this.container.querySelector('#fb-action-timer')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onToggleTimer();
    });

    this.container.querySelector('#fb-action-feedback')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.callbacks.onTagCoachFeedback();
    });

    this.container.querySelector('#fb-action-tts')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.callbacks.onOpenTTSDrill();
    });

    this.container.querySelector('#fb-action-question')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.callbacks.onTriggerRandomQuestion();
    });

    this.container.querySelector('#fb-action-settings')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.callbacks.onOpenSettings();
    });

    this.setupDragging();
  }

  public toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
    const menu = this.container.querySelector('#fb-quick-menu');
    if (this.isMenuOpen) {
      menu?.classList.add('open');
    } else {
      menu?.classList.remove('open');
    }
  }

  public closeMenu(): void {
    this.isMenuOpen = false;
    this.container.querySelector('#fb-quick-menu')?.classList.remove('open');
  }

  private setupDragging(): void {
    const trigger = this.container.querySelector('#fb-trigger') as HTMLElement;
    if (!trigger) return;

    const onPointerDown = (clientX: number, clientY: number) => {
      this.isDragging = true;
      this.hasMoved = false;
      this.startPointerX = clientX;
      this.startPointerY = clientY;

      const rect = this.container.getBoundingClientRect();
      this.startElemX = rect.left;
      this.startElemY = rect.top;
    };

    const onPointerMove = (clientX: number, clientY: number) => {
      if (!this.isDragging) return;
      const dx = clientX - this.startPointerX;
      const dy = clientY - this.startPointerY;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        this.hasMoved = true;
      }

      if (this.hasMoved) {
        const nextX = Math.max(12, Math.min(window.innerWidth - 72, this.startElemX + dx));
        const nextY = Math.max(48, Math.min(window.innerHeight - 72, this.startElemY + dy));

        this.container.style.left = `${nextX}px`;
        this.container.style.top = `${nextY}px`;
        this.container.style.bottom = 'auto';
        this.container.style.right = 'auto';
      }
    };

    const onPointerUp = () => {
      this.isDragging = false;
    };

    trigger.addEventListener('mousedown', (e) => {
      if (e.button === 0) onPointerDown(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      onPointerMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', onPointerUp);

    // Touch support
    trigger.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchend', onPointerUp);
  }
}
