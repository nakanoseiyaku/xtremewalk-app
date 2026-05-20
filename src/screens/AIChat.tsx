import { useState, useRef, useEffect } from 'react';
import { getSettings } from '../utils/storage';
import type { Checkpoint } from '../constants/checkpoints';
import { formatTime, formatMargin } from '../utils/pace';

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
- 短く、具体的で実践的なアドバイスをしてください（500文字以内）
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const settings = getSettings();

  const bg = nightMode ? 'bg-black' : 'bg-gray-950';
  const card = nightMode ? 'bg-gray-900' : 'bg-gray-800';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Send initial message if provided
  useEffect(() => {
    if (initialMessage) {
      sendMessage(initialMessage);
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
          max_tokens: 1024,
          system: systemPrompt,
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const assistantText =
        data.content?.[0]?.text ?? '返答を取得できませんでした。';

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: assistantText },
      ]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'エラーが発生しました'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className={`fixed inset-0 ${bg} text-white z-30 flex flex-col`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700">
        <div>
          <h2 className="font-bold text-amber-400">AIコーチ</h2>
          <p className="text-gray-400 text-xs">{currentKm.toFixed(1)}km地点</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 text-2xl px-2"
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>

      {/* Preset buttons */}
      {messages.length === 0 && (
        <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-gray-800">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => sendMessage(p.message)}
              className="bg-gray-800 text-white text-sm px-3 py-2 rounded-xl active:scale-95 transition-transform"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="text-center text-gray-500 py-8">
            <p className="text-4xl mb-3">💬</p>
            <p>何でも聞いてください</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-amber-500 text-black'
                  : `${card} text-white`
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className={`${card} rounded-2xl px-4 py-3 text-gray-400 text-sm`}>
              考え中...
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900 rounded-xl p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 p-4 bg-gray-900 border-t border-gray-700"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力..."
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
