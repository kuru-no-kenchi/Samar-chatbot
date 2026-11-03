import {
  ApplicationConfig,
  provideZoneChangeDetection,
  provideAppInitializer,
  inject,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { ConfirmationService, MessageService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { LanguageService } from './services/language.service';
import { environment } from '../environments/environment';

export const API_URL = environment.backendHostName;

const SamarPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#fcf3ef',
      100: '#f9e3da',
      200: '#f2c6b4',
      300: '#eba68a',
      400: '#e28b6b',
      500: '#D97757',
      600: '#c0603f',
      700: '#a04b31',
      800: '#833f2c',
      900: '#6c3727',
      950: '#3a1a12',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.500}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.600}',
          activeColor: '{primary.700}',
        },
        surface: {
          0: '#ffffff',
          50: '#FAF9F5',
          100: '#F0EEE6',
          200: '#E5E2D8',
          300: '#D3D0C4',
          400: '#B4B1A4',
          500: '#9C9A92',
          600: '#73726C',
          700: '#55544F',
          800: '#3A3935',
          900: '#262624',
          950: '#1F1E1D',
        },
      },
      dark: {
        primary: {
          color: '{primary.500}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.400}',
          activeColor: '{primary.300}',
        },
        surface: {
          0: '#FAF9F5',
          50: '#E5E2D8',
          100: '#D3D0C4',
          200: '#B4B1A4',
          300: '#9C9A92',
          400: '#73726C',
          500: '#55544F',
          600: '#3F3E3A',
          700: '#30302E',
          800: '#2A2A28',
          900: '#262624',
          950: '#1F1E1D',
        },
      },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: SamarPreset,
        options: {
          darkModeSelector: '.dark',
          cssLayer: { name: 'primeng', order: 'theme, base, primeng' },
        },
      },
    }),
    MessageService,
    ConfirmationService,
    provideAppInitializer(() => {
      inject(ThemeService);
      inject(LanguageService);
    }),
    provideAppInitializer(() =>
      firstValueFrom(inject(AuthService).restoreSession()),
    ),
  ],
};
