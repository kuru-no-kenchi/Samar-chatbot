import {
  Component, ElementRef, ViewChild, AfterViewChecked, OnInit, OnDestroy, DestroyRef, inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MessageService } from 'primeng/api';
import { ChatMessage, ChatService } from '../services/chat.service';
import { InputComponent } from '../input/input.component';
import { ProfileService } from '../services/profile.service';
import { TtsService } from '../services/tts.service';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY = 20;

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [InputComponent, TranslateModule],
  templateUrl: './chat.component.html',
})
export class ChatComponent implements AfterViewChecked, OnInit, OnDestroy {
  messages: ChatMessage[] = [];
  newMessage = '';
  discussionId: string | null = null;
  isLoading = false;
  copiedIndex: number | null = null;

  readonly suggestions = ['SUGGESTION_TRIP', 'SUGGESTION_EXPLAIN', 'SUGGESTION_EMAIL'];

  private shouldScroll = false;
  private destroyRef = inject(DestroyRef);
  private chatService = inject(ChatService);
  readonly quota = this.chatService.quota;
  private messageService = inject(MessageService);
  private translate = inject(TranslateService);
  private profile = inject(ProfileService);
  readonly tts = inject(TtsService);

  @ViewChild('chatContainer') private chatContainer?: ElementRef<HTMLElement>;

  get isEmpty(): boolean {
    return this.messages.length === 0;
  }

  ngOnInit() {
    this.chatService.activeDiscussion$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => {
        if (id) {
          if (id !== this.discussionId) this.loadMessages(id);
        } else {
          this.resetChat();
        }
      });
  }

  ngOnDestroy() {
    this.tts.stop();
  }

  private resetChat() {
    this.tts.stop();
    this.messages = [];
    this.discussionId = null;
    this.newMessage = '';
  }

  loadMessages(discussionId: string) {
    this.chatService.getMessages(discussionId).subscribe({
      next: (messages) => {
        this.tts.stop();
        this.messages = messages;
        this.discussionId = discussionId;
        this.shouldScroll = true;
      },
      error: (err) => this.showError('Could not load this conversation.', err),
    });
  }

  useSuggestion(key: string) {
    this.sendMessage(this.translate.instant(key));
  }

  sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || this.isLoading) return;

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Message too long',
        detail: `Please keep it under ${MAX_MESSAGE_LENGTH} characters.`,
      });
      return;
    }

    // With history disabled the server stores nothing, so we send the context ourselves
    const history = this.profile.historyEnabled()
      ? undefined
      : this.messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));

    this.messages = [...this.messages, { role: 'user', content: trimmed, timestamp: new Date() }];
    this.newMessage = '';
    this.isLoading = true;
    this.shouldScroll = true;

    this.chatService
      .sendChatMessage({ message: trimmed, discussionId: this.discussionId ?? undefined, history })
      .subscribe({
        next: (response) => {
          if (response.reply) {
            this.messages = [...this.messages, { role: 'assistant', content: response.reply, timestamp: new Date() }];
          }
          if (response.discussion?._id && !this.discussionId) {
            this.discussionId = response.discussion._id;
            this.chatService.setActiveDiscussion(response.discussion._id);
          }
          this.isLoading = false;
          this.shouldScroll = true;
        },
        error: (err) => {
          this.isLoading = false;
          this.showError(this.errorText(err), err);
        },
      });
  }

  async copy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      this.copiedIndex = index;
      setTimeout(() => (this.copiedIndex = null), 1500);
    } catch {
      this.messageService.add({
        severity: 'warn',
        summary: 'Copy failed',
        detail: 'Your browser blocked clipboard access.',
      });
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      const el = this.chatContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  private errorText(err: any): string {
    if (err.status === 0) return 'Cannot reach the server. Check your connection.';
    if (err.status === 429) return err.error?.error ?? 'Too many messages. Please wait a moment.';
    if (err.status === 502) return 'The assistant is unavailable right now. Please try again.';
    return err.error?.error ?? 'Something went wrong.';
  }

  private showError(detail: string, err: any) {
    console.error('Chat error:', err?.status);
    this.messageService.add({ severity: 'error', summary: 'Error', detail });
  }
}