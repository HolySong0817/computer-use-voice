import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONTROL_METHOD_ALLOWLIST,
  VOICE_WRAPPER_VERSION,
  acceptExternalWarningGateEvidence,
  createVoiceWrappedSky,
  getOriginalSky,
  getWarningGateTimeline,
  getVoiceWrapperState,
  isVoiceWrappedSky,
} from "./create_voice_wrapped_sky.mjs";
import { notifyBeforeControl } from "./notifier_client.mjs";

export const OFFICIAL_COMPUTER_USE_PACKAGE = "@oai/sky";
export const OBSERVATION_METHOD_ALLOWLIST = Object.freeze([
  "get_window",
  "get_window_state",
  "list_apps",
  "list_windows",
]);
export const EXPECTED_SKY_METHODS = Object.freeze([
  ...CONTROL_METHOD_ALLOWLIST,
  ...OBSERVATION_METHOD_ALLOWLIST,
].sort());

const HELPER_STATE = Symbol.for("computer_use_voice_wrapper.helper_state.v2");
const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function runtimeDiscoveryError(code) {
  const error = new Error(`OFFICIAL_RUNTIME_DISCOVERY_${code}`);
  error.name = "RuntimeDiscoveryError";
  return error;
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function requireRegularFile(filePath, fsImpl) {
  try {
    if (!(await fsImpl.stat(filePath)).isFile()) throw runtimeDiscoveryError("NOT_REGULAR_FILE");
  } catch (error) {
    if (error?.name === "RuntimeDiscoveryError") throw error;
    throw runtimeDiscoveryError("NOT_REGULAR_FILE");
  }
}

function packageEntryFromMetadata(metadata) {
  const exportEntry = typeof metadata?.exports === "string"
    ? metadata.exports
    : metadata?.exports?.["."];
  const mainEntry = metadata?.main;
  if (typeof exportEntry !== "string" || typeof mainEntry !== "string") {
    throw runtimeDiscoveryError("PACKAGE_ENTRY_MISSING");
  }
  if (exportEntry !== mainEntry && exportEntry !== `./${mainEntry}`) {
    throw runtimeDiscoveryError("PACKAGE_ENTRY_CONFLICT");
  }
  return exportEntry;
}

export async function discoverOfficialRuntimeIdentity({
  fsImpl = fs,
  homeDirectory = os.homedir(),
} = {}) {
  let homeRealPath;
  let runtimesRealPath;
  try {
    homeRealPath = await fsImpl.realpath(homeDirectory);
    runtimesRealPath = await fsImpl.realpath(path.join(
      homeRealPath,
      "AppData",
      "Local",
      "OpenAI",
      "Codex",
      "runtimes",
      "cua_node",
    ));
  } catch {
    throw runtimeDiscoveryError("RUNTIMES_ROOT_UNAVAILABLE");
  }
  if (!isWithinRoot(homeRealPath, runtimesRealPath)) {
    throw runtimeDiscoveryError("RUNTIMES_ROOT_OUTSIDE_HOME");
  }

  let runtimeDirectories;
  try {
    runtimeDirectories = await fsImpl.readdir(runtimesRealPath, { withFileTypes: true });
  } catch {
    throw runtimeDiscoveryError("RUNTIMES_ENUMERATION_FAILED");
  }

  const candidates = [];
  for (const directory of runtimeDirectories) {
    if (!directory.isDirectory() || !/^[0-9a-f]{8,64}$/i.test(directory.name)) continue;
    try {
      const runtimeRoot = await fsImpl.realpath(path.join(runtimesRealPath, directory.name));
      const packageRoot = await fsImpl.realpath(path.join(
        runtimeRoot,
        "bin",
        "node_modules",
        "@oai",
        "sky",
      ));
      const packageJsonPath = await fsImpl.realpath(path.join(packageRoot, "package.json"));
      if (!isWithinRoot(runtimesRealPath, runtimeRoot) ||
          !isWithinRoot(runtimeRoot, packageRoot) ||
          !isWithinRoot(packageRoot, packageJsonPath)) {
        continue;
      }
      await requireRegularFile(packageJsonPath, fsImpl);
      const packageStat = await fsImpl.stat(packageJsonPath);
      if (packageStat.size <= 0 || packageStat.size > 65536) continue;
      const metadata = JSON.parse(await fsImpl.readFile(packageJsonPath, "utf8"));
      if (metadata?.name !== OFFICIAL_COMPUTER_USE_PACKAGE ||
          !PACKAGE_VERSION_PATTERN.test(metadata?.version ?? "")) {
        continue;
      }
      const entryRelative = packageEntryFromMetadata(metadata);
      const entryRealPath = await fsImpl.realpath(path.resolve(packageRoot, entryRelative));
      if (!isWithinRoot(packageRoot, entryRealPath)) continue;
      await requireRegularFile(entryRealPath, fsImpl);
      candidates.push(Object.freeze({
        discovery_method: "codex-cua-runtime-package-metadata-and-realpath",
        package_name: metadata.name,
        package_version: metadata.version,
        runtime_id: directory.name,
        runtime_root: runtimeRoot,
        package_root: packageRoot,
        package_json_path: packageJsonPath,
        module_entry_path: entryRealPath,
      }));
    } catch {
      // Invalid or incomplete historical runtimes are not eligible candidates.
    }
  }

  if (candidates.length === 0) throw runtimeDiscoveryError("NO_VALID_RUNTIME_PACKAGE");
  if (candidates.length !== 1) throw runtimeDiscoveryError("AMBIGUOUS_RUNTIME_PACKAGE");
  return candidates[0];
}

function validateOfficialSkyModule(officialModule) {
  const moduleKeys = Object.keys(officialModule ?? {}).sort();
  if (moduleKeys.length !== 1 || moduleKeys[0] !== "sky") {
    throw runtimeDiscoveryError("MODULE_EXPORTS_INVALID");
  }
  const sky = officialModule.sky;
  if ((typeof sky !== "object" && typeof sky !== "function") || sky === null) {
    throw runtimeDiscoveryError("SKY_EXPORT_MISSING");
  }
  if (sky.target !== "windows") throw runtimeDiscoveryError("SKY_TARGET_INVALID");
  const methods = Object.keys(sky)
    .filter((name) => typeof sky[name] === "function")
    .sort();
  if (methods.length !== EXPECTED_SKY_METHODS.length ||
      !EXPECTED_SKY_METHODS.every((name, index) => methods[index] === name)) {
    throw runtimeDiscoveryError("SKY_API_INVALID");
  }
  return sky;
}

const defaultImportModule = (specifier) => import(specifier);

export async function loadOfficialSky({
  importModule = defaultImportModule,
  resolveModule = import.meta.resolve,
  discoverIdentity = discoverOfficialRuntimeIdentity,
} = {}) {
  let resolvedSpecifier;
  try {
    resolvedSpecifier = await resolveModule(OFFICIAL_COMPUTER_USE_PACKAGE);
  } catch {
    throw runtimeDiscoveryError("BARE_MODULE_RESOLVE_FAILED");
  }
  if (resolvedSpecifier !== OFFICIAL_COMPUTER_USE_PACKAGE &&
      !(typeof resolvedSpecifier === "string" && resolvedSpecifier.startsWith("file:"))) {
    throw runtimeDiscoveryError("BARE_MODULE_RESOLUTION_INVALID");
  }

  let officialModule;
  try {
    officialModule = await importModule(resolvedSpecifier || OFFICIAL_COMPUTER_USE_PACKAGE);
  } catch {
    throw runtimeDiscoveryError("BARE_MODULE_IMPORT_FAILED");
  }
  const officialSky = validateOfficialSkyModule(officialModule);
  const identity = await discoverIdentity();
  if (identity?.package_name !== OFFICIAL_COMPUTER_USE_PACKAGE ||
      !PACKAGE_VERSION_PATTERN.test(identity?.package_version ?? "")) {
    throw runtimeDiscoveryError("PACKAGE_IDENTITY_INVALID");
  }
  return Object.freeze({ identity, officialSky, resolvedSpecifier });
}

function defineHiddenValue(target, property, value) {
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: false,
    value,
    writable: true,
  });
}

export async function installGlobalSkyWarningGate({
  globals = globalThis,
  notifier = notifyBeforeControl,
  timelineSink = null,
  minWarningGateMs,
  notifierTimeoutMs,
  externalWarningGate = null,
  loadSky = loadOfficialSky,
} = {}) {
  const existing = globals[HELPER_STATE] ?? null;
  const existingWrapperIsCurrent =
    existing?.version === VOICE_WRAPPER_VERSION &&
    isVoiceWrappedSky(existing?.voiceWrappedSky) &&
    globals.sky === existing.voiceWrappedSky;
  if (existingWrapperIsCurrent && getVoiceWrapperState(existing.voiceWrappedSky) !== null) {
    if (externalWarningGate !== null) {
      acceptExternalWarningGateEvidence(existing.voiceWrappedSky, externalWarningGate);
    }
    return Object.freeze({
      identity: existing.identity,
      officialSky: existing.officialSky,
      reused: true,
      version: VOICE_WRAPPER_VERSION,
      voiceWrappedSky: existing.voiceWrappedSky,
    });
  }

  const priorDescriptor = existingWrapperIsCurrent
    ? (existing.priorDescriptor ?? null)
    : (Object.getOwnPropertyDescriptor(globals, "sky") ?? null);
  if (priorDescriptor && priorDescriptor.configurable === false) {
    throw runtimeDiscoveryError("GLOBAL_SKY_NONCONFIGURABLE");
  }
  const loaded = await loadSky();
  if (existingWrapperIsCurrent && loaded?.officialSky !== existing.officialSky) {
    throw runtimeDiscoveryError("RELOADED_OFFICIAL_SKY_IDENTITY_MISMATCH");
  }
  const officialSky = loaded?.officialSky;
  const voiceWrappedSky = createVoiceWrappedSky(officialSky, notifier, {
    timelineSink,
    minWarningGateMs,
    notifierTimeoutMs,
  });
  if (externalWarningGate !== null) {
    acceptExternalWarningGateEvidence(voiceWrappedSky, externalWarningGate);
  }

  Object.defineProperty(globals, "sky", {
    configurable: true,
    enumerable: priorDescriptor?.enumerable ?? true,
    get() { return voiceWrappedSky; },
    set(value) {
      if (value === officialSky || value === voiceWrappedSky) return;
      throw runtimeDiscoveryError("GLOBAL_SKY_REPLACEMENT_BLOCKED");
    },
  });
  defineHiddenValue(globals, "voiceWrappedSky", voiceWrappedSky);
  defineHiddenValue(globals, HELPER_STATE, {
    identity: loaded.identity,
    officialSky,
    priorDescriptor,
    version: VOICE_WRAPPER_VERSION,
    voiceWrappedSky,
  });
  return Object.freeze({
    identity: loaded.identity,
    officialSky,
    rebound_after_local_module_reload: existingWrapperIsCurrent,
    reused: false,
    version: VOICE_WRAPPER_VERSION,
    voiceWrappedSky,
  });
}

export async function initializeVoiceWrappedSky(options = {}) {
  return installGlobalSkyWarningGate(options);
}

export function getVoiceHelperState({ globals = globalThis } = {}) {
  const state = globals[HELPER_STATE];
  if (!state) return null;
  return Object.freeze({
    official_sky_is_global_sky: globals.sky === state.officialSky,
    global_sky_is_wrapped: globals.sky === state.voiceWrappedSky,
    package_name: state.identity?.package_name ?? null,
    package_version: state.identity?.package_version ?? null,
    runtime_id: state.identity?.runtime_id ?? null,
    version: state.version,
    voice_reference_present: globals.voiceWrappedSky === state.voiceWrappedSky,
    warning_gate_state: getVoiceWrapperState(state.voiceWrappedSky),
    warning_gate_timeline: getWarningGateTimeline(state.voiceWrappedSky),
  });
}

export function disposeVoiceWrappedSky({ globals = globalThis } = {}) {
  const state = globals[HELPER_STATE];
  if (!state) return Object.freeze({ removed_state: false, restored_prior_sky: false });
  Reflect.deleteProperty(globals, "sky");
  if (state.priorDescriptor) Object.defineProperty(globals, "sky", state.priorDescriptor);
  const restoredPriorSky = state.priorDescriptor
    ? Object.getOwnPropertyDescriptor(globals, "sky") !== undefined
    : !("sky" in globals);
  Reflect.deleteProperty(globals, "voiceWrappedSky");
  Reflect.deleteProperty(globals, HELPER_STATE);
  return Object.freeze({ removed_state: true, restored_prior_sky: restoredPriorSky });
}

export { getOriginalSky, getWarningGateTimeline, getVoiceWrapperState, isVoiceWrappedSky };
