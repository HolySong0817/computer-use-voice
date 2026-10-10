import assert from "node:assert/strict";
import {
  EXPECTED_SKY_METHODS,
  disposeVoiceWrappedSky,
  getVoiceHelperState,
  installGlobalSkyWarningGate,
  loadOfficialSky,
} from "../skills/computer-use-voice/helper/initialize_voice_wrapped_sky.mjs";

const outcomes = [];
async function test(name, fn) {
  try {
    await fn();
    outcomes.push({ name, status: "PASS" });
  } catch (error) {
    outcomes.push({ name, status: "FAIL", error_type: error?.constructor?.name, error_message: error?.message });
  }
}

function completeSky() {
  const calls = [];
  const sky = { target: "windows" };
  for (const name of EXPECTED_SKY_METHODS) {
    sky[name] = async (...args) => {
      calls.push({ method_name: name, args });
      return name;
    };
  }
  return { calls, sky };
}

function identity() {
  return {
    discovery_method: "offline-test",
    package_name: "@oai/sky",
    package_version: "0.6.6",
    runtime_id: "0123456789abcdef",
  };
}

const evidence = Object.freeze({
  source: "plugin-pretool-warning-gate-v1",
  warning_to_audio_start_ms: 20,
  warning_to_audio_finish_ms: 2300,
  warning_gate_ms: 2400,
});

await test("global_sky_is_wrapped_and_reused", async () => {
  const globals = {};
  const fake = completeSky();
  let notifierCalls = 0;
  const loadSky = async () => ({ identity: identity(), officialSky: fake.sky, resolvedSpecifier: "@oai/sky" });
  const first = await installGlobalSkyWarningGate({
    globals,
    externalWarningGate: evidence,
    loadSky,
    notifier: async () => { notifierCalls += 1; return { success: false }; },
  });
  assert.notEqual(globals.sky, fake.sky);
  assert.equal(globals.sky, globals.voiceWrappedSky);
  const second = await installGlobalSkyWarningGate({ globals, externalWarningGate: evidence, loadSky });
  assert.equal(second.reused, true);
  assert.equal(second.voiceWrappedSky, first.voiceWrappedSky);
  await globals.sky.click({ x: 1, y: 1 });
  assert.equal(notifierCalls, 0);
  assert.equal(fake.calls.length, 1);
  const state = getVoiceHelperState({ globals });
  assert.equal(state.global_sky_is_wrapped, true);
  assert.equal(state.official_sky_is_global_sky, false);
  assert.equal(state.warning_gate_state.warning_state, "passed");
  globals.sky = fake.sky;
  assert.equal(globals.sky, first.voiceWrappedSky);
  assert.throws(() => { globals.sky = completeSky().sky; }, /GLOBAL_SKY_REPLACEMENT_BLOCKED/);
  const disposed = disposeVoiceWrappedSky({ globals });
  assert.equal(disposed.removed_state, true);
  assert.equal("sky" in globals, false);
});

await test("local_module_reload_rebinds_validated_wrapper_and_evidence", async () => {
  const globals = {};
  const fake = completeSky();
  const oldFactory = await import(
    "../skills/computer-use-voice/helper/create_voice_wrapped_sky.mjs?simulated_node_repl_exec=old"
  );
  const oldWrapper = oldFactory.createVoiceWrappedSky(
    fake.sky,
    async () => ({ success: false }),
  );
  Object.defineProperty(globals, "sky", {
    configurable: true,
    enumerable: true,
    value: oldWrapper,
    writable: true,
  });
  Object.defineProperty(globals, "voiceWrappedSky", {
    configurable: true,
    enumerable: false,
    value: oldWrapper,
    writable: true,
  });
  Object.defineProperty(
    globals,
    Symbol.for("computer_use_voice_wrapper.helper_state.v2"),
    {
      configurable: true,
      enumerable: false,
      value: {
        identity: identity(),
        officialSky: fake.sky,
        priorDescriptor: null,
        version: oldFactory.VOICE_WRAPPER_VERSION,
        voiceWrappedSky: oldWrapper,
      },
      writable: true,
    },
  );

  const rebound = await installGlobalSkyWarningGate({
    globals,
    externalWarningGate: evidence,
    loadSky: async () => ({ identity: identity(), officialSky: fake.sky, resolvedSpecifier: "@oai/sky" }),
  });
  assert.equal(rebound.reused, false);
  assert.equal(rebound.rebound_after_local_module_reload, true);
  assert.notEqual(rebound.voiceWrappedSky, oldWrapper);
  assert.equal(globals.sky, rebound.voiceWrappedSky);
  await globals.sky.launch_app({ app: "fake-offline-app" });
  assert.equal(fake.calls.length, 1);
  const state = getVoiceHelperState({ globals });
  assert.equal(state.warning_gate_state.warning_state, "passed");
  assert.equal(state.warning_gate_state.notifier_call_count, 0);
  assert.ok(state.warning_gate_timeline.first_control_action_executed);
});

await test("local_module_reload_official_sky_mismatch_fails_closed", async () => {
  const globals = {};
  const oldFake = completeSky();
  const newFake = completeSky();
  const oldFactory = await import(
    "../skills/computer-use-voice/helper/create_voice_wrapped_sky.mjs?simulated_node_repl_exec=mismatch"
  );
  const oldWrapper = oldFactory.createVoiceWrappedSky(
    oldFake.sky,
    async () => ({ success: false }),
  );
  globals.sky = oldWrapper;
  globals.voiceWrappedSky = oldWrapper;
  globals[Symbol.for("computer_use_voice_wrapper.helper_state.v2")] = {
    identity: identity(),
    officialSky: oldFake.sky,
    priorDescriptor: null,
    version: oldFactory.VOICE_WRAPPER_VERSION,
    voiceWrappedSky: oldWrapper,
  };
  await assert.rejects(
    () => installGlobalSkyWarningGate({
      globals,
      externalWarningGate: evidence,
      loadSky: async () => ({ identity: identity(), officialSky: newFake.sky, resolvedSpecifier: "@oai/sky" }),
    }),
    /OFFICIAL_RUNTIME_DISCOVERY_RELOADED_OFFICIAL_SKY_IDENTITY_MISMATCH/,
  );
  assert.equal(oldFake.calls.length, 0);
  assert.equal(newFake.calls.length, 0);
});

await test("existing_global_sky_is_restored_on_dispose", async () => {
  const prior = { prior: true };
  const globals = { sky: prior };
  const fake = completeSky();
  await installGlobalSkyWarningGate({
    globals,
    externalWarningGate: evidence,
    loadSky: async () => ({ identity: identity(), officialSky: fake.sky, resolvedSpecifier: "@oai/sky" }),
  });
  disposeVoiceWrappedSky({ globals });
  assert.equal(globals.sky, prior);
});

await test("module_export_fingerprint_is_enforced", async () => {
  const fake = completeSky();
  await assert.rejects(
    () => loadOfficialSky({
      resolveModule: async () => "@oai/sky",
      importModule: async () => ({ extra: true, sky: fake.sky }),
      discoverIdentity: async () => identity(),
    }),
    /OFFICIAL_RUNTIME_DISCOVERY_MODULE_EXPORTS_INVALID/,
  );
});

await test("complete_method_fingerprint_is_enforced", async () => {
  const fake = completeSky();
  delete fake.sky.drag;
  await assert.rejects(
    () => loadOfficialSky({
      resolveModule: async () => "@oai/sky",
      importModule: async () => ({ sky: fake.sky }),
      discoverIdentity: async () => identity(),
    }),
    /OFFICIAL_RUNTIME_DISCOVERY_SKY_API_INVALID/,
  );
});

await test("package_identity_is_enforced", async () => {
  const fake = completeSky();
  await assert.rejects(
    () => loadOfficialSky({
      resolveModule: async () => "@oai/sky",
      importModule: async () => ({ sky: fake.sky }),
      discoverIdentity: async () => ({ package_name: "other", package_version: "0.6.6" }),
    }),
    /OFFICIAL_RUNTIME_DISCOVERY_PACKAGE_IDENTITY_INVALID/,
  );
});

const failed = outcomes.filter((entry) => entry.status !== "PASS");
process.stdout.write(`${JSON.stringify({
  suite: "Global Wrapper Offline Tests",
  total: outcomes.length,
  passed: outcomes.length - failed.length,
  failed: failed.length,
  tests: outcomes,
  computer_use_triggered: false,
  notifier_process_triggered: false,
}, null, 2)}\n`);
process.exitCode = failed.length ? 1 : 0;
