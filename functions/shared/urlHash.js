'use strict';

const crypto = require('crypto');

/**
 * Length of the SHA-256 hash portion used by the pipeline.
 */
const URL_HASH_LENGTH = 16;

/**
 * Create a short deterministic identifier from an article URL.
 *
 * The URL is trimmed before hashing, and the first 16 hexadecimal
 * characters of the SHA-256 digest are returned.
 *
 * @param {string} url
 * @returns {string}
 */
function hashUrl(url) {
  const normalizedUrl = url.trim();

  const digest = crypto
    .createHash('sha256')
    .update(normalizedUrl)
    .digest('hex');

  return digest.substring(
    0,
    URL_HASH_LENGTH
  );
}

module.exports = {
  hashUrl,
  URL_HASH_LENGTH
};