import { spawn as spawnFileEquivalent } from "node:child_process";
import { fileURLToPath } from "node:url";

export const FIXED_NOTIFIER_PATH = fileURLToPath(
  new URL("../../../native/computer_use_voice_notifier.exe", import.meta.url),
);
export const NOTIFIER_TIMEOUT_MS = 9000;
export const NOTIFIER_PROTOCOL_VERSION = 1;

const MAX_PROTOCOL_BYTES = 8192;
const EXPECTED_EVENTS = Object.freeze([
  "audio_playback_started",
  "audio_playback_finished",
]);

function result({
  success = false,
  timedOut = false,
  exitCode = null,
  error = null,
  events = [],
  protocolError = null,
} = {}) {
  return Object.freeze({
    attempted: true,
    success,
    timed_out: timedOut,
    exit_code: Number.isInteger(exitCode) ? exitCode : null,
    exception_type: error?.constructor?.name ?? null,
    protocol_error: protocolError,
    events: Object.freeze([...events]),
  });
}

function consumeProtocolLine(line, events, onEvent) {
  if (!line.trim()) return null;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return "INVALID_JSON";
  }
  if (message?.protocol_version !== NOTIFIER_PROTOCOL_VERSION) return "INVALID_PROTOCOL_VERSION";
  if (!EXPECTED_EVENTS.includes(message?.event)) return "UNEXPECTED_EVENT";
  if (events.includes(message.event)) return "DUPLICATE_EVENT";
  if (message.event !== EXPECTED_EVENTS[events.length]) return "EVENT_ORDER_INVALID";
  events.push(message.event);
  try {
    onEvent?.(message.event);
  } catch {
    return "EVENT_CALLBACK_FAILED";
  }
  return null;
}

async function runNotifier({ executablePath, timeoutMs, spawnImplementation, onEvent }) {
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawnImplementation(executablePath, [], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve(result({ error }));
      return;
    }

    let settled = false;
    let timedOut = false;
    let timeoutTimer = null;
    let stdoutBuffer = "";
    let stdoutBytes = 0;
    let protocolError = null;
    const events = [];

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve(value);
    };

    const consumeBufferedLines = (flush = false) => {
      const lines = stdoutBuffer.split(/\r?\n/);
      const trailing = lines.pop() ?? "";
      stdoutBuffer = flush ? "" : trailing;
      for (const line of lines) {
        if (protocolError) break;
        protocolError = consumeProtocolLine(line, events, onEvent);
      }
      if (flush && trailing.trim() && !protocolError) {
        protocolError = consumeProtocolLine(trailing, events, onEvent);
      }
    };

    child.stdout?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      if (protocolError) return;
      const text = String(chunk);
      stdoutBytes += Buffer.byteLength(text, "utf8");
      if (stdoutBytes > MAX_PROTOCOL_BYTES) {
        protocolError = "PROTOCOL_OUTPUT_TOO_LARGE";
        try { child.kill(); } catch { /* close event remains authoritative */ }
        return;
      }
      stdoutBuffer += text;
      consumeBufferedLines(false);
    });

    // Stderr is intentionally discarded. The helper returns only a bounded,
    // machine-readable result so no host or user data reaches diagnostics.
    child.stderr?.resume?.();
    child.once("error", (error) => finish(result({ error, timedOut, events, protocolError })));
    child.once("close", (code) => {
      consumeBufferedLines(true);
      const protocolComplete =
        !protocolError &&
        events.length === EXPECTED_EVENTS.length &&
        EXPECTED_EVENTS.every((eventName, index) => events[index] === eventName);
      finish(result({
        exitCode: code,
        success: !timedOut && code === 0 && protocolComplete,
        timedOut,
        events,
        protocolError: protocolError ?? (protocolComplete ? null : "PROTOCOL_INCOMPLETE"),
      }));
    });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      protocolError ??= "HELPER_TIMEOUT";
      try { child.kill(); } catch (error) {
        finish(result({ error, timedOut: true, events, protocolError }));
        return;
      }
      setTimeout(() => finish(result({ timedOut: true, events, protocolError })), 250);
    }, timeoutMs);
  });
}

export async function notifyBeforeControl({ onEvent } = {}) {
  return runNotifier({
    executablePath: FIXED_NOTIFIER_PATH,
    timeoutMs: NOTIFIER_TIMEOUT_MS,
    spawnImplementation: spawnFileEquivalent,
    onEvent,
  });
}

export async function __testOnlyRunNotifier({
  executablePath,
  timeoutMs = NOTIFIER_TIMEOUT_MS,
  spawnImplementation = spawnFileEquivalent,
  onEvent,
} = {}) {
  return runNotifier({ executablePath, timeoutMs, spawnImplementation, onEvent });
}
