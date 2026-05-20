import { useCallback, useEffect, useRef } from 'react';
import { isNightMode } from '../constants/colors';

export function useTTS() {
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSpeakingRef = useRef(false);

  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;

    const night = isNightMode();
    const rate = night ? 0.8 : 0.9;
    const volume = night ? 0.5 : 0.8;

    // Android Chrome workaround 1: cancel before each speak
    window.speechSynthesis.cancel();

    // Android Chrome workaround 2: setTimeout 100ms before speak
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP';
      utterance.rate = rate;
      utterance.volume = volume;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        isSpeakingRef.current = true;

        // Android Chrome workaround 3: setInterval every 14s to pause/resume
        if (keepAliveRef.current) clearInterval(keepAliveRef.current);
        keepAliveRef.current = setInterval(() => {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          } else {
            if (keepAliveRef.current) {
              clearInterval(keepAliveRef.current);
              keepAliveRef.current = null;
            }
          }
        }, 14000);
      };

      utterance.onend = () => {
        isSpeakingRef.current = false;
        if (keepAliveRef.current) {
          clearInterval(keepAliveRef.current);
          keepAliveRef.current = null;
        }
      };

      utterance.onerror = () => {
        isSpeakingRef.current = false;
        if (keepAliveRef.current) {
          clearInterval(keepAliveRef.current);
          keepAliveRef.current = null;
        }
      };

      window.speechSynthesis.speak(utterance);
    }, 100);
  }, []);

  const cancel = useCallback(() => {
    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      window.speechSynthesis.cancel();
    };
  }, []);

  return { speak, cancel };
}
