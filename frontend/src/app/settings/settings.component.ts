import { Component, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { API_URL } from '../app.config';
import { ChatService } from '../services/chat.service';
import { LANGUAGES, Lang, LanguageService } from '../services/language.service';
import { ProfileService } from '../services/profile.service';
import { ThemeService } from '../services/theme.service';


@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit {
  readonly theme = inject(ThemeService);
  readonly lang = inject(LanguageService);
  readonly profile = inject(ProfileService);
  private http = inject(HttpClient);
  private router = inject(Router);
  private chatService = inject(ChatService);
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);

  readonly languages = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'ar', label: 'العربية' },
  ];
  savingHistory = false;
  deleting = false;

  ngOnInit(): void {
    this.profile.load(); // make sure the toggles show what is saved
  }

  get isDarkTheme(): boolean {
    return this.theme.currentTheme === 'dark';
  }

  toggleTheme() {
    this.theme.toggleTheme(); // applies it and saves it to the account
  }

  changeLanguage(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if ((LANGUAGES as readonly string[]).includes(value))
      this.lang.setLanguage(value as Lang);
  }

  toggleConversationHistory(event: Event) {
    const input = event.target as HTMLInputElement;
    const enable = input.checked;
    this.savingHistory = true;

    this.http
      .patch<{
        conversationHistory?: boolean;
      }>(`${API_URL}/preferences`, { conversationHistory: enable })
      .subscribe({
        next: () => {
          this.savingHistory = false;
          this.profile.setPreferences({ conversationHistory: enable }); // the chat sees it right away
        },
        error: (err) => {
          this.savingHistory = false;
          input.checked = !enable; // put the switch back
          this.toast('error', 'Error', this.errorText(err));
        },
      });
  }

  confirmDelete() {
    this.confirmationService.confirm({
      header: 'Delete Confirmation',
      message: 'Are you sure you want to delete all your history?',
      acceptButtonStyleClass: 'btn-danger-solid',
      accept: () => this.deleteAllDiscussions(),
    });
  }

  private deleteAllDiscussions() {
    if (this.deleting) return;
    this.deleting = true;
    // The service also clears the open chat and refreshes the sidebar list
    this.chatService.deleteAllDiscussions().subscribe({
      next: () => {
        this.deleting = false;
        this.toast('success', 'Success', 'History deleted successfully!');
        this.goToHome();
      },
      error: (err) => {
        this.deleting = false;
        this.toast('error', 'Error', this.errorText(err));
      },
    });
  }

  goToHome(): void {
    this.router.navigate(['/home']);
  }

  private errorText(err: any): string {
    if (err.status === 0) return 'Cannot reach the server.';
    if (err.status === 429) return 'Too many requests. Please wait a moment.';
    return err.error?.error ?? 'Something went wrong.';
  }

  private toast(
    severity: 'success' | 'error',
    summary: string,
    detail: string,
  ) {
    this.messageService.add({ severity, summary, detail });
  }
}
