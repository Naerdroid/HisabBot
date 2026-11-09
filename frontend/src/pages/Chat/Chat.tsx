import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, RefreshCw, Mic, Square, X } from 'lucide-react';
import { chatApi, voiceApi, getApiErrorMessage, type ChatHistoryEntry, type TranscriptionLanguage } from '../../services/api';

const MAX_RECORDING_MS = 30000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CONTENT = 1000;

const FOLLOW_UP_PROMPT_PATTERN = /\b(?:how much|what (?:is|was) the amount|which (?:item|payment|method)|payment method|please (?:provide|tell me)|(?:provide|tell me) the (?:amount|item|payment)|amount|kitna|kitne|raqam|cash or|clarify)\b|رقم|کتنا|کتنی|کیا طریقہ/i;
const INDEPENDENT_REQUEST_PATTERN = /\b(?:hello|hi|hey|good morning|good afternoon|good evening|i am|i'm|i spent|i bought|i paid|i received|i earned|i sold|how are you|what is|how much|show me|tell me|please|today|yesterday|expense|income|transaction|profit|balance)\b|[?؟]|میں نے|کیا ہے/i;

function getRelevantHistory(messages: Message[], newMessage: string): ChatHistoryEntry[] {
  const previousAssistant = [...messages].reverse().find((message) => message.role === 'bot' && message.id !== WELCOME_MESSAGE.id);
  const answer = newMessage.trim();
  if (!previousAssistant || !FOLLOW_UP_PROMPT_PATTERN.test(previousAssistant.text)) return [];
  if (!answer || answer.length > 100 || INDEPENDENT_REQUEST_PATTERN.test(answer)) return [];

  return messages
    .filter((message) => message.id !== WELCOME_MESSAGE.id)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: (message.role === 'bot' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: message.text.slice(0, MAX_HISTORY_CONTENT),
    }));
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `00:${String(seconds).padStart(2, '0')}`;
}

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

// Persist the conversation locally so it survives navigation and refreshes.
const CHAT_STORAGE_KEY = 'hisabbot.chat.messages.v1';
const MAX_STORED_MESSAGES = 100;

function loadStoredMessages(): Message[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [WELCOME_MESSAGE];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [WELCOME_MESSAGE];

    const restored: Message[] = parsed
      .filter(
        (m) =>
          m &&
          typeof m.id === 'string' &&
          (m.role === 'user' || m.role === 'bot') &&
          typeof m.text === 'string'
      )
      .map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        timestamp: new Date(typeof m.timestamp === 'string' ? m.timestamp : Date.now()),
      }))
      .filter((m) => !Number.isNaN(m.timestamp.getTime()));

    return restored.length > 0 ? restored : [WELCOME_MESSAGE];
  } catch {
    // Unreadable/corrupted storage — start a fresh conversation instead of crashing
    return [WELCOME_MESSAGE];
  }
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>(loadStoredMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [voiceLanguage, setVoiceLanguage] = useState<TranscriptionLanguage>('auto');
  const [voiceStatus, setVoiceStatus] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const startedAtRef = useRef(0);
  const intervalRef = useRef<number | undefined>(undefined);
  const maxDurationRef = useRef<number | undefined>(undefined);
  const discardRecordingRef = useRef(false);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);

  inputRef.current = input;

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearRecordingTimers = () => {
    if (intervalRef.current !== undefined) window.clearInterval(intervalRef.current);
    if (maxDurationRef.current !== undefined) window.clearTimeout(maxDurationRef.current);
    intervalRef.current = undefined;
    maxDurationRef.current = undefined;
  };

  const stopRecording = (discard = false) => {
    discardRecordingRef.current = discard;
    clearRecordingTimers();
    setRecording(false);
    if (discard) {
      chunksRef.current = [];
      recordedBytesRef.current = 0;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else stopTracks();
  };

  const handleRecordedBlob = async (blob: Blob) => {
    if (discardRecordingRef.current) {
      if (mountedRef.current) setVoiceStatus('Recording discarded.');
      return;
    }
    if (!blob.size) {
      if (mountedRef.current) setVoiceStatus('No audio was captured. Please try again.');
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      if (mountedRef.current) setVoiceStatus('Recording exceeds the 10 MB upload limit.');
      return;
    }

    setTranscribing(true);
    setVoiceStatus('Transcribing locally…');
    try {
      const result = await voiceApi.transcribe(blob, voiceLanguage);
      if (!mountedRef.current) return;
      const currentText = inputRef.current;
      const separator = currentText.trim() ? ' ' : '';
      const combined = `${currentText}${separator}${result.text}`;
      setInput(combined.slice(0, 2000));
      inputRef.current = combined.slice(0, 2000);
      setVoiceStatus(combined.length > 2000
        ? 'Transcript added; text was shortened to the chat input limit. Review before sending.'
        : 'Transcript added to the input. Review and edit it before clicking Send.');
    } catch (error: any) {
      if (!mountedRef.current) return;
      const message = error?.code === 'ECONNABORTED'
        ? 'Local transcription timed out. Try a shorter recording.'
        : getApiErrorMessage(error, 'Could not transcribe this recording. Please try again.');
      setVoiceStatus(message);
    } finally {
      if (mountedRef.current) setTranscribing(false);
    }
  };

  const startRecording = async () => {
    if (startingRef.current || recorderRef.current || recording || transcribing || sending) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceStatus('Microphone recording is not supported in this browser. Try a current Chrome or Edge build.');
      return;
    }

    startingRef.current = true;
    setVoiceStatus('Requesting microphone access…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (discardRecordingRef.current || !event.data.size) return;
        recordedBytesRef.current += event.data.size;
        if (recordedBytesRef.current > MAX_AUDIO_BYTES) {
          stopRecording(true);
          setVoiceStatus('Recording exceeded the 10 MB upload limit and was discarded.');
          return;
        }
        chunksRef.current.push(event.data);
      };
      recorder.onerror = (event) => {
        if (import.meta.env.DEV) {
          console.warn('Microphone recording failed:', event.error?.name || 'UnknownError');
        }
        discardRecordingRef.current = true;
        stopTracks();
        clearRecordingTimers();
        recorderRef.current = null;
        setRecording(false);
        setVoiceStatus('The browser could not record audio. Check the microphone and try again.');
      };
      recorder.onstop = () => {
        const actualType = recorder.mimeType || chunksRef.current[0]?.type || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: actualType });
        chunksRef.current = [];
        recordedBytesRef.current = 0;
        recorderRef.current = null;
        stopTracks();
        void handleRecordedBlob(blob);
      };

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      recorder.start(250);
      setRecording(true);
      setVoiceStatus('Recording. Stop to transcribe, or cancel to discard. Maximum 30 seconds.');
      intervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(Math.min(elapsed, MAX_RECORDING_MS));
      }, 250);
      maxDurationRef.current = window.setTimeout(() => stopRecording(false), MAX_RECORDING_MS);
    } catch (error: any) {
      stopTracks();
      if (import.meta.env.DEV) {
        console.warn('Could not start microphone recording:', error?.name || 'UnknownError');
      }
      setRecording(false);
      const message = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
        ? 'Microphone permission was denied. Allow microphone access in the browser and try again.'
        : error?.name === 'NotFoundError'
          ? 'No microphone was found. Connect a microphone and try again.'
          : 'Could not start microphone recording. Check browser permissions and try again.';
      setVoiceStatus(message);
    } finally {
      startingRef.current = false;
    }
  };

  // Save the conversation after every change (capped to keep storage small)
  useEffect(() => {
    try {
      const serializable = messages
        .slice(-MAX_STORED_MESSAGES)
        .map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }));
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(serializable));
    } catch {
      // Storage unavailable or full — the chat still works in memory
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRecordingRef.current = true;
      clearRecordingTimers();
      stopTracks();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    };
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    // Context is useful for a short answer to a pending clarification, but
    // replaying an unrelated past language/topic can bias small local models.
    const history = getRelevantHistory(messages, text);

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
      // Preserve the original text-chat contract. Local voice transcripts
      // enter this same input and are sent only after explicit user action.
      const result = await chatApi.sendMessage(text, history);

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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="voice-language" className="text-xs text-gray-500">Transcription language</label>
            <select
              id="voice-language"
              value={voiceLanguage}
              onChange={(event) => setVoiceLanguage(event.target.value as TranscriptionLanguage)}
              disabled={recording || transcribing || sending}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
            >
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="ur">Urdu</option>
            </select>
          </div>
          <div className="flex gap-2 sm:gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message... e.g. '5000 ka kapra becha'"
              maxLength={2000}
              className="flex-1 px-4 py-3 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
              disabled={sending}
            />
            {recording ? (
              <button
                type="button"
                onClick={() => stopRecording(false)}
                aria-label="Stop recording and transcribe"
                title="Stop recording and transcribe"
                className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-600/20 transition-colors hover:bg-red-700"
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                disabled={sending || transcribing}
                aria-label="Start voice recording"
                title="Record voice input locally"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mic size={18} />
              </button>
            )}
            {recording && (
              <button
                type="button"
                onClick={() => stopRecording(true)}
                aria-label="Cancel and discard recording"
                title="Discard recording"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-50"
              >
                <X size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || recording || transcribing || recorderRef.current !== null || !input.trim()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-lg shadow-primary-600/25 transition-all hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={18} />
            </button>
          </div>
          <p aria-live="polite" role="status" className={`mt-2 text-center text-xs ${recording ? 'font-medium text-red-600' : 'text-gray-500'}`}>
            {recording ? `Recording ${formatElapsed(elapsedMs)} / 00:30. Stop to transcribe or cancel.` : null}
            {transcribing ? 'Transcribing locally…' : null}
            {!recording && !transcribing ? voiceStatus : null}
          </p>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Use natural language like "Aaj 5000 ka kapra becha" or "500 petrol ka expense"
          </p>
          <p className="mt-1 text-center text-xs text-gray-400">
            Audio is processed locally. Urdu speech may appear in Urdu script; review transcription errors before clicking Send. Roman Urdu recognition is not guaranteed.
          </p>
        </div>
      </div>
    </div>
  );
}
