import { useState, useRef, useEffect, useCallback } from 'react';
import { getSettings } from '../utils/storage';
import type { Checkpoint } from '../constants/checkpoints';
import { formatTime, formatMargin } from '../utils/pace';
import { useTTS } from '../hooks/useTTS';

// Android Chrome uses webkitSpeechRecognition
interface ISpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => ISpeechRecognition;
const getSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
  const w = window as unknown as Record<string, unknown>;
  return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition'] ?? null) as SpeechRecognitionCtor | null;
};

interface AIChatProps {
  currentKm: number;
  paceKmH: number;
  nextCp: Checkpoint | null;
  marginMinutes: number | null;
  nightMode: boolean;
  initialMessage?: string;
  onClose: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const PRESETS = [
  { label: '足が痛い（右かかと）', message: '右かかとが痛くて歩くのがつらいです。どうすればいいですか？' },
  { label: '眠くて限界', message: '眠くて限界です。眠気覚ましの方法を教えてください。' },
  { label: '水分が切れそう', message: '水分が切れそうです。次のコンビニまでどうしたらいいですか？' },
  { label: '心が折れそう', message: 'もう無理かもしれません。心が折れそうです。' },
];

function buildSystemPrompt(
  currentKm: number,
  paceKmH: number,
  nextCp: Checkpoint | null,
  marginMinutes: number | null
): string {
  const now = new Date();
  const timeStr = formatTime(now);
  const cpInfo = nextCp
    ? `次のCP: ${nextCp.name}（${nextCp.km}km）、制限時刻: ${formatTime(nextCp.cutoff)}、マージン: ${marginMinutes !== null ? formatMargin(marginMinutes) : '不明'}`
    : 'CPなし（ゴール後または開始前）';

  return `あなたは100kmウォーキング大会の専門コーチです。参加者が今まさに東京エクストリームウォーク100を歩いています。

現在の状況:
- 現在時刻: ${timeStr}
- 歩行距離: ${currentKm.toFixed(1)}km / 100km
- 現在のペース: ${paceKmH.toFixed(1)} km/h
- ${cpInfo}

以下の点を守ってください:
- 短く、具体的で実践的なアドバイスをしてください（200文字以内。音声で聞くので簡潔に）
- 日本語で答えてください
- 励ましの言葉を必ず含めてください
- 医療的な問題が疑われる場合は棄権を勧めることをためらわないでください
- スポーツ科学と実際のウルトラウォーキングの知識に基づいて答えてください`;
}

export function AIChat({
  currentKm,
  paceKmH,
  nextCp,
  marginMinutes,
  nightMode,
  initialMessage,
  onClose,
}: AIChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const settings = getSettings();
  const { speak } = useTTS();

  const SpeechRecognitionCtor = getSpeechRecognitionCtor();
  const voiceSupported = !!SpeechRecognitionCtor;

  const bg = nightMode ? 'bg-black' : 'bg-gray-950';
  const card = nightMode ? 'bg-gray-900' : 'bg-gray-800';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionCtor || loading) return;
    setMicError(null);

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ja-JP';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setInput('');
        sendMessage(transcript); // eslint-disable-line @typescript-eslint/no-use-before-define
      }
    };

    recognition.onerror = (e) => {
      setIsListening(false);
      recognitionRef.current = null;
      if (e.error === 'not-allowed') {
        setMicError('マイクの使用が拒否されています。ブラウザの設定で許可してください。');
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [SpeechRecognitionCtor, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopListening = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => { recognitionRef.current?.abort(); };
  }, []);

  // Auto-start voice on mount (if no initialMessage)
  useEffect(() => {
    if (voiceSupported && !initialMessage) {
      startListening();
    }
    if (initialMessage) {
      sendMessage(initialMessage); // eslint-disable-line @typescript-eslint/no-use-before-define
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    if (!settings.claudeApiKey) {
      setError('Claude APIキーが設定されていません。セットアップ画面で設定してください。');
      return;
    }

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    const systemPrompt = buildSystemPrompt(currentKm, paceKmH, nextCp, marginMinutes);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.claudeApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 512,
          system: systemPrompt,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const assistantText = data.content?.[0]?.text ?? '返答を取得できませんでした。';

      setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }]);

      // Speak response, then auto-restart listening
      speak(assistantText, () => {
        if (voiceSupported) startListening();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    stopListening();
    sendMessage(input);
  };

  return (
    <div className={`fixed inset-0 ${bg} text-white z-30 flex flex-col`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700">
        <div>
          <h2 className="font-bold text-amber-400">AIコーチ（音声対話）</h2>
          <p className="text-gray-400 text-xs">{currentKm.toFixed(1)}km地点 — 話しかけてください</p>
        </div>
        <button onClick={() => { stopListening(); onClose(); }} className="text-gray-400 text-2xl px-2" aria-label="閉じる">
          ✕
        </button>
      </div>

      {/* Mic status banner */}
      {voiceSupported && (
        <div className={`px-4 py-2 text-center text-sm font-bold transition-colors ${
          isListening ? 'bg-red-900 text-red-200' : loading ? 'bg-gray-800 text-gray-400' : 'bg-gray-900 text-gray-500'
        }`}>
          {isListening ? '🎤 聞いています… 話しかけてください' : loading ? '⏳ 回答中…' : '🔇 待機中（マイクボタンで再開）'}
        </div>
      )}

      {micError && (
        <div className="bg-red-900 px-4 py-2 text-red-200 text-xs">{micError}</div>
      )}

      {/* Preset buttons — shown only at start */}
      {messages.length === 0 && !isListening && (
        <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-gray-800">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { stopListening(); sendMessage(p.message); }}
              className="bg-gray-800 text-white text-sm px-3 py-2 rounded-xl active:scale-95 transition-transform"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !loading && !isListening && (
          <div className="text-center text-gray-500 py-8">
            <p className="text-4xl mb-3">🎤</p>
            <p>声で話しかけるか、下のボタンを押してください</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              m.role === 'user' ? 'bg-amber-500 text-black' : `${card} text-white`
            }`}>
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className={`${card} rounded-2xl px-4 py-3 text-gray-400 text-sm`}>考え中…</div>
          </div>
        )}

        {isListening && (
          <div className="flex justify-end">
            <div className="bg-red-900 rounded-2xl px-4 py-3 text-red-200 text-sm animate-pulse">
              🎤 録音中…
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900 rounded-xl p-3 text-sm text-red-200">{error}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input row */}
      <form onSubmit={handleSubmit} className="flex gap-2 p-4 bg-gray-900 border-t border-gray-700">
        {/* Mic button */}
        {voiceSupported && (
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={loading}
            className={`min-w-[56px] min-h-[56px] rounded-xl text-2xl font-bold active:scale-95 transition-all disabled:opacity-50 ${
              isListening ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-700 text-white'
            }`}
            aria-label={isListening ? '録音停止' : 'マイク'}
          >
            🎤
          </button>
        )}

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="テキストでも入力できます"
          className="flex-1 bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-400"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-amber-500 text-black font-bold px-4 py-3 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
        >
          送信
        </button>
      </form>
    </div>
  );
}
