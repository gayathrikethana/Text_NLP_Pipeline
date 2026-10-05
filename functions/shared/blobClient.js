'use strict';

/**
 * blobClient.js
 *
 * Azure Blob Storage helpers used by the NLP pipeline.
 *
 * Storage layers:
 *   bronze  - raw NewsAPI responses
 *   silver  - NLP-enriched articles
 *   error   - articles that could not be enriched
 *
 * Blob format:
 *   {category}/{YYYY-MM-DD}/{urlHash}.json
 */

const { BlobServiceClient } = require('@azure/storage-blob');
const createLogger = require('./logger');

const logger = createLogger('blobClient');

// The BlobServiceClient is initialized only when it is first needed.
let storageClient = null;


/**
 * Get the shared Azure Blob Storage client.
 */
function getClient() {
  if (storageClient) {
    return storageClient;
  }

  const connectionString =
    process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING is not set'
    );
  }

  storageClient =
    BlobServiceClient.fromConnectionString(connectionString);

  return storageClient;
}


/**
 * Get a container client.
 *
 * createIfNotExists() makes this safe to call multiple times.
 */
async function getContainer(containerName) {
  const client = getClient();
  const containerClient =
    client.getContainerClient(containerName);

  await containerClient.createIfNotExists();

  return containerClient;
}


// -----------------------------------------------------------------------------
// Write operations
// -----------------------------------------------------------------------------

/**
 * Store a JavaScript object as a JSON blob.
 *
 * Example path:
 *   technology/2024-01-15/abc123.json
 */
async function writeJson(containerName, blobPath, data) {
  const container =
    await getContainer(containerName);

  const blobClient =
    container.getBlockBlobClient(blobPath);

  const jsonContent =
    JSON.stringify(data, null, 2);

  const contentSize =
    Buffer.byteLength(jsonContent);

  await blobClient.upload(
    jsonContent,
    contentSize,
    {
      blobHTTPHeaders: {
        blobContentType: 'application/json'
      }
    }
  );

  logger.debug('Blob written', {
    containerName,
    blobPath,
    bytes: contentSize
  });

  return blobPath;
}


// -----------------------------------------------------------------------------
// Read operations
// -----------------------------------------------------------------------------

/**
 * Download and parse a JSON blob.
 *
 * Returns null when the requested blob does not exist.
 */
async function readJson(containerName, blobPath) {
  const container =
    await getContainer(containerName);

  const blobClient =
    container.getBlockBlobClient(blobPath);

  try {
    const download =
      await blobClient.download(0);

    const chunks = [];

    for await (
      const chunk of download.readableStreamBody
    ) {
      chunks.push(chunk);
    }

    const jsonText =
      Buffer.concat(chunks).toString('utf-8');

    return JSON.parse(jsonText);

  } catch (error) {
    if (error.statusCode === 404) {
      logger.warn('Blob not found', {
        containerName,
        blobPath
      });

      return null;
    }

    throw error;
  }
}


// -----------------------------------------------------------------------------
// List operations
// -----------------------------------------------------------------------------

/**
 * Return the names of all blobs matching a prefix.
 *
 * Example prefix:
 *   technology/2024-01-15/
 */
async function listBlobs(
  containerName,
  prefix = ''
) {
  const container =
    await getContainer(containerName);

  const blobNames = [];

  for await (
    const blobItem of container.listBlobsFlat({ prefix })
  ) {
    blobNames.push(blobItem.name);
  }

  return blobNames;
}


// -----------------------------------------------------------------------------
// Existence check
// -----------------------------------------------------------------------------

/**
 * Check whether a blob exists without downloading its contents.
 */
async function exists(containerName, blobPath) {
  const container =
    await getContainer(containerName);

  const blobClient =
    container.getBlockBlobClient(blobPath);

  return blobClient.exists();
}


// -----------------------------------------------------------------------------
// Path helpers
// -----------------------------------------------------------------------------

/**
 * Create the standard path used for article blobs.
 *
 * Example:
 *   technology/2024-01-15/abc123.json
 */
function buildBlobPath(
  category,
  dateStr,
  urlHash
) {
  return `${category}/${dateStr}/${urlHash}.json`;
}


/**
 * Get the date portion from a blob path.
 *
 * Example:
 *   technology/2024-01-15/abc123.json
 *   -> 2024-01-15
 */
function dateFromBlobPath(blobPath) {
  const pathParts =
    blobPath.split('/');

  return pathParts[1] ?? 'unknown';
}


module.exports = {
  writeJson,
  readJson,
  listBlobs,
  exists,
  buildBlobPath,
  dateFromBlobPath
};