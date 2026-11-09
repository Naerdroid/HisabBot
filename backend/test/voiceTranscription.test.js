'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { createServer } = require('node:http');
const {
  TranscriptionError,
  extractTranscript,
  getToolPaths,
  normalizeMimeType,
  runProcess,
  validateLanguage,
  transcribeAudio,
} = require('../services/voiceTranscription');
const { MAX_AUDIO_BYTES, createTranscriptionRouter } = require('../routes/transcription');

function createForm({ audio = Buffer.from('test audio'), type = 'audio/webm;codecs=opus', language = 'auto', includeAudio = true } = {}) {
  const form = new FormData();
  if (includeAudio) form.append('audio', new Blob([audio], { type }), 'odd name;injection.webm');
  if (language !== undefined) form.append('language', language);
  return form;
}

async function withServer(router, callback) {
  const app = express();
  app.use('/api/transcribe', router);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}/api/transcribe`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function routerWith(transcribe) {
  return createTranscriptionRouter({ transcribe });
}

test('validates language, MIME parameters, and transcript output', () => {
  assert.equal(validateLanguage(undefined), 'auto');
  assert.equal(validateLanguage('ur'), 'ur');
  assert.equal(normalizeMimeType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(extractTranscript('  اردو transcript  '), 'اردو transcript');
  assert.throws(() => validateLanguage('fr'), TranscriptionError);
  assert.throws(() => extractTranscript('  '), (error) => error.code === 'NO_SPEECH');
});

test('bounds child-process runtime and captured output', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 30 }),
    (error) => error.code === 'PROCESS_TIMEOUT'
  );
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(1000))'], { timeoutMs: 1000, maxOutputBytes: 32 }),
    (error) => error.code === 'PROCESS_OUTPUT_LIMIT'
  );
});

test('returns a transcript and removes the generated upload directory', async () => {
  let uploadDirectory;
  let received;
  await withServer(routerWith(async (options) => {
    uploadDirectory = path.dirname(options.inputPath);
    received = { contents: await fs.readFile(options.inputPath, 'utf8'), mimeType: options.mimeType, language: options.language };
    return { text: 'یہ ایک ٹیسٹ ہے۔', language: 'ur' };
  }), async (url) => {
    const response = await fetch(url, { method: 'POST', body: createForm({ language: 'ur' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, text: 'یہ ایک ٹیسٹ ہے۔', language: 'ur' });
  });
  assert.deepEqual(received, { contents: 'test audio', mimeType: 'audio/webm', language: 'ur' });
  await assert.rejects(fs.access(uploadDirectory));
});

test('rejects missing, unsupported, invalid-language, and oversized audio', async () => {
  let calls = 0;
  await withServer(routerWith(async () => { calls += 1; return { text: 'unexpected' }; }), async (url) => {
    const missing = await fetch(url, { method: 'POST', body: createForm({ includeAudio: false }) });
    assert.equal(missing.status, 400);

    const unsupported = await fetch(url, { method: 'POST', body: createForm({ type: 'application/octet-stream' }) });
    assert.equal(unsupported.status, 415);

    const badLanguage = await fetch(url, { method: 'POST', body: createForm({ language: 'fr' }) });
    assert.equal(badLanguage.status, 400);

    const tooLarge = await fetch(url, {
      method: 'POST',
      body: createForm({ audio: Buffer.alloc(MAX_AUDIO_BYTES + 1) }),
    });
    assert.equal(tooLarge.status, 413);
  });
  assert.equal(calls, 0);
});

test('rejects concurrent inference and allows the first request to finish', async () => {
  let started;
  const didStart = new Promise((resolve) => { started = resolve; });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  await withServer(routerWith(async () => {
    started();
    await blocked;
    return { text: 'done' };
  }), async (url) => {
    const first = fetch(url, { method: 'POST', body: createForm() });
    await didStart;
    const second = await fetch(url, { method: 'POST', body: createForm() });
    assert.equal(second.status, 503);
    release();
    const firstResponse = await first;
    assert.equal(firstResponse.status, 200);
  });
});

test('cleans the generated upload directory after an inference error', async () => {
  let uploadDirectory;
  await withServer(routerWith(async (options) => {
    uploadDirectory = path.dirname(options.inputPath);
    throw new TranscriptionError('PROCESS_FAILED', 'Local audio processing failed.', 422);
  }), async (url) => {
    const response = await fetch(url, { method: 'POST', body: createForm() });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: 'Local audio processing failed.' });
  });
  await assert.rejects(fs.access(uploadDirectory));
});

test('locally transcribes the existing English test audio when installed tools are present', async (t) => {
  const paths = getToolPaths();
  const audioPath = process.env.HISABBOT_WHISPER_TEST_AUDIO;
  const mimeType = process.env.HISABBOT_WHISPER_TEST_MIME || 'audio/webm';
  if (!audioPath) {
    t.skip('Set HISABBOT_WHISPER_TEST_AUDIO to a local WebM/OGG/MP4 test recording to run the installed-model integration test.');
    return;
  }
  try {
    await Promise.all([paths.whisper, paths.model, paths.ffmpeg, paths.ffprobe, audioPath].map((file) => fs.access(file)));
  } catch {
    t.skip('Verified local Whisper/FFmpeg assets are not available on this machine.');
    return;
  }

  const result = await transcribeAudio({ inputPath: audioPath, mimeType, language: 'en' });
  assert.match(result.text, /fellow Americans/i);
  assert.equal(result.language, undefined);
});

test('POST /api/transcribe uses the installed local pipeline when a test clip is supplied', async (t) => {
  const audioPath = process.env.HISABBOT_WHISPER_TEST_AUDIO;
  if (!audioPath) {
    t.skip('Set HISABBOT_WHISPER_TEST_AUDIO to a local WebM/OGG/MP4 test recording to run the route integration test.');
    return;
  }
  const bytes = await fs.readFile(audioPath);
  const mimeType = process.env.HISABBOT_WHISPER_TEST_MIME || 'audio/webm';
  await withServer(createTranscriptionRouter(), async (url) => {
    const form = new FormData();
    form.append('audio', new Blob([bytes], { type: mimeType }), 'fixture with spaces.webm');
    form.append('language', 'en');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.language, undefined);
    assert.match(result.text, /fellow Americans/i);
  });
});

test('rejects actual audio longer than 30 seconds before inference', async (t) => {
  const audioPath = process.env.HISABBOT_WHISPER_LONG_TEST_AUDIO;
  if (!audioPath) {
    t.skip('Set HISABBOT_WHISPER_LONG_TEST_AUDIO to a local supported audio file longer than 30 seconds.');
    return;
  }
  const bytes = await fs.readFile(audioPath);
  await withServer(createTranscriptionRouter(), async (url) => {
    const form = new FormData();
    form.append('audio', new Blob([bytes], { type: 'audio/webm' }), 'long-recording.webm');
    form.append('language', 'en');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /30 seconds/i);
  });
});

test('rejects malformed audio bytes during real local probing', async (t) => {
  const paths = getToolPaths();
  try {
    await Promise.all([paths.whisper, paths.model, paths.ffmpeg, paths.ffprobe].map((file) => fs.access(file)));
  } catch {
    t.skip('Installed local Whisper and FFmpeg tools are not available on this machine.');
    return;
  }
  await withServer(createTranscriptionRouter(), async (url) => {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('not an audio container')], { type: 'audio/webm' }), 'broken.webm');
    form.append('language', 'auto');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 415);
    assert.match((await response.json()).error, /audio/i);
  });
});

test('rejects audio whose bytes are not a supported browser container', async (t) => {
  const audioPath = process.env.HISABBOT_WHISPER_SPOOF_TEST_AUDIO;
  if (!audioPath) {
    t.skip('Set HISABBOT_WHISPER_SPOOF_TEST_AUDIO to a local supported file with a different container.');
    return;
  }
  const bytes = await fs.readFile(audioPath);
  await withServer(createTranscriptionRouter(), async (url) => {
    const form = new FormData();
    form.append('audio', new Blob([bytes], { type: 'audio/webm' }), 'spoofed.webm');
    form.append('language', 'auto');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 415);
    assert.match((await response.json()).error, /format/i);
  });
});
