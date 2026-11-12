'use client';
import { useEffect } from 'react';

export function LegacyEnglishRedirect() {
  useEffect(() => {
    window.location.replace('/en/docs/updates/' + window.location.search + window.location.hash);
  }, []);
  return null;
}
