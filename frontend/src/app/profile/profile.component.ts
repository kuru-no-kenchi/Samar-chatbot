import { Component, effect, inject, untracked } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { API_URL } from '../app.config';
import { AuthService } from '../services/auth.service';
import { ProfileService, UserProfile } from '../services/profile.service';

const BOTS = ['bot1', 'bot2']; // must match the BOTS list in the backend profile controller
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const passwordsMatch = (g: AbstractControl): ValidationErrors | null =>
  g.get('newPassword')?.value === g.get('confirmPassword')?.value
    ? null
    : { passwordMismatch: true };

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DialogModule],
  templateUrl: './profile.component.html',
})
export class ProfileComponent {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private router = inject(Router);
  private translate = inject(TranslateService);
  private messageService = inject(MessageService);
  private auth = inject(AuthService);
  readonly profile = inject(ProfileService);

  readonly bots = BOTS;
  displayModal = false;
  saving = false;
  uploading = false;
  changingPassword = false;

  profileForm = this.fb.nonNullable.group({
    first_name: ['', [Validators.required, Validators.maxLength(50)]],
    last_name: ['', [Validators.required, Validators.maxLength(50)]],
    email: [
      '',
      [Validators.required, Validators.email, Validators.maxLength(254)],
    ],
    selectedBot: [''],
    currentPassword: [''], // only used when the email changes
  });

  passwordForm = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: [
        '',
        [
          Validators.required,
          Validators.minLength(8),
          Validators.maxLength(128),
        ],
      ],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  constructor() {
    this.translate.setDefaultLang('en');
    this.translate.use('fr');

    // Fill the form from the shared profile, unless the user is already typing
    effect(() => {
      const p = this.profile.profile();
      if (!p) return;
      untracked(() => {
        if (!this.profileForm.dirty) this.resetForm(p);
      });
    });
  }

  ngOnInit(): void {
    this.profile.load(); // refresh in case it changed elsewhere
  }

  private resetForm(p: UserProfile) {
    this.profileForm.reset({
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
      selectedBot: p.selectedBot ?? '',
      currentPassword: '',
    });
  }

  get emailChanged(): boolean {
    const p = this.profile.profile();
    return (
      !!p &&
      this.profileForm.controls.email.value.trim().toLowerCase() !==
        p.email.toLowerCase()
    );
  }

  showImageModal() {
    if (this.profile.photoUrl()) this.displayModal = true;
  }

  goToHome(): void {
    this.router.navigate(['/home']);
  }

  onSubmit() {
    const p = this.profile.profile();
    if (!p || this.saving) return;
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    // Send only what changed
    const v = this.profileForm.getRawValue();
    const body: Record<string, string> = {};
    if (v.first_name.trim() !== p.first_name)
      body['first_name'] = v.first_name.trim();
    if (v.last_name.trim() !== p.last_name)
      body['last_name'] = v.last_name.trim();
    if (v.selectedBot && v.selectedBot !== (p.selectedBot ?? ''))
      body['selectedBot'] = v.selectedBot;

    if (this.emailChanged) {
      if (!v.currentPassword) {
        this.toast(
          'warn',
          'Password needed',
          'Enter your current password to change your email.',
        );
        return;
      }
      body['email'] = v.email.trim().toLowerCase();
      body['currentPassword'] = v.currentPassword;
    }

    if (Object.keys(body).length === 0) {
      this.toast('info', 'Nothing to save', 'You have not changed anything.');
      return;
    }

    this.saving = true;
    this.http
      .patch<{ user: UserProfile }>(`${API_URL}/profile/me`, body)
      .subscribe({
        next: ({ user }) => {
          this.saving = false;
          this.profile.patchLocal(user);
          this.auth.updateUser({
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
          });
          this.resetForm(user);
          this.toast('success', 'Success', 'Profile updated successfully');
        },
        error: (err) => {
          this.saving = false;
          this.toast('error', 'Error', this.errorText(err));
        },
      });
  }

  onPersonalPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // lets the user pick the same file again later
    if (!file || this.uploading) return;

    if (!PHOTO_TYPES.includes(file.type)) {
      this.toast('warn', 'Wrong file type', 'Use a JPEG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      this.toast(
        'warn',
        'File too large',
        'The photo must be 2 MB or smaller.',
      );
      return;
    }

    const formData = new FormData();
    formData.append('photo', file); // the field name the backend expects
    this.uploading = true;

    // No Content-Type header: the browser adds the multipart boundary itself
    this.http
      .post<{ photo: string }>(`${API_URL}/profile/me/photo`, formData)
      .subscribe({
        next: (res) => {
          this.uploading = false;
          this.profile.patchLocal({ personal_photo: res.photo }); // header and chat update too
          this.toast('success', 'Success', 'Photo updated successfully');
        },
        error: (err) => {
          this.uploading = false;
          this.toast('error', 'Error', this.errorText(err));
        },
      });
  }

  changePassword() {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    if (this.changingPassword) return;

    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.changingPassword = true;

    // Assumes changePassword is mounted at /users/me/password. Adjust if yours differs.
    this.http
      .patch(`${API_URL}/users/change/password`, {
        currentPassword,
        newPassword,
      })
      .subscribe({
        next: () => {
          this.toast('success', 'Password updated', 'Please log in again.');
          this.auth.logout(); // other sessions were revoked on the server
        },
        error: (err) => {
          this.changingPassword = false;
          this.toast('error', 'Error', this.errorText(err));
        },
      });
  }

  private errorText(err: any): string {
    if (err.status === 0) return 'Cannot reach the server.';
    if (err.status === 401 || err.status === 403)
      return 'Current password is incorrect.';
    if (err.status === 409) return 'This email is already in use.';
    if (err.status === 413) return 'The photo must be 2 MB or smaller.';
    if (err.status === 429)
      return 'Too many attempts. Please wait a few minutes.';
    return err.error?.message ?? err.error?.error ?? 'Something went wrong.';
  }

  get initials(): string {
    const p = this.profile.profile();
    return p
      ? ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase()
      : '';
  }

  private toast(
    severity: 'success' | 'info' | 'warn' | 'error',
    summary: string,
    detail: string,
  ) {
    this.messageService.add({ severity, summary, detail });
  }
}
