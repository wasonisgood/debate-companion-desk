export interface TouchGestureCallbacks {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
  onSwipeUp?: () => void;
  onLongPress?: (x: number, y: number) => void;
  onDoubleTap?: (x: number, y: number) => void;
}

export class TouchGestureManager {
  private element: HTMLElement;
  private callbacks: TouchGestureCallbacks;
  private startX: number = 0;
  private startY: number = 0;
  private startTime: number = 0;
  private longPressTimeout: any = null;
  private lastTapTime: number = 0;

  constructor(element: HTMLElement, callbacks: TouchGestureCallbacks) {
    this.element = element;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.element.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        this.startX = touch.clientX;
        this.startY = touch.clientY;
        this.startTime = Date.now();

        this.triggerRipple(touch.clientX, touch.clientY);

        // Long press detection (500ms)
        this.longPressTimeout = setTimeout(() => {
          if (this.callbacks.onLongPress) {
            this.callbacks.onLongPress(this.startX, this.startY);
          }
        }, 500);
      }
    }, { passive: true });

    this.element.addEventListener('touchmove', (e: TouchEvent) => {
      // Cancel long press if user moves significantly
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - this.startX);
        const dy = Math.abs(touch.clientY - this.startY);
        if (dx > 10 || dy > 10) {
          clearTimeout(this.longPressTimeout);
        }
      }
    }, { passive: true });

    this.element.addEventListener('touchend', (e: TouchEvent) => {
      clearTimeout(this.longPressTimeout);

      const endTime = Date.now();
      const elapsed = endTime - this.startTime;

      if (e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - this.startX;
        const dy = touch.clientY - this.startY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        // Double tap detection (< 300ms between taps)
        if (absX < 15 && absY < 15 && elapsed < 250) {
          const now = Date.now();
          if (now - this.lastTapTime < 300) {
            if (this.callbacks.onDoubleTap) {
              this.callbacks.onDoubleTap(touch.clientX, touch.clientY);
            }
          }
          this.lastTapTime = now;
        }

        // Swipe detection (threshold 50px within 400ms)
        if (elapsed < 400) {
          if (absX > 50 && absX > absY * 1.5) {
            if (dx < 0 && this.callbacks.onSwipeLeft) {
              this.callbacks.onSwipeLeft();
            } else if (dx > 0 && this.callbacks.onSwipeRight) {
              this.callbacks.onSwipeRight();
            }
          } else if (absY > 50 && absY > absX * 1.5) {
            if (dy > 0 && this.callbacks.onSwipeDown) {
              this.callbacks.onSwipeDown();
            } else if (dy < 0 && this.callbacks.onSwipeUp) {
              this.callbacks.onSwipeUp();
            }
          }
        }
      }
    }, { passive: true });
  }

  private triggerRipple(x: number, y: number): void {
    const ripple = document.createElement('div');
    ripple.className = 'touch-ripple';
    ripple.style.left = `${x - 20}px`;
    ripple.style.top = `${y - 20}px`;
    ripple.style.width = '40px';
    ripple.style.height = '40px';
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }
}
