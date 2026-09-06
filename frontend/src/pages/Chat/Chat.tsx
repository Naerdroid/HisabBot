import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, RefreshCw } from 'lucide-react';
import { chatApi } from '../../services/api';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  timestamp: Date;
}

const WELCOME_MESSAGE: Message = {
  id: '1',
  role: 'bot',
  text: 'Assalam o Alaikum! Main Hisab Bot hoon. Aap mujhe apne income aur expenses bata sakte hain. Jaise: "Aaj 5000 ka kapra becha" ya "500 rupees petrol ka expense hua".',
  timestamp: new Date(),
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    // Send to the backend /api/chat endpoint — the local Qwen model (via LM
    // Studio) interprets the message, calls approved tools if needed, and
    // returns a natural-language answer backed by real SQLite data.
    try {
      const result = await chatApi.sendMessage(text);

      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'bot',
        text: result.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      // Surface a readable error message; the backend returns { error }
      // for validation (400) and AI-unavailable (503) cases.
      const serverError = err?.response?.data?.error;
      const fallback = 'Sorry, aapka message process nahi ho saka. Please dobara try karein.';
      const errorText = typeof serverError === 'string' && serverError.trim() ? serverError : fallback;

      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'bot',
        text: errorText,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chat with Hisab Bot</h1>
          <p className="text-sm text-gray-500 mt-1">Record transactions using natural language</p>
        </div>
        <button
          onClick={() => setMessages([WELCOME_MESSAGE])}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={16} />
          New Chat
        </button>
      </div>

      {/* Chat messages area */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                msg.role === 'bot' ? 'bg-primary-100 text-primary-600' : 'bg-gray-200 text-gray-600'
              }`}>
                {msg.role === 'bot' ? <Bot size={16} /> : <User size={16} />}
              </div>
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'bot'
                  ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                  : 'bg-primary-600 text-white rounded-tr-sm'
              }`}>
                <p className="whitespace-pre-wrap">{msg.text}</p>
                <p className={`text-xs mt-1.5 ${
                  msg.role === 'bot' ? 'text-gray-400' : 'text-primary-200'
                }`}>
                  {msg.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </p>
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-600">
                <Bot size={16} />
              </div>
              <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-gray-100 p-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message... e.g. '5000 ka kapra becha'"
              className="flex-1 px-4 py-3 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-600/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={18} />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Use natural language like "Aaj 5000 ka kapra becha" or "500 petrol ka expense"
          </p>
        </div>
      </div>
    </div>
  );
}
