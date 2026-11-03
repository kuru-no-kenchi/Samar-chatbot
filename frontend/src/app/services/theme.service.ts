import { Injectable, effect, inject, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { ProfileService } from './profile.service';
import { API_URL } from '../app.config';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  currentTheme: 'light' | 'dark' = 'light';
  private readonly SETTINGS_KEY = 'appSettings';

  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private profile = inject(ProfileService);

  constructor() {
    // Quick start: last local choice, otherwise the system setting
    this.apply(this.readLocal() ?? this.systemPrefersDark());

    // Once the profile loads, the server's saved preference wins
    effect(() => {
      const server = this.profile.profile()?.preferences?.darkTheme;
      if (typeof server === 'boolean') untracked(() => this.apply(server));
    });
  }

  // User action: apply it, and save it to the account when logged in
  setTheme(isDark: boolean) {
    this.apply(isDark);
    if (this.auth.isLoggedIn()) {
      this.http
        .patch(`${API_URL}/preferences`, { darkTheme: isDark })
        .subscribe({
          next: () => this.profile.setPreferences({ darkTheme: isDark }),
          error: (err) => console.error('Could not save theme:', err.status),
        });
    }
  }

  toggleTheme() {
    this.setTheme(this.currentTheme !== 'dark');
  }

  // Applies the theme and remembers it locally; never talks to the server
  private apply(isDark: boolean) {
    this.currentTheme = isDark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', isDark);
    try {
      const settings = JSON.parse(
        localStorage.getItem(this.SETTINGS_KEY) || '{}',
      );
      settings.darkTheme = isDark;
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable or corrupted: not worth failing over */
    }
  }

  private readLocal(): boolean | null {
    try {
      const value = JSON.parse(
        localStorage.getItem(this.SETTINGS_KEY) || '{}',
      ).darkTheme;
      return typeof value === 'boolean' ? value : null;
    } catch {
      return null;
    }
  }

  private systemPrefersDark(): boolean {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
}
