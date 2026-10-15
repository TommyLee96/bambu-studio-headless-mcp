// SPDX-License-Identifier: GPL-2.0-only
// Copyright (c) Bambu Headless Bridge contributors

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class BambuCliHidden
{
    private const uint DesktopAccess = 0x00C7;
    private const uint StartfUseShowWindow = 0x00000001;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint BelowNormalPriorityClass = 0x00004000;
    private const uint DuplicateSameAccess = 0x00000002;
    private const uint WaitObject0 = 0;
    private const uint WaitTimeout = 258;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private static readonly IntPtr InvalidHandle = new IntPtr(-1);
    private static string logPath;

    private static void PrintWrapperHelp()
    {
        Console.WriteLine("Bambu Studio Headless MCP - isolated Windows CLI launcher");
        Console.WriteLine("Usage: BambuCliHidden.exe <Bambu Studio offline CLI arguments>");
        Console.WriteLine("       BambuCliHidden.exe --help-wrapper");
        Console.WriteLine("An explicit offline action is required: --help, --info, --slice, or a supported --export-* action.");
        Console.WriteLine("--help is forwarded to Bambu Studio; --help-wrapper does not start Bambu Studio.");
        Console.WriteLine("BAMBU_STUDIO_EXE: optional absolute path to bambu-studio.exe.");
        Console.WriteLine("Otherwise only standard Program Files locations are checked; user settings are never read.");
        Console.WriteLine("BAMBU_CLI_TIMEOUT_SECONDS: integer 1..3600; default 180.");
        Console.WriteLine("BAMBU_BRIDGE_WORK_DIR: optional private log/data root; default system temporary directory.");
        Console.WriteLine("Input/output paths remain relative to the caller's working directory.");
        Console.WriteLine("Studio runs on a new desktop which is never displayed, with a separate data directory.");
        Console.WriteLine("Device dispatch, application URLs, GUI-only launches and caller-supplied --datadir are rejected.");
        Console.WriteLine("Exit codes: CLI exit code; 64 invalid arguments; 70 isolation/setup failure; 124 timeout.");
    }

    private static string ResolveStudioExecutable()
    {
        string configured = Environment.GetEnvironmentVariable("BAMBU_STUDIO_EXE");
        if (!String.IsNullOrWhiteSpace(configured))
        {
            if (!Path.IsPathRooted(configured))
                throw new ArgumentException("BAMBU_STUDIO_EXE must be an absolute executable path, without surrounding quotes.");
            string fullPath = Path.GetFullPath(configured);
            if (!File.Exists(fullPath))
                throw new FileNotFoundException("BAMBU_STUDIO_EXE does not identify an existing file. Correct this environment variable before retrying.");
            if (!String.Equals(Path.GetExtension(fullPath), ".exe", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("BAMBU_STUDIO_EXE must identify an .exe file.");
            return fullPath;
        }
        HashSet<string> checkedRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string variable in new string[] { "ProgramW6432", "ProgramFiles", "ProgramFiles(x86)" })
        {
            string programFiles = Environment.GetEnvironmentVariable(variable);
            if (String.IsNullOrWhiteSpace(programFiles) || !checkedRoots.Add(programFiles)) continue;
            string candidate = Path.Combine(programFiles, "Bambu Studio", "bambu-studio.exe");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("Bambu Studio was not found in standard Program Files locations. Set BAMBU_STUDIO_EXE to its absolute executable path.");
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize;
        public uint dwXCountChars, dwYCountChars, dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("user32.dll", EntryPoint = "CreateDesktopW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr devmode, uint flags, uint access, IntPtr attributes);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int identifier);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint desiredAccess, bool inheritHandle, uint options);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string name, uint access, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flags, IntPtr template);

    private static void Log(string stage, string details)
    {
        if (logPath == null) return;
        File.AppendAllText(logPath, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " stage=" + stage + " " + details + Environment.NewLine, Encoding.ASCII);
    }

    private static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes); slashes = 0; result.Append(c);
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }

    private static bool IsAction(string arg)
    {
        string key = arg.Split('=')[0].ToLowerInvariant();
        return key == "--slice" || key == "--info" || key == "--help" ||
               key == "--export-3mf" || key == "--export-stl" || key == "--export-obj" ||
               key == "--export-svg" || key == "--export-gcode";
    }

    private static void Validate(string[] args)
    {
        bool hasAction = false;
        foreach (string arg in args)
        {
            string key = arg.Split('=')[0].ToLowerInvariant();
            if (key == "--help-wrapper") throw new ArgumentException("Use --help-wrapper on its own; it is not a Bambu Studio option.");
            if (key == "--datadir") throw new ArgumentException("Caller-supplied --datadir is forbidden; this launcher creates an isolated data directory.");
            if (key == "--print" || key == "--send" || key == "--upload" || key == "--open" || key == "--send-to-printer" ||
                key == "--dispatch" || key == "--connect" || key == "--start-print" || key == "--print-file" || key == "--print-all")
                throw new ArgumentException("Device dispatch and GUI actions are forbidden by this background launcher.");
            if (arg.StartsWith("bambu:", StringComparison.OrdinalIgnoreCase) || arg.StartsWith("bambustudio:", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Application URL actions are forbidden by this background launcher.");
            if (IsAction(arg)) hasAction = true;
        }
        if (!hasAction) throw new ArgumentException("An explicit supported offline CLI action is required.");
    }

    private static IntPtr InheritableStandardHandle(int identifier, bool input)
    {
        IntPtr source = GetStdHandle(identifier);
        bool ownsSource = false;
        if (source == IntPtr.Zero || source == InvalidHandle)
        {
            source = CreateFile("NUL", input ? 0x80000000u : 0x40000000u, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (source == InvalidHandle) throw new Win32Exception(Marshal.GetLastWin32Error(), "Opening NUL failed.");
            ownsSource = true;
        }
        IntPtr result;
        bool ok = DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), out result, 0, true, DuplicateSameAccess);
        int error = Marshal.GetLastWin32Error();
        if (ownsSource) CloseHandle(source);
        if (!ok) throw new Win32Exception(error, "Duplicating a standard handle failed.");
        return result;
    }

    private static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Creating the cleanup job failed.");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            if (!SetInformationJobObject(job, 9, buffer, (uint)length))
            {
                int error = Marshal.GetLastWin32Error(); CloseHandle(job);
                throw new Win32Exception(error, "Configuring the cleanup job failed.");
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
        return job;
    }

    private static int Main(string[] args)
    {
        if (args.Length == 1 && String.Equals(args[0], "--help-wrapper", StringComparison.OrdinalIgnoreCase))
        {
            PrintWrapperHelp();
            return 0;
        }
        IntPtr desktop = IntPtr.Zero, job = IntPtr.Zero;
        IntPtr stdin = IntPtr.Zero, stdout = IntPtr.Zero, stderr = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool started = false, processExited = false;
        Stopwatch elapsed = Stopwatch.StartNew();
        try
        {
            Validate(args);
            string studioExe = ResolveStudioExecutable();
            string root = Environment.GetEnvironmentVariable("BAMBU_BRIDGE_WORK_DIR");
            if (String.IsNullOrWhiteSpace(root)) root = Path.Combine(Path.GetTempPath(), "BambuHeadlessBridge");
            root = Path.GetFullPath(root);
            string id = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + "-" + Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(Path.Combine(root, "logs"));
            logPath = Path.Combine(root, "logs", id + ".log");
            int timeoutSeconds = 180;
            string timeoutText = Environment.GetEnvironmentVariable("BAMBU_CLI_TIMEOUT_SECONDS");
            if (!String.IsNullOrEmpty(timeoutText) && (!Int32.TryParse(timeoutText, out timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600))
                throw new ArgumentException("BAMBU_CLI_TIMEOUT_SECONDS must be an integer from 1 to 3600.");
            string desktopName = "BambuCli_" + Process.GetCurrentProcess().Id + "_" + Guid.NewGuid().ToString("N");
            string dataDirectory = Path.Combine(Path.Combine(root, "datadirs"), id);
            Directory.CreateDirectory(dataDirectory);
            desktop = CreateDesktop(desktopName, IntPtr.Zero, IntPtr.Zero, 0, DesktopAccess, IntPtr.Zero);
            if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Creating the isolated desktop failed.");
            Log("desktop_created", "desktop=" + desktopName + " switched=false timeout_seconds=" + timeoutSeconds);
            job = CreateKillOnCloseJob();
            stdin = InheritableStandardHandle(-10, true);
            stdout = InheritableStandardHandle(-11, false);
            stderr = InheritableStandardHandle(-12, false);
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            startup.lpDesktop = @"winsta0\" + desktopName;
            startup.dwFlags = StartfUseShowWindow | StartfUseStdHandles;
            startup.wShowWindow = 0;
            startup.hStdInput = stdin; startup.hStdOutput = stdout; startup.hStdError = stderr;
            StringBuilder command = new StringBuilder(Quote(studioExe));
            command.Append(" --datadir ").Append(Quote(dataDirectory));
            foreach (string arg in args) command.Append(' ').Append(Quote(arg));
            if (!CreateProcess(studioExe, command, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended | CreateNoWindow | BelowNormalPriorityClass, IntPtr.Zero, Environment.CurrentDirectory, ref startup, out process))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Starting the isolated CLI process failed.");
            started = true;
            Log("process_created", "pid=" + process.dwProcessId + " desktop=" + desktopName + " suspended=true");
            if (!AssignProcessToJobObject(job, process.hProcess)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Assigning the isolated process to its cleanup job failed.");
            if (ResumeThread(process.hThread) == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error(), "Resuming the isolated CLI process failed.");
            Log("process_resumed", "pid=" + process.dwProcessId + " job_cleanup=true");
            uint wait = WaitForSingleObject(process.hProcess, checked((uint)timeoutSeconds * 1000));
            if (wait == WaitTimeout)
            {
                Log("timeout", "pid=" + process.dwProcessId + " elapsed_ms=" + elapsed.ElapsedMilliseconds);
                if (!TerminateProcess(process.hProcess, 124)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Terminating the owned timed-out process failed.");
                WaitForSingleObject(process.hProcess, 10000);
                processExited = true;
                Console.Error.WriteLine("Bambu CLI timed out on its isolated desktop; only the owned process was terminated.");
                return 124;
            }
            if (wait != WaitObject0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Waiting for the isolated CLI process failed.");
            processExited = true;
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Reading the isolated CLI exit code failed.");
            Log("exit", "pid=" + process.dwProcessId + " code=" + exitCode + " elapsed_ms=" + elapsed.ElapsedMilliseconds);
            return unchecked((int)exitCode);
        }
        catch (ArgumentException ex)
        {
            Log("rejected", "reason=" + ex.Message);
            Console.Error.WriteLine(ex.Message);
            return 64;
        }
        catch (Exception ex)
        {
            Win32Exception native = ex as Win32Exception;
            Log("error", "type=" + ex.GetType().Name + " native_code=" + (native == null ? "none" : native.NativeErrorCode.ToString(CultureInfo.InvariantCulture)));
            if (ex is FileNotFoundException) Console.Error.WriteLine(ex.Message);
            else Console.Error.WriteLine("Bambu CLI isolation failed; see the launcher runtime log. No desktop switch was performed.");
            return 70;
        }
        finally
        {
            if (started && !processExited && process.hProcess != IntPtr.Zero)
            {
                TerminateProcess(process.hProcess, 70);
                WaitForSingleObject(process.hProcess, 10000);
            }
            if (job != IntPtr.Zero) CloseHandle(job);
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            if (stdin != IntPtr.Zero) CloseHandle(stdin);
            if (stdout != IntPtr.Zero) CloseHandle(stdout);
            if (stderr != IntPtr.Zero) CloseHandle(stderr);
            if (desktop != IntPtr.Zero) CloseDesktop(desktop);
        }
    }
}
