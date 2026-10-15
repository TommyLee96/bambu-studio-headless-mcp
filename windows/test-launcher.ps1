# SPDX-License-Identifier: GPL-2.0-only
# Copyright (c) Bambu Headless Bridge contributors
# Self-contained launcher contract tests. Uses a local probe, never a printer.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcher = Join-Path $repoRoot 'build\BambuCliHidden.exe'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { & (Join-Path $PSScriptRoot 'build.ps1') | Out-Null }
$testRoot = Join-Path $repoRoot ('artifacts\launcher-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$probeSource = Join-Path $testRoot 'Probe.cs'
$probeExe = Join-Path $testRoot 'Probe.exe'
@'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
internal static class Probe {
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint id);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr h, int index, StringBuilder data, uint length, out uint needed);
    static string Name(IntPtr h) {
        if (h == IntPtr.Zero) return "unavailable";
        uint needed; StringBuilder value = new StringBuilder(256);
        if (!GetUserObjectInformation(h, 2, value, 512, out needed)) return "unavailable";
        return value.ToString();
    }
    static int Main(string[] args) {
        if (Array.IndexOf(args, "--probe-child") >= 0) { Thread.Sleep(30000); return 0; }
        string desktop = Name(GetThreadDesktop(GetCurrentThreadId()));
        IntPtr input = OpenInputDesktop(0, false, 1);
        string inputName = Name(input);
        if (input != IntPtr.Zero) CloseDesktop(input);
        Console.WriteLine("isolated=" + (desktop.StartsWith("BambuCli_") && desktop != inputName));
        Console.WriteLine("priority=" + Process.GetCurrentProcess().PriorityClass);
        Console.WriteLine("cwd=" + Directory.GetCurrentDirectory());
        int at = Array.IndexOf(args, "--datadir");
        Console.WriteLine("private_datadir=" + (at >= 0 && at+1 < args.Length && Directory.Exists(args[at+1])));
        if (Array.IndexOf(args, "--probe-sleep") >= 0) {
            ProcessStartInfo start = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--probe-child");
            start.UseShellExecute = false; start.CreateNoWindow = true;
            Process child = Process.Start(start);
            File.WriteAllText(Environment.GetEnvironmentVariable("BAMBU_BRIDGE_TEST_CHILD_PID_FILE"), child.Id.ToString());
            Thread.Sleep(30000);
        }
        return 0;
    }
}
'@ | Set-Content -LiteralPath $probeSource -Encoding UTF8
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $compiler /nologo /target:exe /optimize+ "/out:$probeExe" $probeSource
if ($LASTEXITCODE -ne 0) { throw 'Compiling the launcher probe failed.' }

$saved = @{}
foreach ($key in @('BAMBU_STUDIO_EXE', 'BAMBU_BRIDGE_WORK_DIR', 'BAMBU_CLI_TIMEOUT_SECONDS', 'BAMBU_BRIDGE_TEST_CHILD_PID_FILE')) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
$childPidFile = Join-Path $testRoot 'child.pid'
try {
    $env:BAMBU_STUDIO_EXE = Join-Path $testRoot 'nonexistent.exe'
    $env:BAMBU_BRIDGE_WORK_DIR = Join-Path $testRoot 'runtime'
    $env:BAMBU_CLI_TIMEOUT_SECONDS = '10'
    $env:BAMBU_BRIDGE_TEST_CHILD_PID_FILE = $childPidFile
    $help = & $launcher --help-wrapper
    if ($LASTEXITCODE -ne 0 -or ($help -join "`n") -notmatch '--help is forwarded') { throw 'Wrapper help failed.' }
    if (Test-Path -LiteralPath $env:BAMBU_BRIDGE_WORK_DIR) { throw 'Wrapper help unexpectedly started runtime setup.' }

    $env:BAMBU_STUDIO_EXE = $probeExe
    $info = & $launcher --info
    if ($LASTEXITCODE -ne 0) { throw 'Offline probe launch failed.' }
    $infoText = $info -join "`n"
    foreach ($required in @('isolated=True', 'priority=BelowNormal', 'private_datadir=True', ('cwd=' + (Get-Location).Path))) {
        if (-not $infoText.Contains($required)) { throw "Probe property failed: $required" }
    }
    $forwardedHelp = & $launcher --help
    if ($LASTEXITCODE -ne 0 -or ($forwardedHelp -join "`n") -notmatch 'isolated=True') {
        throw 'Studio --help was not forwarded to the isolated process.'
    }

    $rejected = @(
        @(), @('example.stl'), @('--datadir', 'custom', '--info'), @('--info', '--datadir=custom'),
        @('--info', '--print'), @('--info', '--send'), @('--info', '--upload'), @('--info', '--open'),
        @('--info', '--send-to-printer'), @('--info', '--dispatch'), @('--info', '--connect'),
        @('--info', '--start-print'), @('--info', '--print-file'), @('--info', '--print-all'),
        @('--info', 'bambu://example'), @('--info', 'bambustudio://example'), @('--info', '--help-wrapper')
    )
    $rejectionCount = 0
    foreach ($case in $rejected) {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $launcher @case 2> (Join-Path $testRoot ('reject-' + $rejectionCount + '.txt')) | Out-Null
        $exit = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($exit -ne 64) { throw "Rejection case $rejectionCount returned $exit instead of 64." }
        $rejectionCount++
    }

    $env:BAMBU_CLI_TIMEOUT_SECONDS = '1'
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $launcher --info --probe-sleep 2> (Join-Path $testRoot 'timeout.txt') | Out-Null
    $exit = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exit -ne 124) { throw "Timeout returned $exit instead of 124." }
    if (-not (Test-Path -LiteralPath $childPidFile)) { throw 'Timeout test did not create its owned child.' }
    $ownedChild = [Int32](Get-Content -LiteralPath $childPidFile)
    Start-Sleep -Milliseconds 100
    if (Get-Process -Id $ownedChild -ErrorAction SilentlyContinue) { throw 'Owned descendant survived job cleanup.' }

    $result = [ordered]@{
        wrapper_help_without_studio = $true
        studio_help_forwarded = $true
        isolated_desktop = $true
        below_normal_priority = $true
        caller_cwd_preserved = $true
        private_data_directory = $true
        rejected_cases = $rejectionCount
        timeout_exit_code = $exit
        owned_descendant_cleanup = $true
        printer_connection_attempted = $false
        keyboard_or_mouse_input_sent = $false
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'result.json') -Encoding UTF8
    $result | ConvertTo-Json
}
finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
}
# A successful timeout assertion intentionally leaves native exit code 124.
# Clear it only after the complete test script has returned without an error.
$global:LASTEXITCODE = 0
