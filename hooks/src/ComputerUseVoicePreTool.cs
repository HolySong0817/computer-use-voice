using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace ComputerUseVoice
{
    internal static class ComputerUseVoicePreTool
    {
        private const int MaxInputCharacters = 2 * 1024 * 1024;
        private const int NotifierTimeoutMs = 10000;
        private const double MinimumWarningGateMs = 2000.0;
        private const string PreToolEvent = "PreToolUse";
        private const string SessionStartEvent = "SessionStart";
        private const string ExpectedTool = "mcp__node_repl__js";
        private const string EvidenceSource = "plugin-pretool-warning-gate-v1";
        private static readonly Regex ControlInvocation = new Regex(
            @"\.(?:launch_app|activate_window|click|type_text|press_key|scroll|drag|set_value|perform_secondary_action)\s*\(",
            RegexOptions.CultureInvariant);
        private static readonly Regex CanonicalSkyGuard = new Regex(
            @"if\s*\(\s*!\s*globalThis\.sky\s*\)",
            RegexOptions.CultureInvariant);
        private static readonly Regex CanonicalSkyAssignment = new Regex(
            @"globalThis\.sky\s*=\s*sky\b",
            RegexOptions.CultureInvariant);

        private sealed class TimedProtocolEvent
        {
            internal string Name;
            internal double ElapsedMs;
        }

        private static StreamWriter CreateOutputWriter()
        {
            return new StreamWriter(
                Console.OpenStandardOutput(),
                new UTF8Encoding(false),
                4096,
                false)
            {
                AutoFlush = true
            };
        }

        private static Dictionary<string, object> HookOutput(
            string decision,
            string reason,
            Dictionary<string, object> updatedInput)
        {
            var hookSpecific = new Dictionary<string, object>
            {
                { "hookEventName", PreToolEvent },
                { "permissionDecision", decision }
            };
            if (!String.IsNullOrEmpty(reason)) hookSpecific["permissionDecisionReason"] = reason;
            if (updatedInput != null) hookSpecific["updatedInput"] = updatedInput;
            return new Dictionary<string, object> { { "hookSpecificOutput", hookSpecific } };
        }

        private static Dictionary<string, object> Deny(string reason)
        {
            return HookOutput("deny", reason, null);
        }

        private static string ReadBoundedInput()
        {
            using (var reader = new StreamReader(
                Console.OpenStandardInput(),
                new UTF8Encoding(false, true),
                true,
                4096,
                false))
            {
                var buffer = new char[4096];
                var builder = new StringBuilder();
                int count;
                while ((count = reader.Read(buffer, 0, buffer.Length)) > 0)
                {
                    if (builder.Length + count > MaxInputCharacters)
                        throw new InvalidDataException("HOOK_INPUT_TOO_LARGE");
                    builder.Append(buffer, 0, count);
                }
                return builder.ToString();
            }
        }

        private static Dictionary<string, object> RequireDictionary(object value)
        {
            var dictionary = value as Dictionary<string, object>;
            if (dictionary == null) throw new InvalidDataException("HOOK_OBJECT_REQUIRED");
            return dictionary;
        }

        private static string RequireString(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item) || !(item is string) || String.IsNullOrEmpty((string)item))
                throw new InvalidDataException("HOOK_STRING_REQUIRED");
            return (string)item;
        }

        private static bool IsCanonicalOfficialInitializer(string code)
        {
            return CanonicalSkyGuard.IsMatch(code) &&
                   CanonicalSkyAssignment.IsMatch(code) &&
                   !ControlInvocation.IsMatch(code);
        }

        private static string ResolvePluginPath(params string[] relativeParts)
        {
            var pluginRoot = Environment.GetEnvironmentVariable("PLUGIN_ROOT");
            if (String.IsNullOrWhiteSpace(pluginRoot))
                throw new InvalidDataException("PLUGIN_ROOT_UNAVAILABLE");
            var root = Path.GetFullPath(pluginRoot.Trim())
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var parts = new List<string> { root };
            parts.AddRange(relativeParts);
            var candidate = Path.GetFullPath(Path.Combine(parts.ToArray()));
            var prefix = root + Path.DirectorySeparatorChar;
            if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate))
                throw new InvalidDataException("PLUGIN_PATH_INVALID");
            return candidate;
        }

        private static string ResolveBootstrapUri()
        {
            return new Uri(ResolvePluginPath(
                "skills",
                "computer-use-voice",
                "helper",
                "initialize_voice_wrapped_sky.mjs")).AbsoluteUri;
        }

        private static string HashIdentifier(string value)
        {
            using (var sha256 = SHA256.Create())
            {
                return BitConverter.ToString(sha256.ComputeHash(Encoding.UTF8.GetBytes(value)))
                    .Replace("-", "");
            }
        }

        private static string StatePathForSession(string sessionId)
        {
            var pluginData = Environment.GetEnvironmentVariable("PLUGIN_DATA");
            if (String.IsNullOrWhiteSpace(pluginData))
                throw new InvalidDataException("PLUGIN_DATA_UNAVAILABLE");
            var dataRoot = Path.GetFullPath(pluginData.Trim())
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var stateRoot = Path.GetFullPath(Path.Combine(dataRoot, "warning_gate_state"));
            if (!stateRoot.StartsWith(dataRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("PLUGIN_DATA_PATH_INVALID");
            Directory.CreateDirectory(stateRoot);
            return Path.Combine(stateRoot, HashIdentifier(sessionId) + ".json");
        }

        private static Mutex CreateSessionMutex(string sessionId)
        {
            return new Mutex(false, "Local\\ComputerUseVoice_" + HashIdentifier(sessionId).Substring(0, 32));
        }

        private static void WriteState(
            string statePath,
            Dictionary<string, object> state,
            JavaScriptSerializer serializer)
        {
            File.WriteAllText(statePath, serializer.Serialize(state), new UTF8Encoding(false));
        }

        private static Dictionary<string, object> ReadPassedEvidence(
            string statePath,
            JavaScriptSerializer serializer)
        {
            try
            {
                if (!File.Exists(statePath)) return null;
                var state = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(statePath, Encoding.UTF8));
                object status;
                object evidence;
                if (!state.TryGetValue("state", out status) || !String.Equals(status as string, "passed", StringComparison.Ordinal) ||
                    !state.TryGetValue("evidence", out evidence)) return null;
                var value = evidence as Dictionary<string, object>;
                if (value == null || !ValidateEvidence(value)) return null;
                return value;
            }
            catch
            {
                return null;
            }
        }

        private static double RequireFiniteNumber(Dictionary<string, object> value, string key)
        {
            object item;
            if (!value.TryGetValue(key, out item)) throw new InvalidDataException("EVIDENCE_NUMBER_MISSING");
            var number = Convert.ToDouble(item, CultureInfo.InvariantCulture);
            if (Double.IsNaN(number) || Double.IsInfinity(number))
                throw new InvalidDataException("EVIDENCE_NUMBER_INVALID");
            return number;
        }

        private static bool ValidateEvidence(Dictionary<string, object> evidence)
        {
            try
            {
                object source;
                if (!evidence.TryGetValue("source", out source) ||
                    !String.Equals(source as string, EvidenceSource, StringComparison.Ordinal)) return false;
                var audioStart = RequireFiniteNumber(evidence, "warning_to_audio_start_ms");
                var audioFinish = RequireFiniteNumber(evidence, "warning_to_audio_finish_ms");
                var gate = RequireFiniteNumber(evidence, "warning_gate_ms");
                return audioStart > 0 && audioFinish >= audioStart && gate >= audioFinish && gate >= MinimumWarningGateMs;
            }
            catch
            {
                return false;
            }
        }

        private static Dictionary<string, object> PlayWarningGate(JavaScriptSerializer serializer)
        {
            var notifierPath = ResolvePluginPath("native", "computer_use_voice_notifier.exe");
            var stopwatch = Stopwatch.StartNew();
            var events = new List<TimedProtocolEvent>();
            var protocolFailed = false;
            var startInfo = new ProcessStartInfo
            {
                FileName = notifierPath,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var process = new Process { StartInfo = startInfo })
            {
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
                {
                    if (args.Data == null) return;
                    try
                    {
                        var message = serializer.Deserialize<Dictionary<string, object>>(args.Data);
                        object version;
                        object eventName;
                        if (!message.TryGetValue("protocol_version", out version) ||
                            Convert.ToInt32(version, CultureInfo.InvariantCulture) != 1 ||
                            !message.TryGetValue("event", out eventName) || !(eventName is string))
                        {
                            protocolFailed = true;
                            return;
                        }
                        lock (events)
                        {
                            events.Add(new TimedProtocolEvent
                            {
                                Name = (string)eventName,
                                ElapsedMs = stopwatch.Elapsed.TotalMilliseconds
                            });
                        }
                    }
                    catch
                    {
                        protocolFailed = true;
                    }
                };
                process.ErrorDataReceived += delegate { };
                if (!process.Start()) throw new InvalidOperationException("NOTIFIER_START_FAILED");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(NotifierTimeoutMs))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("NOTIFIER_TIMEOUT");
                }
                process.WaitForExit();
                if (process.ExitCode != 0 || protocolFailed)
                    throw new InvalidOperationException("NOTIFIER_FAILED");
            }

            TimedProtocolEvent started;
            TimedProtocolEvent finished;
            lock (events)
            {
                if (events.Count != 2 ||
                    events[0].Name != "audio_playback_started" ||
                    events[1].Name != "audio_playback_finished")
                    throw new InvalidDataException("NOTIFIER_PROTOCOL_INVALID");
                started = events[0];
                finished = events[1];
            }
            var remaining = MinimumWarningGateMs - stopwatch.Elapsed.TotalMilliseconds;
            if (remaining > 0) Thread.Sleep((int)Math.Ceiling(remaining));
            var gateMs = stopwatch.Elapsed.TotalMilliseconds;
            var evidence = new Dictionary<string, object>
            {
                { "source", EvidenceSource },
                { "warning_to_audio_start_ms", started.ElapsedMs },
                { "warning_to_audio_finish_ms", finished.ElapsedMs },
                { "warning_gate_ms", gateMs }
            };
            if (!ValidateEvidence(evidence)) throw new InvalidDataException("WARNING_GATE_EVIDENCE_INVALID");
            return evidence;
        }

        private static Dictionary<string, object> GetOrCreateEvidence(
            string sessionId,
            JavaScriptSerializer serializer)
        {
            var statePath = StatePathForSession(sessionId);
            using (var mutex = CreateSessionMutex(sessionId))
            {
                var acquired = false;
                try
                {
                    acquired = mutex.WaitOne(NotifierTimeoutMs + 5000);
                    if (!acquired) throw new TimeoutException("WARNING_GATE_MUTEX_TIMEOUT");
                    var existing = ReadPassedEvidence(statePath, serializer);
                    if (existing != null) return existing;
                    var evidence = PlayWarningGate(serializer);
                    WriteState(statePath, new Dictionary<string, object>
                    {
                        { "schema_version", 1 },
                        { "state", "passed" },
                        { "evidence", evidence }
                    }, serializer);
                    return evidence;
                }
                finally
                {
                    if (acquired) mutex.ReleaseMutex();
                }
            }
        }

        private static void ResetSessionState(
            Dictionary<string, object> input,
            JavaScriptSerializer serializer)
        {
            var sessionId = RequireString(input, "session_id");
            var statePath = StatePathForSession(sessionId);
            using (var mutex = CreateSessionMutex(sessionId))
            {
                var acquired = false;
                try
                {
                    acquired = mutex.WaitOne(5000);
                    if (!acquired) throw new TimeoutException("WARNING_GATE_MUTEX_TIMEOUT");
                    WriteState(statePath, new Dictionary<string, object>
                    {
                        { "schema_version", 1 },
                        { "state", "idle" }
                    }, serializer);
                }
                finally
                {
                    if (acquired) mutex.ReleaseMutex();
                }
            }
        }

        private static Dictionary<string, object> ProcessPreToolInput(
            Dictionary<string, object> input,
            JavaScriptSerializer serializer)
        {
            if (!String.Equals(RequireString(input, "tool_name"), ExpectedTool, StringComparison.Ordinal))
                return Deny("WARNING_GATE_HOOK_SCOPE_INVALID");
            object rawToolInput;
            if (!input.TryGetValue("tool_input", out rawToolInput))
                return Deny("WARNING_GATE_TOOL_INPUT_MISSING");
            var toolInput = RequireDictionary(rawToolInput);
            var code = RequireString(toolInput, "code");
            if (code.IndexOf("@oai/sky", StringComparison.Ordinal) >= 0 &&
                !IsCanonicalOfficialInitializer(code))
                return Deny("DIRECT_OFFICIAL_SKY_IMPORT_BLOCKED");

            Dictionary<string, object> evidence = null;
            if (ControlInvocation.IsMatch(code))
            {
                try
                {
                    evidence = GetOrCreateEvidence(RequireString(input, "session_id"), serializer);
                }
                catch
                {
                    return Deny("WARNING_GATE_FAILED");
                }
            }

            var bootstrapUri = ResolveBootstrapUri();
            var options = "{ globals: globalThis";
            if (evidence != null) options += ", externalWarningGate: " + serializer.Serialize(evidence);
            options += " }";
            var prefix =
                "await (await import(" + serializer.Serialize(bootstrapUri) +
                ")).installGlobalSkyWarningGate(" + options + ");\n";
            var rewritten = new Dictionary<string, object>(toolInput);
            rewritten["code"] = prefix + code;
            return HookOutput("allow", null, rewritten);
        }

        [STAThread]
        private static int Main()
        {
            var serializer = new JavaScriptSerializer { MaxJsonLength = MaxInputCharacters };
            try
            {
                var input = serializer.Deserialize<Dictionary<string, object>>(ReadBoundedInput());
                var eventName = RequireString(input, "hook_event_name");
                if (String.Equals(eventName, SessionStartEvent, StringComparison.Ordinal))
                {
                    ResetSessionState(input, serializer);
                    return 0;
                }
                using (var writer = CreateOutputWriter())
                {
                    if (!String.Equals(eventName, PreToolEvent, StringComparison.Ordinal))
                    {
                        writer.WriteLine(serializer.Serialize(Deny("WARNING_GATE_HOOK_SCOPE_INVALID")));
                        return 0;
                    }
                    writer.WriteLine(serializer.Serialize(ProcessPreToolInput(input, serializer)));
                    return 0;
                }
            }
            catch
            {
                using (var writer = CreateOutputWriter())
                {
                    writer.WriteLine(serializer.Serialize(Deny("WARNING_GATE_HOOK_VALIDATION_FAILED")));
                }
                return 0;
            }
        }
    }
}
