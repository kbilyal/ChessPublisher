using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Chess-Publisher")]
[assembly: AssemblyDescription("Chess tournament manager and publisher")]
[assembly: AssemblyCompany("Kyamran Bilyal")]
[assembly: AssemblyProduct("Chess-Publisher")]
[assembly: AssemblyCopyright("Copyright © 2026 Kyamran Bilyal")]
[assembly: AssemblyVersion("1.5.0.0")]
[assembly: AssemblyFileVersion("1.5.0.0")]

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(root, "ChessPublisher-WebView.ps1");
        if (!File.Exists(script))
        {
            MessageBox.Show("ChessPublisher-WebView.ps1 was not found next to ChessPublisher.exe.",
                "Chess-Publisher", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }

        var command = new StringBuilder();
        command.Append("-NoLogo -NoProfile -File ");
        command.Append(Quote(script));
        foreach (string arg in args)
        {
            command.Append(' ').Append(Quote(arg));
        }

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = command.ToString(),
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using (var process = Process.Start(psi))
            {
                if (process == null) return 3;
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("Chess-Publisher could not start.\n\n" + ex.Message,
                "Chess-Publisher", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 4;
        }
    }

    private static string Quote(string value)
    {
        if (value == null) return "\"\"";
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
