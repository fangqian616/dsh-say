/**
 * Built-in engine: the speech voices the operating system already has.
 *
 * This is the engine that makes dsh-voice install-and-run: no model download,
 * no Python, no GPU. On Windows it drives SAPI through System.Speech; playback
 * uses System.Media.SoundPlayer, so the engine needs no external media program
 * either. Voices available here belong to whoever shipped them with the OS.
 *
 * Implementation note: the PowerShell program is written to a `.ps1` file and
 * invoked with `-File`. Passing a script through `-Command` with positional
 * arguments corrupts them through the console code page on non-English Windows,
 * and System.Speech additionally rejects non-ASCII output paths.
 *
 * @module dsh-voice/lib/engines/builtin
 */

import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, runCommand, tempWav, workDir } from '../util.js'

const ENGINE_NAME = 'builtin'

const PROBE_PS1 = [
  'try {',
  '  Add-Type -AssemblyName System.Speech -ErrorAction Stop',
  '} catch {',
  '  Write-Output "ERR|assembly|$($_.Exception.Message)"',
  '  exit 0',
  '}',
  'try {',
  '  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '  $rows = @()',
  '  foreach ($v in $synth.GetInstalledVoices()) {',
  '    $info = $v.VoiceInfo',
  '    if ($info -ne $null) { $rows += ("$($info.Name)|$($info.Culture)|$($info.Gender)") }',
  '  }',
  '  $synth.Dispose()',
  '  if ($rows.Count -eq 0) {',
  '    Write-Output "ERR|novoices|no speech voice is installed"',
  '  } else {',
  '    Write-Output "OK"',
  '    $rows | ForEach-Object { Write-Output $_ }',
  '  }',
  '} catch {',
  '  Write-Output "ERR|probe|$($_.Exception.Message)"',
  '}',
].join('\n')

const SPEAK_PS1 = [
  'param([string]$TextFile, [string]$RequestedOut, [string]$VoiceName, [int]$Rate)',
  '$ErrorActionPreference = "Stop"',
  '',
  'function Test-AsciiPath([string]$Value) {',
  '  if (-not $Value) { return $false }',
  '  foreach ($ch in $Value.ToCharArray()) { if ([int]$ch -gt 127) { return $false } }',
  '  return $true',
  '}',
  '',
  'function New-SafeTemp {',
  '  $candidates = @()',
  '  if ($env:TEMP) { $candidates += (Join-Path $env:TEMP "dsh-voice") }',
  '  if ($env:SystemRoot) { $candidates += (Join-Path $env:SystemRoot "Temp\\dsh-voice") }',
  '  $candidates += "C:\\Windows\\Temp\\dsh-voice"',
  '  try { $candidates += (Join-Path ([IO.Path]::GetTempPath()) "dsh-voice") } catch { }',
  '  foreach ($candidate in $candidates) {',
  '    if (-not (Test-AsciiPath $candidate)) { continue }',
  '    try { New-Item -ItemType Directory -Force -Path $candidate | Out-Null } catch { continue }',
  '    return $candidate',
  '  }',
  '  return "C:\\Windows\\Temp"',
  '}',
  '',
  'try {',
  '  Add-Type -AssemblyName System.Speech -ErrorAction Stop',
  '  $text = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)',
  '  $target = $RequestedOut',
  '  if (-not (Test-AsciiPath $target)) {',
  '    $target = Join-Path (New-SafeTemp) ("dsh-voice-" + [Guid]::NewGuid().ToString("N") + ".wav")',
  '  }',
  '  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '  $synth.Volume = 100',
  '  $synth.Rate = $Rate',
  '  if ($VoiceName -and $VoiceName.Length -gt 0) { $synth.SelectVoice($VoiceName) }',
  '  $synth.SetOutputToWaveFile($target)',
  '  $synth.Speak($text)',
  '  $synth.Dispose()',
  '  Write-Output ("OK|" + $target)',
  '} catch {',
  '  Write-Output ("ERR|" + $_.Exception.Message)',
  '}',
].join('\n')

const PLAY_PS1 = [
  'param([string]$File)',
  '$source = @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class DshVoicePlayer {',
  '    [DllImport("winmm.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
  '    private static extern bool PlaySound(string sound, IntPtr module, uint flags);',
  '    public static bool Play(string path) { return PlaySound(path, IntPtr.Zero, 0x00020000); }',
  '}',
  '"@',
  'try {',
  '  Add-Type -TypeDefinition $source -ErrorAction Stop',
  '  if ([DshVoicePlayer]::Play($File)) { Write-Output "OK" } else { Write-Output "ERR|winmm PlaySound returned false" }',
  '} catch {',
  '  Write-Output ("ERR|" + $_.Exception.Message)',
  '}',
].join('\n')

/** Write one PowerShell program into the working directory and return its path. */
function scriptFile(tag, source) {
  const path = join(workDir(), `dsh-voice-${tag}.ps1`)
  writeFileSync(path, source, 'utf8')
  return path
}

function powershellArgs(script, extra) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...extra]
}

/** First non-empty line of a diagnostic, so one failure does not flood the log. */
function firstLine(text) {
  return (
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)[0] || ''
  )
}

/** The `ERR|...` line of a script's output, if any. */
function errorLine(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith('ERR|'))
}

let cachedProbe = null

/**
 * Probe the built-in engine once per process.
 *
 * Availability means: PowerShell starts, System.Speech loads, and at least one
 * voice is installed. A machine that fails any of those reports a precise
 * reason instead of failing later inside a synthesis call.
 *
 * @param {{ force?: boolean }} [options]
 */
export async function probe(options = {}) {
  if (cachedProbe && !options.force) return cachedProbe

  if (process.platform !== 'win32') {
    cachedProbe = {
      available: false,
      engine: ENGINE_NAME,
      reason: `the built-in engine currently supports Windows only (this platform is ${process.platform}); use the gpt-sovits engine instead`,
    }
    return cachedProbe
  }

  const result = await runCommand('powershell.exe', powershellArgs(scriptFile('probe', PROBE_PS1), []), {
    timeoutMs: 90000,
  })

  const lines = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines[0] === 'OK') {
    const voices = lines.slice(1).map((line) => {
      const [voiceName, locale, gender] = line.split('|')
      return { name: voiceName, locale, gender }
    })
    cachedProbe = { available: true, engine: ENGINE_NAME, voices }
    return cachedProbe
  }

  const reason = errorLine(result.stdout) || result.stderr || 'unknown failure'
  cachedProbe = {
    available: false,
    engine: ENGINE_NAME,
    reason: `System.Speech is unavailable: ${firstLine(String(reason).replace(/^ERR\|[^|]*\|/, ''))}`,
  }
  return cachedProbe
}

/** List the OS voices this engine can use. */
export async function listVoices() {
  const status = await probe()
  if (!status.available) return { available: false, reason: status.reason, voices: [] }
  return {
    available: true,
    voices: status.voices.map((voice) => ({
      id: voice.name,
      label: voice.locale ? `${voice.name} (${voice.locale})` : voice.name,
      locale: voice.locale || '',
      gender: voice.gender || '',
      engine: ENGINE_NAME,
    })),
  }
}

/**
 * Synthesize one line into a wav file.
 *
 * @param {object} request
 * @param {string} request.text
 * @param {string} [request.voice]       SAPI voice name; empty picks the OS default
 * @param {number} [request.speed]       0.5 - 2.0, mapped onto SAPI's -10..10 rate
 * @param {string} [request.outputPath]  explicit destination
 * @param {AbortSignal} [request.signal]
 * @returns {Promise<{ ok: boolean, audio?: string, voice?: string, locale?: string, reason?: string }>}
 */
export async function synthesize(request) {
  const status = await probe()
  if (!status.available) return { ok: false, reason: status.reason }

  const textPath = join(workDir(), `dsh-voice-text-${Date.now()}-${process.pid}.txt`)
  writeFileSync(textPath, request.text, 'utf8')
  const fallbackOutput = request.outputPath || tempWav('builtin')

  const speed = typeof request.speed === 'number' && Number.isFinite(request.speed) ? request.speed : 1
  const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 10)))

  const script = scriptFile('speak', SPEAK_PS1)
  let result
  try {
    result = await runCommand(
      'powershell.exe',
      powershellArgs(script, [textPath, fallbackOutput, request.voice || '', String(rate)]),
      { timeoutMs: 600000, signal: request.signal },
    )
  } finally {
    // Removed even when the command throws or is aborted, so a failed call
    // leaves no spoken text behind on disk.
    cleanup(textPath)
  }

  const okLine = String(result.stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith('OK|'))
  if (okLine) {
    const produced = okLine.slice(3).trim()
    let audio = produced
    if (!existsSync(audio)) {
      if (!existsSync(fallbackOutput)) {
        return { ok: false, reason: `the speech engine reported success but wrote no audio (${produced})` }
      }
      audio = fallbackOutput
    }
    if (audio !== fallbackOutput && request.outputPath) {
      try {
        copyFileSync(audio, request.outputPath)
        audio = request.outputPath
      } catch (error) {
        return { ok: false, reason: `could not save audio to ${request.outputPath}: ${String(error?.message || error)}` }
      }
    }
    const info = status.voices.find((voice) => voice.name === request.voice)
    return { ok: true, audio, voice: request.voice || '(system default)', locale: info?.locale || '' }
  }

  const failure = errorLine(result.stdout)
  cleanup(fallbackOutput)
  return {
    ok: false,
    reason: failure
      ? firstLine(failure.replace('ERR|', ''))
      : firstLine(result.stderr) || `synthesis produced no audio (exit ${result.code})`,
  }
}

/**
 * Play a wav file through the default output device.
 *
 * Uses System.Media.SoundPlayer so no external media tool is required.
 *
 * @param {string} file
 * @param {{ signal?: AbortSignal, ffplayPath?: string }} [options]
 */
export async function play(file, options = {}) {
  const script = scriptFile('play', PLAY_PS1)
  const result = await runCommand('powershell.exe', powershellArgs(script, [file]), {
    timeoutMs: 1800000,
    signal: options.signal,
  })

  if (String(result.stdout || '').includes('OK')) return { played: true }
  const failure = errorLine(result.stdout)
  return {
    played: false,
    error: failure ? firstLine(failure.replace('ERR|', '')) : firstLine(result.stderr) || 'playback failed',
  }
}

export const engine = {
  name: ENGINE_NAME,
  label: 'Built-in OS voices',
  synthesize,
  play,
  listVoices,
  probe: () => probe(),
}

export default engine
