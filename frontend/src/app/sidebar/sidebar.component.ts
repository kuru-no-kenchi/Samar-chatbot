import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  OnInit,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TranslateModule } from '@ngx-translate/core';
import { API_URL } from '../app.config';
import { AuthService } from '../services/auth.service';
import { ChatService, DiscussionSummary } from '../services/chat.service';
import { ProfileService } from '../services/profile.service';
import { ThemeService } from '../services/theme.service';
import { LogoMarkComponent } from '../logo-mark/logo-mark.component';

const MAX_TITLE_LENGTH = 80;
const DAY = 24 * 60 * 60 * 1000;

interface Group {
  label: string;
  items: DiscussionSummary[];
}

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LogoMarkComponent],
})
export class SidebarComponent implements OnInit {
  @Output() discussionSelected = new EventEmitter<string>();
  @Output() newChatStarted = new EventEmitter<void>();
  @Output() mobileToggleSidebarEvent = new EventEmitter<void>();
  @ViewChild('profileBox') private profileBox?: ElementRef<HTMLElement>;

  readonly profile = inject(ProfileService);
  readonly theme = inject(ThemeService);
  private http = inject(HttpClient);
  private chatService = inject(ChatService);
  private authService = inject(AuthService);
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private destroyRef = inject(DestroyRef);

  discussions: DiscussionSummary[] = [];
  groups: Group[] = [];
  searchQuery = '';
  historyDisabled = false;
  activeDiscussionId: string | null = null;
  editingDiscussionId: string | null = null;
  editedDiscussionTitle = '';
  menuOpen = false;

  get displayName(): string {
    const p = this.profile.profile();
    return p ? `${p.first_name} ${p.last_name}`.trim() : '';
  }

  get initials(): string {
    const p = this.profile.profile();
    return p
      ? ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase()
      : '';
  }

  ngOnInit(): void {
    this.chatService.activeDiscussion$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => (this.activeDiscussionId = id));

    this.chatService.discussionsChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadDiscussions());

    this.http
      .get<{ conversationHistory?: boolean }>(`${API_URL}/preferences`)
      .subscribe({
        next: (prefs) => {
          if (prefs.conversationHistory === false) this.historyDisabled = true;
          else this.loadDiscussions();
        },
        error: () => this.loadDiscussions(),
      });
  }

  loadDiscussions() {
    if (this.historyDisabled) return;
    this.chatService.getDiscussions().subscribe({
      next: (res) => {
        this.discussions = res.discussions ?? [];
        this.filterDiscussions();
      },
      error: (err) => this.showError('Could not load your discussions.', err),
    });
  }

  filterDiscussions() {
    const q = this.searchQuery.trim().toLowerCase();
    const list = q
      ? this.discussions.filter((d) =>
          (d.title ?? '').toLowerCase().includes(q),
        )
      : this.discussions;
    this.groups = this.group(list);
  }

  private group(list: DiscussionSummary[]): Group[] {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const buckets: Group[] = [
      { label: 'TODAY', items: [] },
      { label: 'YESTERDAY', items: [] },
      { label: 'PREVIOUS_7_DAYS', items: [] },
      { label: 'OLDER', items: [] },
    ];
    for (const d of list) {
      const age =
        startOfToday.getTime() - new Date(d.updatedAt ?? d.createdAt).getTime();
      if (age <= 0) buckets[0].items.push(d);
      else if (age <= DAY) buckets[1].items.push(d);
      else if (age <= 7 * DAY) buckets[2].items.push(d);
      else buckets[3].items.push(d);
    }
    return buckets.filter((b) => b.items.length > 0);
  }

  toggleSidebar(): void {
    this.mobileToggleSidebarEvent.emit();
  }

  selectDiscussion(discussionId: string) {
    this.chatService.setActiveDiscussion(discussionId);
    this.discussionSelected.emit(discussionId);
  }

  startNewChat() {
    this.chatService.startNewChat();
    this.newChatStarted.emit();
  }

  confirmDelete(discussionId: string) {
    this.confirmationService.confirm({
      header: 'Delete discussion',
      message: 'Are you sure you want to delete this discussion?',
      acceptButtonStyleClass: 'btn-danger-solid',
      accept: () => this.deleteDiscussion(discussionId),
    });
  }

  private deleteDiscussion(discussionId: string) {
    this.chatService.deleteDiscussion(discussionId).subscribe({
      next: () =>
        this.messageService.add({
          severity: 'success',
          summary: 'Deleted',
          detail: 'Discussion deleted',
        }),
      error: (err) => this.showError('Could not delete this discussion.', err),
    });
  }

  startEdit(discussion: DiscussionSummary): void {
    this.editingDiscussionId = discussion._id;
    this.editedDiscussionTitle = discussion.title ?? '';
  }

  cancelEdit(): void {
    this.editingDiscussionId = null;
    this.editedDiscussionTitle = '';
  }

  submitEdit(): void {
    const id = this.editingDiscussionId;
    const title = this.editedDiscussionTitle.trim();
    if (!id || !title) return;
    if (title.length > MAX_TITLE_LENGTH) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Title too long',
        detail: `Please keep it under ${MAX_TITLE_LENGTH} characters.`,
      });
      return;
    }
    this.chatService.updateDiscussionTitle(id, title).subscribe({
      next: () => this.cancelEdit(),
      error: (err) => this.showError('Could not rename this discussion.', err),
    });
  }

  // Profile menu
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (
      this.menuOpen &&
      !this.profileBox?.nativeElement.contains(event.target as Node)
    ) {
      this.menuOpen = false;
    }
  }

  toggleTheme() {
    this.theme.toggleTheme();
    this.menuOpen = false;
  }

  confirmLogout() {
    this.menuOpen = false;
    this.confirmationService.confirm({
      header: 'Log out',
      message: 'Are you sure you want to log out?',
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.authService.logout(),
    });
  }

  private showError(detail: string, err: any) {
    console.error('Sidebar error:', err?.status);
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: err?.status === 0 ? 'Cannot reach the server.' : detail,
    });
  }
}
