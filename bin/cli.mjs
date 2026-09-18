#!/usr/bin/env node
/**
 * `npx dsh-say` — install this plugin into a dsh profile.
 *
 * The README's one command is `dsh plugin --profile <p> add dsh-say`, which
 * requires knowing the profile name and having dsh on PATH. This wrapper does the
 * same thing with no arguments and then says the one thing it cannot do: the
 * profile has to be restarted before the tools exist, and that is the user's step.
 *
 * It only installs the plugin. A character voice is a separate download, and the
 * plugin prompts for it on first use.
 *
 *   npx dsh-say                    # into the 'web' profile
 *   npx dsh-say --profile tui
 *   npx dsh-say --print            # show the command, do nothing
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const profileFlag = args.indexOf('--profile')
const profile = profileFlag >= 0 ? args[profileFlag + 1] : 'web'
const printOnly = args.includes('--print')
const help = args.includes('--help') || args.includes('-h')

if (help) {
  console.log(`npx dsh-say — install the dsh-say plugin into a dsh profile

  --profile <name>   which profile to install into (default: web)
  --print            print the command instead of running it
  -h, --help         this message`)
  process.exit(0)
}

const command = ['plugin', '--profile', profile, 'add', 'dsh-say']

console.log(`installing dsh-say into the "${profile}" profile\n  dsh ${command.join(' ')}\n`)

if (printOnly) process.exit(0)

// Where the profile lives decides what a failure means, so it is checked before
// spawning: a wrong profile name should say so rather than surface as a pnpm error
// about a directory that does not exist.
const profileDir = join(homedir(), '.dsh', 'profiles', profile)
const known = existsSync(join(profileDir, 'package.json'))
if (!known && existsSync(join(homedir(), '.dsh', 'profiles'))) {
  const { readdirSync } = await import('node:fs')
  const available = readdirSync(join(homedir(), '.dsh', 'profiles'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => entry.name)
  if (available.length > 0 && !available.includes(profile)) {
    console.error(`no such profile: "${profile}"`)
    console.error(`  available: ${available.join(', ')}`)
    console.error('  pick one with --profile <name>')
    process.exit(1)
  }
}

const result = spawnSync('dsh', command, { stdio: 'inherit', shell: process.platform === 'win32' })

if (result.error?.code === 'ENOENT') {
  console.error('\ndsh was not found on PATH.')
  console.error('  install the DeepSeek Harness CLI first, then re-run this.')
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`\ndsh exited with ${result.status}. The plugin was not installed.`)
  process.exit(result.status ?? 1)
}

console.log(`
installed. Two things to know:

  1. RESTART the "${profile}" profile before the tools exist. A restart ends this
     session, so pick the moment yourself. Until then tts_speak is not available.
  2. This installed the plugin, not a character voice. The plugin uses the speech
     voices your system already has, at zero download. To speak in a character
     voice, get the bundle from the Releases page and ask your agent to install it.

Verify after the restart:  ask the agent to run tts_engines`)
