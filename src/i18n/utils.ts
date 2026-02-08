import { defaultLang, type Lang } from './languages';
import { ui } from './ui';

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (lang === 'en') return 'en';
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)[typeof defaultLang]): string {
    return ui[lang][key] || ui[defaultLang][key];
  };
}

export function getLocalizedPath(path: string, lang: Lang): string {
  if (lang === defaultLang) return path;
  return `/en${path}`;
}

export function getAlternateLangPath(url: URL): { lang: Lang; path: string } {
  const pathname = url.pathname;
  if (pathname.startsWith('/en/') || pathname === '/en') {
    // Currently English -> switch to Korean
    const koPath = pathname.replace(/^\/en/, '') || '/';
    return { lang: 'ko', path: koPath };
  }
  // Currently Korean -> switch to English
  return { lang: 'en', path: `/en${pathname}` };
}
