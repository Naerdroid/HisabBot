'use strict';

const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const DEFAULT_PATHS = Object.freeze({
  whisper: 'C:\\Users\\Lenovo\\AI\\whisper.cpp\\build\\bin\\Release\\whisper-cli.exe',
  model: 'C:\\Users\\Lenovo\\AI\\models\\ggml-base.bin',
  ffmpeg: 'C:\\Users\\Lenovo\\AI\\ffmpeg\\extract\\ffmpeg-n8.1-latest-win64-lgpl-shared-8.1\\bin\\ffmpeg.exe',
  ffprobe: 'C:\\Users\\Lenovo\\AI\\ffmpeg\\extract\\ffmpeg-n8.1-latest-win64-lgpl-shared-8.1\\bin\\ffprobe.exe',
});

const PROCESS_TIMEOUT_MS = Object.freeze({ ffprobe: 10000, ffmpeg: 20000, whisper: 90000 });
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 30;
const SUPPORTED_LANGUAGES = new Set(['auto', 'en', 'ur']);

const MIME_EXTENSIONS = new Map([
  ['audio/webm', '.webm'],
  ['audio/ogg', '.ogg'],
  ['audio/mp4', '.mp4'],
]);

const MIME_FORMATS = new Map([
  ['audio/webm', ['webm', 'matroska']],
  ['audio/ogg', ['ogg']],
  ['audio/mp4', ['mov', 'mp4', '3gp', '3g2', 'mj2']],
]);

class TranscriptionError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'TranscriptionError';
    this.code = code;
    this.status = status;
  }
}

function resolveExecutable(envName, fallback) {
  const resolved = path.resolve(process.env[envName] || fallback);
  return resolved;
}

function getToolPaths() {
  const ffmpegPath = resolveExecutable('FFMPEG_PATH', DEFAULT_PATHS.ffmpeg);
  return {
    whisper: resolveExecutable('WHISPER_CPP_CLI_PATH', DEFAULT_PATHS.whisper),
    model: resolveExecutable('WHISPER_MODEL_PATH', DEFAULT_PATHS.model),
    ffmpeg: ffmpegPath,
    ffprobe: process.env.FFPROBE_PATH
      ? path.resolve(process.env.FFPROBE_PATH)
      : path.join(path.dirname(ffmpegPath), 'ffprobe.exe'),
  };
}

function validateLanguage(language) {
  if (language === undefined || language === '') return 'auto';
  if (typeof language !== 'string' || !SUPPORTED_LANGUAGES.has(language)) {
    throw new TranscriptionError('INVALID_LANGUAGE', 'Choose automatic detection, English, or Urdu.', 400);
  }
  return language;
}

function normalizeMimeType(mimeType) {
  return typeof mimeType === 'string' ? mimeType.split(';', 1)[0].trim().toLowerCase() : '';
}

function runProcess(executable, args, { timeoutMs, signal, maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TranscriptionError('CLIENT_DISCONNECTED', 'Request cancelled.', 499));
      return;
    }

    let child;
    try {
      child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      reject(new TranscriptionError('TOOL_UNAVAILABLE', 'Local transcription tools are unavailable.', 503));
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let overflow = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortChild);
      if (error) reject(error);
      else resolve(result);
    };

    const abortChild = () => {
      aborted = true;
      child.kill();
    };

    const capture = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        overflow = true;
        child.kill();
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };

    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.once('error', () => {
      finish(new TranscriptionError('TOOL_UNAVAILABLE', 'A local transcription tool could not be started.', 503));
    });
    child.once('close', (code) => {
      if (timedOut) {
        finish(new TranscriptionError('PROCESS_TIMEOUT', 'Local transcription took too long. Please try a shorter recording.', 504));
      } else if (aborted) {
        finish(new TranscriptionError('CLIENT_DISCONNECTED', 'Request cancelled.', 499));
      } else if (overflow) {
        finish(new TranscriptionError('PROCESS_OUTPUT_LIMIT', 'Local transcription returned an invalid response.', 500));
      } else if (code !== 0) {
        finish(new TranscriptionError('PROCESS_FAILED', 'Local audio processing failed. Try a different recording.', 422));
      } else {
        finish(null, { stdout, stderr });
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', abortChild, { once: true });
  });
}

async function assertLocalTools(paths = getToolPaths()) {
  try {
    await Promise.all([
      fs.access(paths.whisper),
      fs.access(paths.model),
      fs.access(paths.ffmpeg),
      fs.access(paths.ffprobe),
    ]);
  } catch {
    throw new TranscriptionError('TOOL_UNAVAILABLE', 'Local Whisper or FFmpeg files are missing. Check the voice setup paths.', 503);
  }
  return paths;
}

async function probeAudio(ffprobe, filePath, mimeType, signal, { requireDuration = false, validateMime = true } = {}) {
  const { stdout } = await runProcess(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name:stream=duration,codec_type,sample_rate,channels',
    '-of', 'json',
    filePath,
  ], { timeoutMs: PROCESS_TIMEOUT_MS.ffprobe, signal });

  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch {
    throw new TranscriptionError('INVALID_AUDIO', 'The uploaded file is not a valid audio recording.', 400);
  }
  const audioStream = Array.isArray(metadata.streams) && metadata.streams.find((stream) => stream.codec_type === 'audio');
  const durationValue = metadata.format?.duration ?? audioStream?.duration;
  const parsedDuration = Number(durationValue);
  const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : undefined;
  if (!audioStream || (requireDuration && duration === undefined)) {
    throw new TranscriptionError('INVALID_AUDIO', 'The uploaded file does not contain readable audio.', 400);
  }
  if (duration !== undefined && duration > MAX_AUDIO_DURATION_SECONDS) {
    throw new TranscriptionError('DURATION_LIMIT', 'Recordings must be 30 seconds or shorter.', 413);
  }
  if (validateMime) {
    const acceptedFormats = MIME_FORMATS.get(normalizeMimeType(mimeType)) || [];
    const actualFormats = String(metadata.format?.format_name || '').split(',');
    if (!acceptedFormats.some((format) => actualFormats.includes(format))) {
      throw new TranscriptionError('INVALID_AUDIO', 'The recording content does not match its declared audio format.', 415);
    }
  }
  return { duration, audioStream };
}

function extractTranscript(stdout) {
  // whisper-cli diagnostics go to stderr; with -np/-nt, recognized segments are stdout.
  const text = stdout.trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text)) {
    throw new TranscriptionError('NO_SPEECH', 'No speech was recognized. Try speaking clearly and recording again.', 422);
  }
  return text.slice(0, 4000);
}

function extractDetectedLanguage(stderr) {
  const match = stderr.match(/\blang\s*=\s*([a-z]{2,3})\b/i);
  return match ? match[1].toLowerCase() : undefined;
}

async function transcribeAudio({ inputPath, mimeType, language, signal, tempRoot = os.tmpdir() }) {
  const selectedLanguage = validateLanguage(language);
  const extension = MIME_EXTENSIONS.get(normalizeMimeType(mimeType));
  if (!extension) {
    throw new TranscriptionError('UNSUPPORTED_AUDIO', 'This audio format is not supported by local transcription.', 415);
  }

  const paths = await assertLocalTools();
  const workDir = await fs.mkdtemp(path.join(tempRoot, 'hisabbot-transcription-'));
  const wavPath = path.join(workDir, 'normalized.wav');
  try {
    let probed;
    try {
      probed = await probeAudio(paths.ffprobe, inputPath, mimeType, signal);
    } catch (error) {
      if (error instanceof TranscriptionError && error.code === 'PROCESS_FAILED') {
        throw new TranscriptionError('INVALID_AUDIO', 'The uploaded file does not contain readable audio in the declared format.', 415);
      }
      throw error;
    }
    const { duration } = probed;
    await runProcess(paths.ffmpeg, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      // MediaRecorder WebM commonly has no container duration metadata. Decode
      // at most one second beyond the limit, then measure the normalized WAV.
      '-vn', '-t', String(MAX_AUDIO_DURATION_SECONDS + 1),
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
      wavPath,
    ], { timeoutMs: PROCESS_TIMEOUT_MS.ffmpeg, signal });

    const wavStats = await fs.stat(wavPath).catch(() => null);
    if (!wavStats || wavStats.size < 44) {
      throw new TranscriptionError('INVALID_AUDIO', 'The audio could not be decoded.', 400);
    }

    const normalizedMetadata = await probeAudio(paths.ffprobe, wavPath, 'audio/wav', signal, {
      requireDuration: true,
      validateMime: false,
    });
    if (normalizedMetadata.duration > MAX_AUDIO_DURATION_SECONDS) {
      throw new TranscriptionError('DURATION_LIMIT', 'Recordings must be 30 seconds or shorter.', 413);
    }

    const { stdout, stderr } = await runProcess(paths.whisper, [
      '-m', paths.model,
      '-f', wavPath,
      '-l', selectedLanguage,
      '-nt', '-np',
      '-t', '4',
    ], { timeoutMs: PROCESS_TIMEOUT_MS.whisper, signal });

    return {
      text: extractTranscript(stdout),
      language: selectedLanguage === 'auto' ? extractDetectedLanguage(stderr) : undefined,
      duration: duration ?? normalizedMetadata.duration,
    };
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError('INTERNAL_ERROR', 'Transcription could not be completed. Please try again.', 500);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  MAX_AUDIO_DURATION_SECONDS,
  MIME_EXTENSIONS,
  MIME_FORMATS,
  normalizeMimeType,
  PROCESS_TIMEOUT_MS,
  TranscriptionError,
  assertLocalTools,
  extractTranscript,
  extractDetectedLanguage,
  getToolPaths,
  probeAudio,
  runProcess,
  transcribeAudio,
  validateLanguage,
};
