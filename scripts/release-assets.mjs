/**
 * Which release assets an upload replaces.
 *
 * Kept apart from the upload script so it can be tested without a GitHub token or
 * a network, because getting it wrong is destructive rather than merely untidy:
 * an earlier version deleted every archive-shaped asset, so uploading the 290 MB
 * ONNX bundle silently removed the 1.34 GB one.
 *
 * Two rules, and both matter:
 *
 *   replace the asset being uploaded  so a re-upload is an update, not a second
 *     copy with the same name;
 *
 *   retire anything archive-shaped this project no longer publishes  because this
 *     release once carried `silver-wolf-full-v2ProPlus.zip`, and leaving a
 *     differently-named old archive behind means the character-named file stays
 *     downloadable long after nothing in the repository mentions it.
 *
 * @module dsh-say/scripts/release-assets
 */

/** The archives this project publishes. Everything else archive-shaped is stale. */
export const CURRENT_ASSETS = [
  'sample-full-v2ProPlus.zip',
  'sample-onnx-v2ProPlus.zip',
  'dsh-say-onnx-runtime-win-x64.zip',
]

/**
 * Archive names, including the ones retired by the de-identification.
 *
 * The portable runtime is deliberately outside this pattern: it is named after the
 * package, not after a voice, and matching it would put it in the same bucket as the
 * character-named archives that have to be swept away.
 */
export const ARCHIVE_LIKE = /^(?:silver-wolf|sample)[\w.-]*\.zip$/i

/**
 * The asset names an upload should delete first.
 *
 * @param {string[]} existing names currently on the release
 * @param {string} uploading name about to be uploaded
 * @returns {string[]} names to delete
 */
export function assetsToReplace(existing, uploading) {
  return existing.filter((name) =>
    name === uploading || (ARCHIVE_LIKE.test(name) && !CURRENT_ASSETS.includes(name)))
}
