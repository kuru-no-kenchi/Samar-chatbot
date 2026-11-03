import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../app.config';
import { AuthService } from './auth.service';


export interface UserProfile {
  first_name: string;
  last_name: string;
  email: string;
  selectedBot?: string;
  personal_photo?: string;
  preferences?: {
    language?: string;
    darkTheme?: boolean;
    conversationHistory?: boolean;
  };
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  readonly profile = signal<UserProfile | null>(null);

  readonly photoUrl = computed(() => {
    const stored = this.profile()?.personal_photo;
    if (!stored) return '';
    const name = stored.split(/[\\/]/).pop(); // also copes with old "users_photos/x.png" values
    return `${API_URL}/users_photos/${name}`;
  });

  readonly historyEnabled = computed(
    () => this.profile()?.preferences?.conversationHistory ?? true,
  );

  // Only changes when someone logs in or out (or changes email), not on every token refresh
  private email = computed(() => this.auth.user()?.email ?? null);

  constructor() {
    effect(() => {
      if (this.email()) untracked(() => this.load());
      else this.profile.set(null);
    });
  }

  // Local update after a successful save, so no extra request is needed
  setPreferences(prefs: Partial<NonNullable<UserProfile['preferences']>>) {
    this.profile.update((p) =>
      p ? { ...p, preferences: { ...p.preferences, ...prefs } } : p,
    );
  }

  patchLocal(changes: Partial<UserProfile>) {
    this.profile.update((p) => (p ? { ...p, ...changes } : p));
  }

  load() {
    this.http.get<UserProfile>(`${API_URL}/profile/me`).subscribe({
      next: (p) => this.profile.set(p),
      error: (err) => console.error('Could not load profile:', err.status),
    });
  }
}
