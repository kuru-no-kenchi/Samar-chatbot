import { Injectable, effect, inject, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { ProfileService } from './profile.service';
import { environment } from '../../environments/environment';
import { API_URL } from '../app.config';

export const LANGUAGES = ['en', 'fr', 'ar'] as const; // same list as the backend and the schema enum
export type Lang = (typeof LANGUAGES)[number];

const KEY = 'appLanguage';
const DEFAULT_LANG: Lang = 'fr';
const isLang = (v: unknown): v is Lang => LANGUAGES.includes(v as Lang);

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private http = inject(HttpClient);
  private translate = inject(TranslateService);
  private auth = inject(AuthService);
  private profile = inject(ProfileService);

  current: Lang = DEFAULT_LANG;

  constructor() {
    this.translate.setDefaultLang('en'); // fallback for missing keys
    this.apply(this.readLocal() ?? DEFAULT_LANG);

    // Once the profile loads, the account's saved language wins
    effect(() => {
      const server = this.profile.profile()?.preferences?.language;
      if (isLang(server)) untracked(() => this.apply(server));
    });
  }

  // User action: apply it, and save it to the account when logged in
  setLanguage(lang: Lang) {
    this.apply(lang);
    if (this.auth.isLoggedIn()) {
      this.http.patch(`${API_URL}/preferences`, { language: lang }).subscribe({
        next: () => this.profile.setPreferences({ language: lang }),
        error: (err) => console.error('Could not save language:', err.status),
      });
    }
  }
  
  get speechLang(): string {
    const map: Record<string, string> = {
      en: 'en-US',
      fr: 'fr-FR',
      ar: 'ar-SA',
    };
    return map[this.current] ?? 'en-US';
  }

  // Changes the page and the local copy; never talks to the server
  private apply(lang: Lang) {
    this.current = lang;
    this.translate.use(lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* storage unavailable: not worth failing over */
    }
  }

  private readLocal(): Lang | null {
    try {
      const v = localStorage.getItem(KEY);
      return isLang(v) ? v : null;
    } catch {
      return null;
    }
  }
}
