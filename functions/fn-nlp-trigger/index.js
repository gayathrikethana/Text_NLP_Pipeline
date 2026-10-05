'use strict';

/**
 * fn-nlp-trigger
 * Trigger: Event Grid - BlobCreated
 *
 * Flow:
 *  1. Validate the incoming Event Grid event.
 *  2. Extract and validate the bronze blob path.
 *  3. Check whether the article was already queued.
 *  4. Record the ingestion state.
 *  5. Add the article to the enrichment queue.
 *  6. Record an audit event.
 *
 * The function is idempotent because duplicate BlobCreated
 * events are filtered using the ingestion table.
 */

const {
  enqueueArticle
} = require('../shared/queueClient');

const {
  isDuplicate,
  markIngested,
  logAuditEvent
} = require('../shared/tableClient');

const {
  CONTAINERS
} = require('../shared/config');

const {
  BLOB_CREATED,
  containerFromSubject,
  blobPathFromSubject,
  parseBronzePath
} = require('../shared/blobEvents');

const createLogger = require('../shared/logger');

const logger = createLogger('fn-nlp-trigger');

const BRONZE_CONTAINER = CONTAINERS.BRONZE;

module.exports = async function (context, event) {

  logger.info('Event Grid event received', {
    eventType: event.eventType,
    subject: event.subject
  });

  // Only BlobCreated events are relevant to this function.
  if (event.eventType !== BLOB_CREATED) {
    logger.info('Ignoring unsupported Event Grid event', {
      eventType: event.eventType
    });

    return;
  }

  // Extract the blob path from the Event Grid subject.
  const blobPath =
    blobPathFromSubject(event.subject);

  if (!blobPath) {
    logger.error(
      'Unable to extract blob path from event subject',
      {
        subject: event.subject
      }
    );

    return;
  }

  // Make sure the event belongs to the bronze container.
  const containerName =
    containerFromSubject(event.subject);

  if (containerName !== BRONZE_CONTAINER) {
    logger.info(
      'Blob belongs to a different container - ignoring event',
      {
        subject: event.subject
      }
    );

    return;
  }

  // Expected format:
  // category/date/urlHash.json
  const bronzeDetails =
    parseBronzePath(blobPath);

  if (!bronzeDetails) {
    logger.warn(
      'Blob path does not match the expected bronze structure',
      {
        blobPath
      }
    );

    return;
  }

  const {
    category,
    dateStr,
    urlHash
  } = bronzeDetails;

  const ingestedAt =
    event.eventTime ??
    new Date().toISOString();

  logger.info('Bronze blob processing started', {
    category,
    dateStr,
    urlHash
  });

  // --------------------------------------------------------------------------
  // Check for an existing ingestion record
  // --------------------------------------------------------------------------

  let duplicateFound;

  try {
    duplicateFound =
      await isDuplicate(urlHash);

  } catch (error) {
    // Continue processing if the deduplication lookup itself fails.
    // The enrichment function has its own idempotency check.
    logger.warn(
      'Deduplication check failed - continuing',
      {
        urlHash,
        error: error.message
      }
    );

    duplicateFound = false;
  }

  if (duplicateFound) {
    logger.info(
      'Article has already been queued - skipping',
      {
        urlHash
      }
    );

    return;
  }

  // --------------------------------------------------------------------------
  // Record ingestion before placing the article on the queue
  // --------------------------------------------------------------------------

  try {
    await markIngested(
      urlHash,
      {
        url: '',
        category,
        ingestedAt
      }
    );

  } catch (error) {
    // This is deliberately non-fatal. The downstream silver-existence
    // check provides another layer of duplicate protection.
    logger.warn(
      'Unable to create pre-enqueue ingestion record',
      {
        urlHash,
        error: error.message
      }
    );
  }

  // --------------------------------------------------------------------------
  // Send article reference to the enrichment queue
  // --------------------------------------------------------------------------

  try {
    await enqueueArticle({
      blobPath,
      urlHash,
      category,
      ingestedAt
    });

    logger.info(
      'Article added to enrichment queue',
      {
        urlHash,
        category
      }
    );

  } catch (error) {
    logger.error(
      'Unable to enqueue article',
      {
        urlHash,
        error: error.message
      }
    );

    // Re-throw so Event Grid can retry the event.
    throw error;
  }

  // --------------------------------------------------------------------------
  // Audit logging
  // --------------------------------------------------------------------------

  logAuditEvent(
    urlHash,
    'enrich_queued',
    {
      blobPath,
      category,
      dateStr
    }
  ).catch(error => {
    // Audit failure should not affect the successful queue operation.
    logger.warn(
      'Audit event could not be written',
      {
        urlHash,
        error: error.message
      }
    );
  });
};