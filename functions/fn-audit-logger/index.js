'use strict';

/**
 * fn-audit-logger
 *
 * Trigger:
 *   Event Grid - BlobCreated
 *
 * Purpose:
 *   Records an audit entry whenever a new blob is created
 *   inside the bronze container.
 *
 * Important:
 *   Audit logging is intentionally non-blocking. If writing the
 *   audit record fails, the function logs the error instead of
 *   throwing it back to Event Grid.
 */

const { logAuditEvent } = require('../shared/tableClient');
const { CONTAINERS } = require('../shared/config');
const {
  BLOB_CREATED,
  containerFromSubject,
  blobPathFromSubject
} = require('../shared/blobEvents');
const createLogger = require('../shared/logger');

const logger = createLogger('fn-audit-logger');
const bronzeContainer = CONTAINERS.BRONZE;

module.exports = async function (context, event) {

  // Ignore events that are not BlobCreated events.
  if (event.eventType !== BLOB_CREATED) {
    return;
  }

  // Only process blobs belonging to the bronze container.
  const containerName = containerFromSubject(event.subject);

  if (containerName !== bronzeContainer) {
    return;
  }

  const blobPath = blobPathFromSubject(event.subject) || 'unknown';

  const pathSegments = blobPath.split('/');

  const category = pathSegments[0] || 'unknown';

  const urlHash =
    pathSegments[2]?.replace('.json', '') || 'unknown';

  try {
    await logAuditEvent(urlHash, 'blob_created', {
      blobPath,
      category,
      contentLength: event.data?.contentLength ?? null,
      blobUrl: event.data?.url ?? null,
      eventTime:
        event.eventTime || new Date().toISOString()
    });

    logger.info('Audit record written successfully', {
      urlHash,
      category
    });

  } catch (error) {

    // Audit failures are deliberately non-fatal.
    // Do not rethrow because Event Grid should not retry
    // the event just because auditing failed.
    logger.error('Audit write failed (non-fatal)', {
      urlHash,
      error: error.message
    });
  }
};