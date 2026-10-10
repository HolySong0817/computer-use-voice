using System;
using System.Globalization;
using System.IO;
using System.Media;
using System.Security.Cryptography;
using System.Text;

namespace ComputerUseVoice
{
    internal static class ComputerUseVoiceNotifier
    {
        private const int ProtocolVersion = 1;
        private const string WarningAssetName = "warning_zh_cn.wav";
        private const long WarningAssetSize = WarningAssetPin.Length;
        private const string WarningAssetSha256 = WarningAssetPin.Sha256;

        private static StreamWriter CreateProtocolWriter()
        {
            return new StreamWriter(
                Console.OpenStandardOutput(),
                new UTF8Encoding(false),
                1024,
                false)
            {
                AutoFlush = true
            };
        }

        private static void Emit(StreamWriter writer, string eventName)
        {
            writer.WriteLine(
                "{\"protocol_version\":" + ProtocolVersion.ToString(CultureInfo.InvariantCulture) +
                ",\"event\":\"" + eventName + "\"}");
        }

        private static string ComputeSha256(string path)
        {
            using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var sha256 = SHA256.Create())
            {
                return BitConverter.ToString(sha256.ComputeHash(input)).Replace("-", "");
            }
        }

        private static string ValidateWarningAsset()
        {
            var baseDirectory = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var assetPath = Path.GetFullPath(Path.Combine(baseDirectory, WarningAssetName));
            if (!String.Equals(Path.GetDirectoryName(assetPath), baseDirectory, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("WARNING_ASSET_PATH_INVALID");
            }
            var info = new FileInfo(assetPath);
            if (!info.Exists || info.Length != WarningAssetSize)
            {
                throw new InvalidDataException("WARNING_ASSET_SIZE_INVALID");
            }
            if (!String.Equals(ComputeSha256(assetPath), WarningAssetSha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException("WARNING_ASSET_HASH_INVALID");
            }
            return assetPath;
        }

        [STAThread]
        private static int Main()
        {
            var diagnosticStage = 0;
            try
            {
                diagnosticStage = 1;
                using (var writer = CreateProtocolWriter())
                {
                    diagnosticStage = 2;
                    var assetPath = ValidateWarningAsset();
                    diagnosticStage = 3;
                    using (var player = new SoundPlayer(assetPath))
                    {
                        player.Load();
                        Emit(writer, "audio_playback_started");
                        diagnosticStage = 4;
                        player.PlaySync();
                        Emit(writer, "audio_playback_finished");
                        return 0;
                    }
                }
            }
            catch
            {
                // Fail closed without emitting paths, exception text, or user details.
                return 30 + diagnosticStage;
            }
        }
    }
}
