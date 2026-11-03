import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, map, tap } from 'rxjs';
import { AuthService } from './auth.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { API_URL } from '../app.config';

export interface ChatMessage {
  _id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export interface DiscussionSummary {
  _id: string;
  title?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface DiscussionListResponse {
  success: boolean;
  count: number;
  discussions: DiscussionSummary[];
}

export interface ChatPayload {
  message: string;
  discussionId?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export interface ChatResponse {
  success?: boolean;
  reply?: string;
  message?: string;
  discussion?: { _id: string; title?: string };
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private api = `${API_URL}/chat`;

  private activeId = new BehaviorSubject<string | null>(null);
  readonly activeDiscussion$ = this.activeId.asObservable();

  readonly discussions = signal<DiscussionSummary[]>([]);
  private activeIdSignal = toSignal(this.activeDiscussion$, {
    initialValue: null,
  });

  private listChanged = new Subject<void>();
  readonly discussionsChanged$ = this.listChanged.asObservable();

  constructor() {
    localStorage.removeItem('activeDiscussionId');
    effect(() => {
      if (this.auth.user() === null) {
        this.setActiveDiscussion(null);
        this.discussions.set([]);
      }
    });
  }

  readonly activeTitle = computed<string | null>(() => {
    const id = this.activeIdSignal();
    if (!id) return null;
    return this.discussions().find((d) => d._id === id)?.title ?? '';
  });

  getActiveDiscussionId(): string | null {
    return this.activeId.value;
  }

  setActiveDiscussion(id: string | null) {
    if (id === this.activeId.value) return; // no duplicate emits
    this.activeId.next(id);
  }

  startNewChat() {
    this.activeId.next(null);
  }

  sendChatMessage(payload: ChatPayload): Observable<ChatResponse> {
    const isNewChat = !payload.discussionId;
    return this.http.post<ChatResponse>(`${this.api}/new`, payload).pipe(
      tap((res) => {
        if (isNewChat && res.discussion) this.listChanged.next(); // new chat -> refresh sidebar
      }),
    );
  }

  getMessages(discussionId: string): Observable<ChatMessage[]> {
    return this.http
      .get<{
        success: boolean;
        messages: ChatMessage[];
      }>(`${this.api}/discussions/${discussionId}/messages`)
      .pipe(
        map((res) =>
          (res.messages ?? []).map((m) => ({
            ...m,
            timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          })),
        ),
      );
  }

  getDiscussions(): Observable<DiscussionListResponse> {
    return this.http
      .get<DiscussionListResponse>(`${this.api}/discussions`)
      .pipe(tap((res) => this.discussions.set(res.discussions ?? [])));
  }

  updateDiscussionTitle(discussionId: string, title: string) {
    return this.http
      .patch(`${this.api}/discussions/${discussionId}`, { title })
      .pipe(tap(() => this.listChanged.next()));
  }

  deleteDiscussion(discussionId: string) {
    return this.http.delete(`${this.api}/discussions/${discussionId}`).pipe(
      tap(() => {
        if (this.activeId.value === discussionId)
          this.setActiveDiscussion(null);
        this.listChanged.next();
      }),
    );
  }

  deleteAllDiscussions() {
    return this.http.delete(`${this.api}/discussions`).pipe(
      tap(() => {
        this.startNewChat();
        this.listChanged.next();
      }),
    );
  }
}
