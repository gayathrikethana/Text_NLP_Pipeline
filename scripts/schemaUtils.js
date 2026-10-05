'use strict';

/**
 * schemaUtils.js
 *
 * Helper functions for preparing Azure AI Search index schemas.
 *
 * Used by:
 *   - create-index.js
 *   - schema-related tests
 *
 * Azure AI Search rejects unknown properties, so documentation-only
 * `comment` fields must be removed before the schema is submitted.
 */

/**
 * Creates a cleaned copy of a schema by recursively removing every
 * property named `comment`.
 *
 * Handles:
 *   - Objects
 *   - Arrays
 *   - Primitive values
 *   - null
 *
 * @param {*} value Schema value to clean.
 * @returns {*} A copy of the value without `comment` properties.
 */
function stripComments(value) {
  if (Array.isArray(value)) {
    return value.map(stripComments);
  }

  if (
    value !== null &&
    typeof value === 'object'
  ) {
    const cleaned = {};

    for (const [key, childValue] of Object.entries(value)) {
      if (key === 'comment') {
        continue;
      }

      cleaned[key] = stripComments(childValue);
    }

    return cleaned;
  }

  return value;
}

module.exports = {
  stripComments
};