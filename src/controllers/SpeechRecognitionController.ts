export type TranscriptCallback = (transcript: string, isFinal: boolean) => void;

export class SpeechRecognitionController {
  private recognition: any = null;
  private isListening: boolean = false;
  private subscribers: Set<TranscriptCallback> = new Set();
  private mockInterval: any = null;

  constructor() {
    this.initRecognition();
  }

  private initRecognition(): void {
    if (typeof window !== 'undefined') {
      const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionClass) {
        this.recognition = new SpeechRecognitionClass();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const piece = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += piece;
            } else {
              interimTranscript += piece;
            }
          }

          const currentText = (finalTranscript || interimTranscript).trim();
          if (currentText) {
            this.broadcast(currentText, !!finalTranscript);
          }
        };

        this.recognition.onerror = () => {
          // Restart if still marked listening
          if (this.isListening) {
            setTimeout(() => {
              try { this.recognition.start(); } catch (_) {}
            }, 500);
          }
        };

        this.recognition.onend = () => {
          if (this.isListening) {
            setTimeout(() => {
              try { this.recognition.start(); } catch (_) {}
            }, 300);
          }
        };
      }
    }
  }

  public subscribe(cb: TranscriptCallback): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  public start(): boolean {
    if (this.isListening) return true;
    this.isListening = true;

    if (this.recognition) {
      try {
        this.recognition.start();
        return true;
      } catch (_) {}
    }
    return false;
  }

  public stop(): void {
    this.isListening = false;
    if (this.mockInterval) {
      clearInterval(this.mockInterval);
      this.mockInterval = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (_) {}
    }
  }

  /**
   * For automated testing or offline simulation: feeds words sequentially
   */
  public simulateDebateSpeech(fullText: string, speedMs: number = 200, onComplete?: () => void): void {
    this.isListening = true;
    const words = fullText.split(/\s+/);
    let index = 0;
    let accumulated = '';

    if (this.mockInterval) clearInterval(this.mockInterval);

    this.mockInterval = setInterval(() => {
      if (index >= words.length) {
        clearInterval(this.mockInterval);
        this.mockInterval = null;
        if (onComplete) onComplete();
        return;
      }

      accumulated += (accumulated ? ' ' : '') + words[index];
      this.broadcast(accumulated, index % 6 === 0 || index === words.length - 1);
      index++;
    }, speedMs);
  }

  private broadcast(transcript: string, isFinal: boolean): void {
    this.subscribers.forEach(cb => {
      try { cb(transcript, isFinal); } catch (_) {}
    });
  }
}
