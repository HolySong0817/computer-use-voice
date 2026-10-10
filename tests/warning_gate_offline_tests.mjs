import assert from "node:assert/strict";
import {
  CONTROL_METHOD_ALLOWLIST,
  acceptExternalWarningGateEvidence,
  createVoiceWrappedSky,
  getWarningGateTimeline,
  getVoiceWrapperState,
} from "../skills/computer-use-voice/helper/create_voice_wrapped_sky.mjs";

const OBSERVATION_METHODS = ["get_window", "get_window_state", "list_apps", "list_windows"];
const outcomes = [];

async function test(name, fn) {
  try {
    await fn();
    outcomes.push({ name, status: "PASS" });
  } catch (error) {
    outcomes.push({
      name,
      status: "FAIL",
      error_type: error?.constructor?.name ?? "Error",
      error_message: error?.message ?? null,
    });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeSky({ throwMethod = null } = {}) {
  const calls = [];
  const sky = { target: "windows" };
  for (const name of [...CONTROL_METHOD_ALLOWLIST, ...OBSERVATION_METHODS]) {
    sky[name] = async (...args) => {
      calls.push({ method_name: name, args });
      if (name === throwMethod) throw new Error("ORIGINAL_SKY_FAILURE");
      return name;
    };
  }
  return { calls, sky };
}

async function successfulNotifier({ onEvent }) {
  await delay(5);
  onEvent("audio_playback_started");
  await delay(5);
  onEvent("audio_playback_finished");
  return { success: true };
}

await test("all_controls_share_one_gate_and_observations_are_silent", async () => {
  const fake = fakeSky();
  let notifierCalls = 0;
  const wrapped = createVoiceWrappedSky(fake.sky, async (context) => {
    notifierCalls += 1;
    return successfulNotifier(context);
  });
  for (const method of OBSERVATION_METHODS) await wrapped[method]({});
  assert.equal(notifierCalls, 0);
  for (const method of CONTROL_METHOD_ALLOWLIST) await wrapped[method]({});
  assert.equal(notifierCalls, 1);
  assert.deepEqual(
    fake.calls.map((entry) => entry.method_name),
    [...OBSERVATION_METHODS, ...CONTROL_METHOD_ALLOWLIST],
  );
  const state = getVoiceWrapperState(wrapped);
  assert.equal(state.control_action_count, CONTROL_METHOD_ALLOWLIST.length);
  assert.equal(state.warning_gate_source, "native-notifier-v1");
  const timeline = getWarningGateTimeline(wrapped);
  assert.ok(timeline.warning_started.monotonic_ms < timeline.audio_playback_started.monotonic_ms);
  assert.ok(timeline.audio_playback_started.monotonic_ms <= timeline.audio_playback_finished.monotonic_ms);
  assert.ok(timeline.audio_playback_finished.monotonic_ms <= timeline.warning_gate_finished.monotonic_ms);
  assert.ok(timeline.warning_gate_finished.monotonic_ms <= timeline.computer_use_runtime_entered.monotonic_ms);
  assert.ok(timeline.computer_use_runtime_entered.monotonic_ms <= timeline.first_control_action_executed.monotonic_ms);
  assert.ok(timeline.warning_gate_finished.monotonic_ms - timeline.warning_started.monotonic_ms >= 2000);
});

await test("concurrent_first_controls_share_one_pending_gate", async () => {
  const fake = fakeSky();
  let notifierCalls = 0;
  const wrapped = createVoiceWrappedSky(fake.sky, async (context) => {
    notifierCalls += 1;
    return successfulNotifier(context);
  });
  await Promise.all([
    wrapped.launch_app({}),
    wrapped.click({}),
    wrapped.scroll({}),
  ]);
  assert.equal(notifierCalls, 1);
  assert.equal(fake.calls.length, 3);
});

for (const failure of [
  {
    name: "notifier_unavailable",
    notifier: async () => { throw new Error("NOTIFIER_UNAVAILABLE"); },
  },
  {
    name: "notifier_nonzero",
    notifier: async () => ({ success: false, exit_code: 9 }),
  },
  {
    name: "audio_playback_failure",
    notifier: async ({ onEvent }) => {
      onEvent("audio_playback_started");
      return { success: false };
    },
  },
  {
    name: "helper_timeout",
    notifier: async () => new Promise(() => {}),
    options: { notifierTimeoutMs: 25 },
  },
]) {
  await test(`${failure.name}_is_fail_closed`, async () => {
    const fake = fakeSky();
    const wrapped = createVoiceWrappedSky(fake.sky, failure.notifier, failure.options);
    await assert.rejects(
      () => wrapped.launch_app({ app: "mspaint.exe" }),
      (error) => error?.message === "WARNING_GATE_FAILED",
    );
    assert.equal(fake.calls.length, 0);
    assert.equal(getVoiceWrapperState(wrapped).control_action_count, 0);
    assert.equal(getVoiceWrapperState(wrapped).warning_state, "failed");
  });
}

await test("failed_gate_cannot_be_retried_or_bypassed", async () => {
  const fake = fakeSky();
  let notifierCalls = 0;
  const wrapped = createVoiceWrappedSky(fake.sky, async () => {
    notifierCalls += 1;
    return { success: false };
  });
  await assert.rejects(() => wrapped.click({}), /WARNING_GATE_FAILED/);
  await assert.rejects(() => wrapped.press_key({}), /WARNING_GATE_FAILED/);
  assert.equal(notifierCalls, 1);
  assert.equal(fake.calls.length, 0);
});

await test("validated_pretool_evidence_avoids_duplicate_audio", async () => {
  const fake = fakeSky();
  let notifierCalls = 0;
  const wrapped = createVoiceWrappedSky(fake.sky, async () => {
    notifierCalls += 1;
    return { success: false };
  });
  assert.equal(acceptExternalWarningGateEvidence(wrapped, {
    source: "plugin-pretool-warning-gate-v1",
    warning_to_audio_start_ms: 12,
    warning_to_audio_finish_ms: 2450,
    warning_gate_ms: 2500,
  }), true);
  await wrapped.activate_window({});
  assert.equal(notifierCalls, 0);
  assert.equal(fake.calls.length, 1);
  const timeline = getWarningGateTimeline(wrapped);
  assert.ok(timeline.warning_started.monotonic_ms < timeline.audio_playback_started.monotonic_ms);
  assert.ok(timeline.audio_playback_finished.monotonic_ms <= timeline.warning_gate_finished.monotonic_ms);
  assert.ok(timeline.warning_gate_finished.monotonic_ms <= timeline.computer_use_runtime_entered.monotonic_ms);
  assert.ok(timeline.computer_use_runtime_entered.monotonic_ms <= timeline.first_control_action_executed.monotonic_ms);
  assert.ok(timeline.warning_gate_finished.monotonic_ms - timeline.warning_started.monotonic_ms >= 2000);
  assert.equal(getVoiceWrapperState(wrapped).warning_gate_source, "plugin-pretool-warning-gate-v1");
});

await test("invalid_pretool_evidence_fails_closed", async () => {
  const fake = fakeSky();
  const wrapped = createVoiceWrappedSky(fake.sky, successfulNotifier);
  assert.throws(() => acceptExternalWarningGateEvidence(wrapped, {
    source: "plugin-pretool-warning-gate-v1",
    warning_to_audio_start_ms: 10,
    warning_to_audio_finish_ms: 1900,
    warning_gate_ms: 1900,
  }), /WARNING_GATE_FAILED/);
  await assert.rejects(() => wrapped.click({}), /WARNING_GATE_FAILED/);
  assert.equal(fake.calls.length, 0);
});

await test("original_control_error_propagates_only_after_gate", async () => {
  const fake = fakeSky({ throwMethod: "launch_app" });
  const wrapped = createVoiceWrappedSky(fake.sky, successfulNotifier);
  await assert.rejects(() => wrapped.launch_app({}), /ORIGINAL_SKY_FAILURE/);
  assert.equal(fake.calls.length, 1);
  assert.equal(getVoiceWrapperState(wrapped).warning_state, "passed");
});

const failed = outcomes.filter((entry) => entry.status !== "PASS");
process.stdout.write(`${JSON.stringify({
  suite: "Warning Gate Offline Tests V2",
  total: outcomes.length,
  passed: outcomes.length - failed.length,
  failed: failed.length,
  tests: outcomes,
  computer_use_triggered: false,
  notifier_process_triggered: false,
}, null, 2)}\n`);
process.exitCode = failed.length ? 1 : 0;
