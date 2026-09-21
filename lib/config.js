/**
 * Plugin configuration schema and resolution.
 *
 * @module dsh-say/lib/config
 */

import z from '@deepseek-ai/schemastery'

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const Config = z.object({
  engine: z
    .union([z.const('auto'), z.const('builtin'), z.const('gpt-sovits'), z.const('onnx')])
    .default('auto')
    .description(
      'Which engine to prefer. "gpt-sovits" drives a GPT-SoVITS checkout you already have; "onnx" drives the ' +
      'bundled-size ONNX build (Genie-TTS) that needs no PyTorch; "auto" prefers a local GPT-SoVITS, then the ' +
      'ONNX engine, then the built-in OS voices.',
    ),
  voicesDir: z
    .string()
    .default(join(homedir(), '.dsh', 'voice-packs'))
    .description('Directory holding GPT-SoVITS voice packs (one subdirectory per voice).'),
  defaultVoice: z
    .string()
    .default('')
    .description('Voice pack used when a call names no voice. Empty picks the first healthy pack.'),
  defaultVoiceBuiltin: z
    .string()
    .default('')
    .description('OS voice name used when a call names no voice on the built-in engine. Empty uses the OS default.'),
  speed: z.number().min(0.5).max(2).default(1).description('Default speaking rate.'),
  textLang: z
    .string()
    .default('')
    .description('Language of the text being spoken, e.g. zh or en. Empty guesses from the host locale (GPT-SoVITS only).'),
  promptLang: z.string().default('zh').description('Language of a voice pack reference transcript (GPT-SoVITS).'),
  sampleSteps: z.number().step(1).min(4).max(64).default(32).description('GPT-SoVITS sampling steps; lower is faster.'),
  reportBudget: z
    .number()
    .step(1)
    .min(40)
    .max(400)
    .default(120)
    .description('Characters kept when speaking a report. Chinese speech runs about 5 characters per second measured, so 120 is roughly 24 seconds.'),
  timeoutSeconds: z.number().step(1).min(30).max(3600).default(900).description('Per-synthesis timeout.'),
  keepAudio: z
    .boolean()
    .default(false)
    .description('Keep synthesized wav files in the working directory after playback. Off keeps no audio on disk.'),
  personaDir: z
    .string()
    .default('')
    .description('Directory holding report personas (soul/). Empty uses the one shipped with the package.'),
  engines: z
    .object({
      gptSovits: z
        .object({
          serverUrl: z
            .string()
            .default('')
            .description('Use an already-running GPT-SoVITS API instead of a local checkout (thin-client mode).'),
          engineRoot: z
            .string()
            .default('')
            .description('Path to a local GPT-SoVITS checkout. Empty auto-detects common locations.'),
          python: z
            .string()
            .default('')
            .description('Python interpreter for the local checkout. Empty auto-detects a venv or the gpt-sovits conda env.'),
          version: z.string().default('v2ProPlus').description('Model version used when packing weights.'),
          device: z.string().default('cuda').description('Device passed to GPT-SoVITS ("cuda" or "cpu").'),
          isHalf: z.boolean().default(true).description('Half precision; enables faster synthesis on a GPU.'),
        })
        .description('GPT-SoVITS engine options.'),
      onnx: z
        .object({
          root: z
            .string()
            .default(join(homedir(), '.dsh', 'voice-engines', 'genie'))
            .description('Managed directory for the ONNX engine: its venv, its Genie data, and its logs.'),
          python: z
            .string()
            .default('')
            .description('Interpreter for the ONNX engine. Empty uses the managed venv under `root`.'),
          dataDir: z
            .string()
            .default('')
            .description('Genie data directory (its own BERT/HuBERT resources). Empty uses `<root>/GenieData`.'),
          device: z
            .string()
            .default('auto')
            .description(
              'Requested device: "auto" tries CUDA and falls back to CPU, "cuda" or "cpu" pin it. The engine ' +
              'reports the provider a session actually got, because onnxruntime falls back silently.',
            ),
          keepWarm: z
            .boolean()
            .default(true)
            .description(
              'Keep one Genie process alive between calls. Loading the models costs several seconds, so turning ' +
              'this off makes every call pay it again.',
            ),
        })
        .description('ONNX engine options (Genie-TTS).'),
    })
    .description('Per-engine options.'),
}).description('dsh-say configuration')

/** Fill in values that depend on other values or the environment. */
export function resolveConfig(raw = {}) {
  const engines = raw.engines || {}
  const gptSovits = engines.gptSovits || {}
  const onnx = engines.onnx || {}
  const onnxRoot = (onnx.root || '').trim() || join(homedir(), '.dsh', 'voice-engines', 'genie')
  return {
    engine: raw.engine || 'auto',
    voicesDir: raw.voicesDir || join(homedir(), '.dsh', 'voice-packs'),
    defaultVoice: raw.defaultVoice || '',
    defaultVoiceBuiltin: raw.defaultVoiceBuiltin || '',
    speed: typeof raw.speed === 'number' ? raw.speed : 1,
    // The pack's language, not the host's: a Chinese-trained pack speaks its best
    // Chinese even on an English machine. Per-call `textLang` overrides this for
    // a foreign line, which is a cross-lingual call and sounds accented.
    textLang: (raw.textLang || '').trim() || 'zh',
    promptLang: raw.promptLang || 'zh',
    sampleSteps: typeof raw.sampleSteps === 'number' ? raw.sampleSteps : 32,
    reportBudget: typeof raw.reportBudget === 'number' ? raw.reportBudget : 120,
    timeoutSeconds: typeof raw.timeoutSeconds === 'number' ? raw.timeoutSeconds : 900,
    keepAudio: raw.keepAudio === true,
    personaDir: (raw.personaDir || '').trim(),
    engines: {
      gptSovits: {
        serverUrl: (gptSovits.serverUrl || '').trim(),
        engineRoot: (gptSovits.engineRoot || '').trim(),
        python: (gptSovits.python || '').trim(),
        version: gptSovits.version || 'v2ProPlus',
        device: gptSovits.device || 'cuda',
        isHalf: gptSovits.isHalf !== false,
      },
      onnx: {
        root: onnxRoot,
        python: (onnx.python || '').trim() || defaultOnnxPython(onnxRoot),
        dataDir: (onnx.dataDir || '').trim() || join(onnxRoot, 'GenieData'),
        device: (onnx.device || 'auto').trim() || 'auto',
        keepWarm: onnx.keepWarm !== false,
      },
    },
  }
}

/**
 * The engine's interpreter, wherever the installer put it.
 *
 * Two layouts exist and both are current. The portable runtime unpacks a bare
 * interpreter at the engine root - that is its whole point, it needs nothing from
 * the machine. A venv built from a local Python keeps its interpreter one level
 * down. Checking for the portable one first means an install that used it is found
 * without any configuration, and a machine that has both keeps working.
 */
function defaultOnnxPython(root) {
  const portable = process.platform === 'win32' ? join(root, 'python.exe') : join(root, 'bin', 'python3')
  if (existsSync(portable)) return portable
  if (process.platform === 'win32') return join(root, 'venv', 'Scripts', 'python.exe')
  return join(root, 'venv', 'bin', 'python')
}
