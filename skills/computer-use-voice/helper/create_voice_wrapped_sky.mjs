import { performance } from "node:perf_hooks";

export const VOICE_WRAPPER_VERSION = "voice-wrapper-warning-gate-v2";
export const VOICE_WRAPPER_MARKER = Symbol.for(
  "computer_use_voice_wrapper.marker",
);
export const MIN_WARNING_GATE_MS = 2000;
export const WARNING_GATE_SAFETY_MARGIN_MS = 100;
export const DEFAULT_NOTIFIER_TIMEOUT_MS = 10000;

const CONTROL_METHODS = new Set([
  "launch_app",
  "activate_window",
  "click",
  "type_text",
  "press_key",
  "scroll",
  "drag",
  "set_value",
  "perform_secondary_action",
]);
const wrapperRecords = new WeakMap();

function markerOf(value) {
  try {
    return value?.[VOICE_WRAPPER_MARKER] ?? null;
  } catch {
    return null;
  }
}

export function isVoiceWrappedSky(value) {
  const marker = markerOf(value);
  return marker?.kind === "computer-use-voice-wrapper" && marker?.version === VOICE_WRAPPER_VERSION;
}

export function getOriginalSky(value) {
  return wrapperRecords.get(value)?.originalSky ?? null;
}

function now() {
  return performance.timeOrigin + performance.now();
}

function timelineSnapshot(record) {
  return Object.freeze({
    warning_requested: record.timeline.warning_requested,
    warning_started: record.timeline.warning_started,
    audio_playback_started: record.timeline.audio_playback_started,
    audio_playback_finished: record.timeline.audio_playback_finished,
    warning_gate_finished: record.timeline.warning_gate_finished,
    computer_use_runtime_entered: record.timeline.computer_use_runtime_entered,
    first_control_action_requested: record.timeline.first_control_action_requested,
    first_control_action_executed: record.timeline.first_control_action_executed,
    warning_failed: record.timeline.warning_failed,
  });
}

function mark(record, field) {
  if (record.timeline[field] !== null) return;
  const stamp = Object.freeze({ monotonic_ms: now(), wall_utc: new Date().toISOString() });
  record.timeline[field] = stamp;
  try {
    record.timelineSink?.(timelineSnapshot(record));
  } catch {
    // A diagnostic sink must never affect the control path.
  }
}

function markAt(record, field, monotonicMs, wallUtc) {
  if (record.timeline[field] !== null) return;
  const stamp = Object.freeze({ monotonic_ms: monotonicMs, wall_utc: wallUtc });
  record.timeline[field] = stamp;
  try {
    record.timelineSink?.(timelineSnapshot(record));
  } catch {
    // A diagnostic sink must never affect the control path.
  }
}

function isNotifierSuccess(result) {
  return result === true || result?.success === true;
}

function gateError(cause) {
  const error = new Error("WARNING_GATE_FAILED");
  error.name = "WarningGateError";
  error.cause = cause;
  return error;
}

function delay(ms) {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("NOTIFIER_TIMEOUT"));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function getVoiceWrapperState(value) {
  const record = wrapperRecords.get(value);
  if (!record) return null;
  return Object.freeze({
    announced: record.warningState === "passed",
    warning_state: record.warningState,
    announcement_pending: record.warningPromise !== null,
    control_action_count: record.controlActionCount,
    notifier_call_count: record.notifierCallCount,
    warning_gate_source: record.warningGateSource,
    warning_gate_ms: record.minWarningGateMs,
    version: VOICE_WRAPPER_VERSION,
  });
}

export function getWarningGateTimeline(value) {
  const record = wrapperRecords.get(value);
  return record ? timelineSnapshot(record) : null;
}

export function createVoiceWrappedSky(originalSky, notifier, options = {}) {
  if ((typeof originalSky !== "object" && typeof originalSky !== "function") || originalSky === null) {
    throw new TypeError("originalSky must be an object");
  }
  if (typeof notifier !== "function") throw new TypeError("notifier must be a function");
  if (isVoiceWrappedSky(originalSky)) return originalSky;

  const marker = Object.freeze({ kind: "computer-use-voice-wrapper", version: VOICE_WRAPPER_VERSION });
  const facade = Object.create(null);
  Object.defineProperty(facade, VOICE_WRAPPER_MARKER, {
    configurable: false,
    enumerable: false,
    value: marker,
    writable: false,
  });
  const record = {
    originalSky,
    warningState: "idle",
    warningPromise: null,
    warningError: null,
    warningGateSource: null,
    controlActionCount: 0,
    notifierCallCount: 0,
    minWarningGateMs: Number.isFinite(options.minWarningGateMs) ? Math.max(MIN_WARNING_GATE_MS, options.minWarningGateMs) : MIN_WARNING_GATE_MS,
    notifierTimeoutMs: Number.isFinite(options.notifierTimeoutMs)
      ? Math.max(1, options.notifierTimeoutMs)
      : DEFAULT_NOTIFIER_TIMEOUT_MS,
    timelineSink: typeof options.timelineSink === "function" ? options.timelineSink : null,
    timeline: {
      warning_requested: null,
      warning_started: null,
      audio_playback_started: null,
      audio_playback_finished: null,
      warning_gate_finished: null,
      computer_use_runtime_entered: null,
      first_control_action_requested: null,
      first_control_action_executed: null,
      warning_failed: null,
    },
  };

  async function announceOnce() {
    if (record.warningState === "passed") return;
    if (record.warningState === "failed") throw record.warningError;
    if (record.warningPromise === null) {
      record.warningPromise = (async () => {
        mark(record, "warning_requested");
        mark(record, "warning_started");
        const started = record.timeline.warning_started.monotonic_ms;
        try {
          record.notifierCallCount += 1;
          const result = await withTimeout(
            notifier({
              onEvent(eventName) {
                if (eventName === "audio_playback_started") {
                  mark(record, "audio_playback_started");
                } else if (eventName === "audio_playback_finished") {
                  mark(record, "audio_playback_finished");
                }
              },
            }),
            record.notifierTimeoutMs,
          );
          if (!isNotifierSuccess(result)) throw new Error("NOTIFIER_UNSUCCESSFUL");
          if (record.timeline.audio_playback_started === null) {
            throw new Error("AUDIO_PLAYBACK_START_NOT_CONFIRMED");
          }
          if (record.timeline.audio_playback_finished === null) {
            throw new Error("AUDIO_PLAYBACK_FINISH_NOT_CONFIRMED");
          }
          await delay(record.minWarningGateMs + WARNING_GATE_SAFETY_MARGIN_MS - (now() - started));
          mark(record, "warning_gate_finished");
          record.warningGateSource = "native-notifier-v1";
          record.warningState = "passed";
        } catch (cause) {
          record.warningState = "failed";
          record.warningError = gateError(cause);
          mark(record, "warning_failed");
          throw record.warningError;
        }
      })().finally(() => {
        record.warningPromise = null;
      });
    }
    await record.warningPromise;
  }

  const wrappedSky = new Proxy(facade, {
    get(_target, property) {
      if (property === VOICE_WRAPPER_MARKER) return marker;
      const value = Reflect.get(originalSky, property, originalSky);
      if (typeof value !== "function") return value;
      if (!CONTROL_METHODS.has(String(property))) {
        return (...args) => Reflect.apply(value, originalSky, args);
      }
      return async (...args) => {
        mark(record, "first_control_action_requested");
        await announceOnce();
        mark(record, "computer_use_runtime_entered");
        mark(record, "first_control_action_executed");
        record.controlActionCount += 1;
        return Reflect.apply(value, originalSky, args);
      };
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === VOICE_WRAPPER_MARKER) return Reflect.getOwnPropertyDescriptor(target, property);
      const descriptor = Reflect.getOwnPropertyDescriptor(originalSky, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf() { return Reflect.getPrototypeOf(originalSky); },
    has(_target, property) { return property === VOICE_WRAPPER_MARKER || Reflect.has(originalSky, property); },
    ownKeys() { return [...new Set([...Reflect.ownKeys(originalSky), VOICE_WRAPPER_MARKER])]; },
    set(_target, property, value) { return Reflect.set(originalSky, property, value, originalSky); },
  });

  wrapperRecords.set(wrappedSky, record);
  return wrappedSky;
}

export function acceptExternalWarningGateEvidence(value, evidence) {
  const record = wrapperRecords.get(value);
  if (!record) throw new TypeError("value must be a voice-wrapped sky object");
  if (record.warningState === "failed") throw record.warningError;
  if (record.warningState === "passed") return false;
  if (record.warningPromise !== null) throw gateError(new Error("WARNING_GATE_ALREADY_PENDING"));

  const warningToAudioStartMs = Number(evidence?.warning_to_audio_start_ms);
  const warningToAudioFinishMs = Number(evidence?.warning_to_audio_finish_ms);
  const warningGateMs = Number(evidence?.warning_gate_ms);
  const source = evidence?.source;
  if (source !== "plugin-pretool-warning-gate-v1" ||
      !Number.isFinite(warningToAudioStartMs) || warningToAudioStartMs <= 0 ||
      !Number.isFinite(warningToAudioFinishMs) || warningToAudioFinishMs < warningToAudioStartMs ||
      !Number.isFinite(warningGateMs) || warningGateMs < MIN_WARNING_GATE_MS ||
      warningGateMs < warningToAudioFinishMs) {
    record.warningState = "failed";
    record.warningError = gateError(new Error("EXTERNAL_WARNING_GATE_EVIDENCE_INVALID"));
    mark(record, "warning_failed");
    throw record.warningError;
  }

  const gateFinishedMonotonic = now();
  const warningStartedMonotonic = gateFinishedMonotonic - warningGateMs;
  const gateFinishedWallMs = Date.now();
  const warningStartedWallMs = gateFinishedWallMs - warningGateMs;
  const wallAt = (offsetMs) => new Date(warningStartedWallMs + offsetMs).toISOString();
  markAt(record, "warning_requested", warningStartedMonotonic, wallAt(0));
  markAt(record, "warning_started", warningStartedMonotonic, wallAt(0));
  markAt(record, "audio_playback_started", warningStartedMonotonic + warningToAudioStartMs, wallAt(warningToAudioStartMs));
  markAt(record, "audio_playback_finished", warningStartedMonotonic + warningToAudioFinishMs, wallAt(warningToAudioFinishMs));
  markAt(record, "warning_gate_finished", gateFinishedMonotonic, wallAt(warningGateMs));
  record.warningGateSource = source;
  record.warningState = "passed";
  return true;
}

export const CONTROL_METHOD_ALLOWLIST = Object.freeze([...CONTROL_METHODS]);
