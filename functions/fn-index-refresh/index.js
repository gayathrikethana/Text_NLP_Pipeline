'use strict';

/**
 * fn-index-refresh
 * Trigger: HTTP POST
 *
 * Refreshes Azure AI Search using documents from the silver layer.
 *
 * Processing:
 *  1. Determine the refresh date and category scope.
 *  2. Find silver blobs for that scope.
 *  3. Read silver documents with limited concurrency.
 *  4. Convert them to the Search index schema.
 *  5. Upsert documents in Azure AI Search.
 *  6. Return processing and error statistics.
 */

const {
  listBlobs,
  readJson
} = require('../shared/blobClient');

const {
  upsertDocuments
} = require('../shared/searchClient');

const {
  INGEST_CATEGORIES,
  CONTAINERS
} = require('../shared/config');

const createLogger = require('../shared/logger');

const logger = createLogger('fn-index-refresh');

const SILVER_CONTAINER = CONTAINERS.SILVER;
const ALL_CATEGORIES = INGEST_CATEGORIES;

module.exports = async function (context, req) {
  const startTime = Date.now();

  logger.info('Index refresh started', {
    body: req.body
  });

  // --------------------------------------------------------------------------
  // Determine refresh scope
  // --------------------------------------------------------------------------

  const requestBody = req.body ?? {};

  const refreshDate =
    requestBody.date ?? getPreviousDate();

  const requestedCategory =
    requestBody.category ?? null;

  if (!isValidDate(refreshDate)) {
    context.res = {
      status: 400,
      body: {
        error:
          `Invalid date format: "${refreshDate}". Expected YYYY-MM-DD.`
      }
    };

    return;
  }

  const categories = requestedCategory
    ? [requestedCategory]
    : ALL_CATEGORIES;

  logger.info('Refresh scope determined', {
    date: refreshDate,
    categories
  });

  // --------------------------------------------------------------------------
  // Locate silver documents
  // --------------------------------------------------------------------------

  let silverBlobPaths = [];

  for (const currentCategory of categories) {
    const blobPrefix =
      `${currentCategory}/${refreshDate}/`;

    try {
      const categoryBlobs = await listBlobs(
        SILVER_CONTAINER,
        blobPrefix
      );

      logger.info('Silver blobs listed', {
        category: currentCategory,
        date: refreshDate,
        count: categoryBlobs.length
      });

      silverBlobPaths = silverBlobPaths.concat(
        categoryBlobs
      );

    } catch (error) {
      logger.error('Unable to list silver blobs', {
        category: currentCategory,
        date: refreshDate,
        error: error.message
      });

      context.res = {
        status: 502,
        body: {
          error:
            `Failed to list silver blobs for ` +
            `${currentCategory}/${refreshDate}: ${error.message}`
        }
      };

      return;
    }
  }

  // Nothing to index for the requested scope.
  if (silverBlobPaths.length === 0) {
    logger.info('No silver documents found', {
      date: refreshDate,
      categories
    });

    context.res = {
      status: 200,
      body: {
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        date: refreshDate,
        categories,
        durationMs: Date.now() - startTime
      }
    };

    return;
  }

  logger.info('Silver documents selected for indexing', {
    count: silverBlobPaths.length
  });

  // --------------------------------------------------------------------------
  // Read and transform silver documents
  // --------------------------------------------------------------------------

  const searchDocuments = [];
  const readFailures = [];

  // Limit concurrent Storage reads.
  const READ_CONCURRENCY = 20;

  for (
    let index = 0;
    index < silverBlobPaths.length;
    index += READ_CONCURRENCY
  ) {
    const currentBatch = silverBlobPaths.slice(
      index,
      index + READ_CONCURRENCY
    );

    const batchResults = await Promise.allSettled(
      currentBatch.map(blobPath =>
        readJson(
          SILVER_CONTAINER,
          blobPath
        )
      )
    );

    batchResults.forEach((result, position) => {
      const currentBlobPath = currentBatch[position];

      if (result.status === 'rejected') {
        logger.warn('Unable to read silver document', {
          blobPath: currentBlobPath,
          error: result.reason?.message
        });

        readFailures.push({
          blobPath: currentBlobPath,
          error: result.reason?.message
        });

        return;
      }

      const silverDocument = result.value;

      if (!silverDocument) {
        readFailures.push({
          blobPath: currentBlobPath,
          error: 'Blob returned null'
        });

        return;
      }

      const searchDocument =
        mapToSearchDocument(silverDocument);

      if (searchDocument) {
        searchDocuments.push(searchDocument);
      }
    });
  }

  logger.info('Silver document processing finished', {
    total: silverBlobPaths.length,
    mapped: searchDocuments.length,
    readErrors: readFailures.length
  });

  // --------------------------------------------------------------------------
  // Update Azure AI Search
  // --------------------------------------------------------------------------

  let searchResult = {
    total: 0,
    succeeded: 0,
    failed: 0,
    errors: []
  };

  if (searchDocuments.length > 0) {
    try {
      searchResult =
        await upsertDocuments(searchDocuments);

      logger.info(
        'Azure AI Search upsert completed',
        searchResult
      );

    } catch (error) {
      logger.error(
        'Azure AI Search upsert failed unexpectedly',
        {
          error: error.message
        }
      );

      context.res = {
        status: 502,
        body: {
          error:
            `Search upsert failed: ${error.message}`
        }
      };

      return;
    }
  }

  // --------------------------------------------------------------------------
  // Prepare final response
  // --------------------------------------------------------------------------

  const combinedErrors = [
    ...readFailures,
    ...searchResult.errors
  ];

  const resultSummary = {
    date: refreshDate,
    categories,

    processed: silverBlobPaths.length,

    succeeded: searchResult.succeeded,

    failed:
      readFailures.length +
      searchResult.failed,

    errors: combinedErrors.slice(0, 50),

    durationMs:
      Date.now() - startTime
  };

  // 207 indicates that the refresh completed but some
  // documents could not be processed successfully.
  const responseStatus =
    searchResult.failed > 0 ||
    readFailures.length > 0
      ? 207
      : 200;

  logger.info(
    'Index refresh completed',
    resultSummary
  );

  context.res = {
    status: responseStatus,
    body: resultSummary
  };
};


// ============================================================================
// Helper functions
// ============================================================================

/**
 * Converts a silver-layer document into the Azure AI Search schema.
 */
function mapToSearchDocument(document) {
  if (!document?.id) {
    return null;
  }

  return {
    id: document.id,

    url:
      document.url ?? null,

    title:
      document.title ?? null,

    body_snippet:
      document.body_snippet ?? null,

    source:
      document.source ?? null,

    category:
      document.category ?? null,

    published_at:
      document.publishedAt ??
      document.published_at ??
      null,

    sentiment_label:
      document.sentiment?.label ??
      null,

    sentiment_score_positive:
      document.sentiment?.scores?.positive ??
      null,

    // Azure AI Search stores entities as a string array.
    entities:
      (document.entities ?? [])
        .map(entity => entity.text),

    key_phrases:
      document.keyPhrases ?? [],

    content_vector:
      document.content_vector ?? null
  };
}


/**
 * Returns the previous calendar date in YYYY-MM-DD format.
 */
function getPreviousDate() {
  const previousDay = new Date();

  previousDay.setDate(
    previousDay.getDate() - 1
  );

  return previousDay
    .toISOString()
    .split('T')[0];
}


/**
 * Checks whether a value follows the YYYY-MM-DD format
 * and represents a valid date.
 */
function isValidDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value))
  );
}


// Export helpers for unit tests.
module.exports._mapToSearchDoc =
  mapToSearchDocument;

module.exports._yesterday =
  getPreviousDate;

module.exports._isValidDate =
  isValidDate;

module.exports._ALL_CATEGORIES =
  ALL_CATEGORIES;