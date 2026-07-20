/**
 * Simple file-backed logger. Messages are also mirrored to the renderer via an optional sink.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Logger {
  constructor() {
    this._listeners = new Set();
    this._buffer = [];
    this._maxBuffer = 200;
    this._filePath = null;
  }

  init() {
    const dir = app.getPath('userData');
    this._filePath = path.join(dir, 'git-push-notifier.log');
  }

  onLog(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getRecent(limit = 100) {
    return this._buffer.slice(-limit);
  }

  debug(message, meta) {
    this._write('debug', message, meta);
  }

  info(message, meta) {
    this._write('info', message, meta);
  }

  warn(message, meta) {
    this._write('warn', message, meta);
  }

  error(message, meta) {
    this._write('error', message, meta);
  }

  _write(level, message, meta) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message: String(message),
      meta: meta || null,
    };

    this._buffer.push(entry);
    if (this._buffer.length > this._maxBuffer) {
      this._buffer.shift();
    }

    const line = `[${entry.ts}] ${level.toUpperCase()} ${entry.message}${
      meta ? ` ${JSON.stringify(meta)}` : ''
    }`;

    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level]?.(line) ?? console.log(line);

    if (this._filePath) {
      try {
        fs.appendFileSync(this._filePath, `${line}\n`, 'utf8');
      } catch {
        // Avoid recursive logging failures
      }
    }

    for (const listener of this._listeners) {
      try {
        listener(entry);
      } catch {
        // ignore listener errors
      }
    }
  }
}

module.exports = new Logger();
