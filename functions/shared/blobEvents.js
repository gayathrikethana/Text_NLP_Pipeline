'use strict';

/**
 * blobEvents.js
 *
 * Utility functions for handling Azure Blob Storage
 * "BlobCreated" Event Grid events.
 *
 * Used by:
 *   - fn-nlp-trigger
 *   - fn-audit-logger
 *
 * Both functions use these helpers so that BlobCreated
 * event subjects are interpreted consistently.
 *
 * Expected Event Grid subject:
 *
 * /blobServices/default/containers/{container}/blobs/{category}/{date}/{urlHash}.json
 */

const BLOB_CREATED =
  'Microsoft.Storage.BlobCreated';


/**
 * Extract the container name from an Event Grid subject.
 *
 * @param {string} subject
 * @returns {string|null}
 */
function containerFromSubject(subject) {
  if (typeof subject !== 'string') {
    return null;
  }

  const containerMatch =
    subject.match(/containers\/([^/]+)\//);

  return containerMatch
    ? containerMatch[1]
    : null;
}


/**
 * Get the blob path from an Event Grid subject.
 *
 * Everything after "/blobs/" is returned.
 *
 * Example:
 *   category/2024-01-15/abc123.json
 *
 * @param {string} subject
 * @returns {string|null}
 */
function blobPathFromSubject(subject) {
  if (typeof subject !== 'string') {
    return null;
  }

  const marker = '/blobs/';
  const markerIndex = subject.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  return subject.substring(
    markerIndex + marker.length
  );
}


/**
 * Parse the expected bronze blob path.
 *
 * Expected format:
 *
 *   {category}/{date}/{urlHash}.json
 *
 * @param {string} blobPath
 * @returns {{
 *   category: string,
 *   dateStr: string,
 *   urlHash: string
 * }|null}
 */
function parseBronzePath(blobPath) {
  if (typeof blobPath !== 'string') {
    return null;
  }

  const pathParts =
    blobPath.split('/');

  if (
    pathParts.length !== 3 ||
    !pathParts[2].endsWith('.json')
  ) {
    return null;
  }

  return {
    category: pathParts[0],
    dateStr: pathParts[1],
    urlHash: pathParts[2]
      .replace('.json', '')
  };
}


module.exports = {
  BLOB_CREATED,
  containerFromSubject,
  blobPathFromSubject,
  parseBronzePath
};