'use strict';

const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const {
  MIME_EXTENSIONS,
  TranscriptionError,
  transcribeAudio,
  validateLanguage,
  normalizeMimeType,
} = require('../services/voiceTranscription');

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

function createTranscriptionRouter({ transcribe = transcribeAudio } = {}) {
  const router = express.Router();
  let busy = false;

  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        callback(null, req.transcriptionUploadDir);
      },
      filename(req, file, callback) {
        const extension = MIME_EXTENSIONS.get(normalizeMimeType(file.mimetype));
        callback(null, `recording${extension || '.upload'}`);
      },
    }),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 1, fieldSize: 64, parts: 2 },
    fileFilter(req, file, callback) {
      if (!MIME_EXTENSIONS.has(normalizeMimeType(file.mimetype))) {
        callback(new TranscriptionError('UNSUPPORTED_AUDIO', 'This audio format is not supported. Use a browser recording in WebM, Ogg, or MP4 format.', 415));
        return;
      }
      callback(null, true);
    },
  }).single('audio');

  router.post('/', async (req, res) => {
    if (busy) {
      return res.status(503).json({ error: 'Local transcription is busy. Please try again shortly.' });
    }
    busy = true;

    let uploadDir;
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      if (uploadDir) await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      busy = false;
    };

    const controller = new AbortController();
    const abortIfDisconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', abortIfDisconnected);

    const respondError = (error) => {
      if (error instanceof multer.MulterError) {
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        const message = error.code === 'LIMIT_FILE_SIZE'
          ? 'Audio uploads must be 10 MB or smaller.'
          : 'Upload one supported audio recording only.';
        return { status, body: { error: message } };
      }
      if (error instanceof TranscriptionError) {
        if (error.status >= 500 && error.status !== 503 && error.status !== 504 && error.status !== 499) {
          console.error('POST /api/transcribe failed:', error.code);
        }
        return { status: error.status, body: { error: error.message } };
      }
      console.error('POST /api/transcribe failed: unexpected error', error?.name || 'unknown');
      return { status: 500, body: { error: 'Local transcription could not be completed.' } };
    };

    try {
      uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hisabbot-upload-'));
      req.transcriptionUploadDir = uploadDir;
      upload(req, res, async (uploadError) => {
        let response;
        try {
          if (uploadError instanceof multer.MulterError || uploadError instanceof TranscriptionError) {
            throw uploadError;
          }
          if (uploadError) {
            throw new TranscriptionError('MALFORMED_UPLOAD', 'Malformed audio upload. Please record again and retry.', 400);
          }
          if (!req.file || !req.file.size) {
            throw new TranscriptionError('MISSING_AUDIO', 'An audio recording is required.', 400);
          }

          const language = validateLanguage(req.body?.language);
          const result = await transcribe({
            inputPath: req.file.path,
            mimeType: req.file.mimetype,
            language,
            signal: controller.signal,
            tempRoot: uploadDir,
          });
          response = {
            status: 200,
            body: {
              success: true,
              text: result.text,
              ...(result.language ? { language: result.language } : {}),
            },
          };
        } catch (error) {
          response = respondError(error);
        } finally {
          res.removeListener('close', abortIfDisconnected);
          await cleanup();
          if (response && !res.destroyed && !res.writableEnded) {
            res.status(response.status).json(response.body);
          }
        }
      });
    } catch (error) {
      res.removeListener('close', abortIfDisconnected);
      await cleanup();
      const response = respondError(error);
      if (!res.destroyed && !res.writableEnded) res.status(response.status).json(response.body);
    }
  });

  return router;
}

module.exports = { MAX_AUDIO_BYTES, createTranscriptionRouter };
