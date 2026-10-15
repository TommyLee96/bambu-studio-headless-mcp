# SPDX-License-Identifier: GPL-2.0-only
# Copyright (c) Bambu Headless Bridge contributors
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $PSScriptRoot 'BambuCliHidden.cs'
$outputDirectory = Join-Path $repoRoot 'build'
$output = Join-Path $outputDirectory 'BambuCliHidden.exe'

# The .NET Framework compiler ships with supported Windows versions. No package
# manager, user configuration, registry access, or privileged install is needed.
$compiler = $null
foreach ($relative in @('Microsoft.NET\Framework64\v4.0.30319\csc.exe', 'Microsoft.NET\Framework\v4.0.30319\csc.exe')) {
    $candidate = Join-Path $env:WINDIR $relative
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $compiler = $candidate
        break
    }
}
if (-not $compiler) {
    throw 'The Windows .NET Framework C# compiler was not found. Enable .NET Framework 4.x or compile windows/BambuCliHidden.cs with a compatible C# compiler.'
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
& $compiler /nologo /target:exe /platform:anycpu /optimize+ /warnaserror+ /utf8output "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw "C# compilation failed (exit $LASTEXITCODE)." }
Write-Output $output
