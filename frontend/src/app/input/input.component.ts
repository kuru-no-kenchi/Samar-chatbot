import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MessageService } from 'primeng/api';
import { VoiceRecognitionService } from '../services/voice-recognition.service';
import { LanguageService } from '../services/language.service';
import { Quota } from '../services/chat.service';

const MAX_MESSAGE_LENGTH = 4000; // same limit as the backend
const MAX_BOX_HEIGHT = 208; // about 8 lines, then the box scrolls

@Component({
  selector: 'app-input',
  templateUrl: './input.component.html',
  imports: [FormsModule, TranslateModule],
})
export class InputComponent implements OnDestroy {
  readonly maxLength = MAX_MESSAGE_LENGTH;
  recording = false;

  @Input() messageText = '';
  @Input() disabled = false; // true while a reply is loading
  @Input() quota: Quota | null = null;
  @Output() messageTextChange = new EventEmitter<string>();
  @Output() sendMessageEvent = new EventEmitter<string>();
  @ViewChild('box') private box?: ElementRef<HTMLTextAreaElement>;

  private voice = inject(VoiceRecognitionService);
  private language = inject(LanguageService);
  private messageService = inject(MessageService);
  readonly voiceSupported = this.voice.supported;

  ngOnDestroy(): void {
    if (this.recording) void this.voice.stop();
  }

  setText(value: string) {
    this.messageText = value;
    this.messageTextChange.emit(value);
    requestAnimationFrame(() => this.autosize());
  }

  private autosize() {
    const el = this.box?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_BOX_HEIGHT)}px`;
  }

  onEnter(event: Event) {
    const e = event as KeyboardEvent;
    if (e.shiftKey || e.isComposing) return; // Shift+Enter = new line
    e.preventDefault();
    this.sendMessage();
  }

  sendMessage() {
    const text = this.messageText.trim();
    if (!text || this.disabled || this.exhausted) return;
    this.sendMessageEvent.emit(text);
    this.setText('');
  }

  // Hold to talk
  startRecording() {
    if (this.recording || this.disabled || !this.voiceSupported) return;
    if (this.voice.start(this.language.speechLang)) this.recording = true;
  }

  get exhausted(): boolean {
    return !!this.quota && this.quota.remaining <= 0;
  }

  get resetTime(): string {
    return this.quota
      ? new Date(this.quota.resetsAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  }

  async stopRecording() {
    if (!this.recording) return; // pointerup and pointerleave can both fire
    this.recording = false;

    const heard = await this.voice.stop();
    if (heard) {
      // Goes into the box so the user can check it; they press send themselves
      this.setText(
        `${this.messageText} ${heard}`.trim().slice(0, MAX_MESSAGE_LENGTH),
      );
    } else if (this.voice.lastError === 'not-allowed') {
      this.messageService.add({
        severity: 'warn',
        summary: 'Microphone blocked',
        detail: 'Allow microphone access in your browser to use voice input.',
      });
    }
  }
}
