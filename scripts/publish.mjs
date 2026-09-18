/**
 * Publish dsh-say with a one-time password, without racing the 30-second window.
 *
 * The account has 2FA enabled and the stored token has no `bypass_2fa`, so a
 * publish must carry a fresh OTP. Typing `npm publish --otp=123456` by hand means
 * opening the authenticator between typing and pressing enter, and the code
 * expires in 30 seconds — so the command is prepared first and the code is asked
 * for at the last moment instead.
 *
 *   node scripts/publish.mjs
 *   node scripts/publish.mjs --dry-run     # prove the flow, publish nothing
 *
 * Local maintainer convenience, never published. The code is masked as it is
 * typed, is not written to disk, and reaches npm only through this invocation.
 */

import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dryRun = process.argv.includes('--dry-run')

// The OTP requirement is a property of the account, not of the package, so say so
// rather than letting a 403 read like a defect in what is being published.
console.log(`publishing ${manifest.name}@${manifest.version} (access: ${manifest.publishConfig?.access})${dryRun ? ' [dry run]' : ''}`)
console.log('a 403 "two-factor authentication ... required to publish" means the OTP was missing or stale.\n')

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
const prompt = 'authenticator code: '
// Suppress the echo so the code does not land in the terminal scrollback.
const original = rl._writeToOutput.bind(rl)
rl._writeToOutput = (text) => {
  if (text.includes(prompt) || text === '\r\n') original(text)
}
const otp = await new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())))
rl.close()
console.log()

if (!/^\d{6,8}$/.test(otp)) {
  console.error('that is not a 6-8 digit code — nothing was published')
  process.exit(1)
}

const args = ['publish', `--otp=${otp}`]
if (dryRun) args.push('--dry-run')
const result = spawnSync('npm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(result.status ?? 1)
