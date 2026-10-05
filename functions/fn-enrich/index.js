'use strict';

/**
 * fn-enrich
 *
 * Trigger: Azure Storage Queue - article-enrich-queue
 *
 * Processing flow:
 *  1. Read and validate the queue message.
 *  2. Check whether the article already exists in silver storage.
 *  3. Load the original article from bronze storage.
 *  4. Extract usable article text.
 *  5. Run NLP enrichment and vector generation concurrently.
 *  6. Create the silver-layer document.
 *  7. Store the enriched document.
 *  8. Update the ingestion/deduplication table.
 *  9. Record the enrichment audit event.
 *
 * Storage failures that can be retried are rethrown.
 * Individual enrichment failures are recorded in the error container
 * and are not rethrown.
 */

const {
  readJson,
  writeJson,
  exists,
  buildBlobPath
} = require('../shared/blobClient');

const {
  enrichArticles,
  hasPii
} = require('../shared/languageClient');

const {
  embedText,
  buildEmbeddingInput
} = require('../shared/openaiClient');

const {
  markIngested,
  logAuditEvent
} = require('../shared/tableClient');

const {
  CONTAINERS
} = require('../shared/config');

const {
  extractText,
  textSource,
  isContentTruncated,
  dateFromBlobPath
} = require('../shared/articleText');

const createLogger = require('../shared/logger');

const logger = createLogger('fn-enrich');

const BRONZE_CONTAINER = CONTAINERS.BRONZE;
const SILVER_CONTAINER = CONTAINERS.SILVER;
const ERROR_CONTAINER = CONTAINERS.ERROR;

const BODY_SNIPPET_MAX = 500;

module.exports = async function (context, queueMessage) {

  // Queue messages normally arrive as JSON strings.
  // Support an already-parsed object as well.
  let message;

  try {
    message =
      typeof queueMessage === 'string'
        ? JSON.parse(queueMessage)
        : queueMessage;
  } catch (error) {
    logger.error('Unable to parse queue message - dropping message', {
      raw: queueMessage,
      error: error.message
    });

    return;
  }

  const {
    blobPath,
    urlHash,
    category,
    ingestedAt
  } = message;

  // These values are required to locate and process the article.
  if (!blobPath || !urlHash || !category) {
    logger.error('Queue message is missing required fields - dropping message', {
      message
    });

    return;
  }

  logger.info('Article enrichment started', {
    urlHash,
    category
  });

  // --------------------------------------------------------------------------
  // Idempotency check
  // --------------------------------------------------------------------------

  const articleDate = dateFromBlobPath(blobPath);

  const silverBlobPath = buildBlobPath(
    category,
    articleDate,
    urlHash
  );

  try {
    const silverAlreadyExists = await exists(
      SILVER_CONTAINER,
      silverBlobPath
    );

    if (silverAlreadyExists) {
      logger.info('Article already exists in silver storage - skipping', {
        urlHash,
        silverBlobPath
      });

      return;
    }
  } catch (error) {
    // A storage problem should allow the queue to retry the message.
    logger.error('Unable to check silver blob existence', {
      urlHash,
      error: error.message
    });

    throw error;
  }

  // --------------------------------------------------------------------------
  // Load the original article
  // --------------------------------------------------------------------------

  let article;

  try {
    article = await readJson(
      BRONZE_CONTAINER,
      blobPath
    );
  } catch (error) {
    logger.error('Unable to read article from bronze storage', {
      urlHash,
      blobPath,
      error: error.message
    });

    throw error;
  }

  if (!article) {
    logger.error('Bronze article was not found - dropping message', {
      urlHash,
      blobPath
    });

    return;
  }

  // --------------------------------------------------------------------------
  // Extract article text
  // --------------------------------------------------------------------------

  const fullText = extractText(article);

  const bodySnippet = fullText.substring(
    0,
    BODY_SNIPPET_MAX
  );

  logger.debug('Article text extracted', {
    urlHash,
    textLength: fullText.length,
    truncated: fullText.length > BODY_SNIPPET_MAX,
    source: textSource(article)
  });

  // --------------------------------------------------------------------------
  // NLP analysis and embedding generation
  // --------------------------------------------------------------------------

  let nlpData;
  let vectorData;

  try {
    [nlpData, vectorData] = await Promise.all([
      enrichArticles([
        {
          id: urlHash,
          text: fullText
        }
      ]).then(result => result[0]),

      embedText(
        buildEmbeddingInput(
          article.title,
          bodySnippet
        )
      )
    ]);
  } catch (error) {
    logger.error('Article enrichment failed unexpectedly', {
      urlHash,
      error: error.message
    });

    await writeErrorArticle(
      urlHash,
      blobPath,
      category,
      {
        error: error.message,
        stage: 'enrichment'
      }
    );

    return;
  }

  // --------------------------------------------------------------------------
  // Create the silver-layer document
  // --------------------------------------------------------------------------

  const enrichedArticle = buildSilverDocument({
    rawArticle: article,
    urlHash,
    category,
    ingestedAt,
    bodySnippet,
    nlpResult: nlpData,
    embeddingResult: vectorData
  });

  // --------------------------------------------------------------------------
  // Save enriched article
  // --------------------------------------------------------------------------

  try {
    await writeJson(
      SILVER_CONTAINER,
      silverBlobPath,
      enrichedArticle
    );

    logger.info('Silver article written successfully', {
      urlHash,
      silverBlobPath
    });
  } catch (error) {
    logger.error('Unable to write silver article', {
      urlHash,
      error: error.message
    });

    // Storage failure is retryable.
    throw error;
  }

  // --------------------------------------------------------------------------
  // Update deduplication table
  // --------------------------------------------------------------------------

  markIngested(urlHash, {
    url: article.url ?? '',
    category,
    ingestedAt:
      ingestedAt ?? new Date().toISOString()
  }).catch(error => {
    logger.warn('Deduplication update failed (non-fatal)', {
      urlHash,
      error: error.message
    });
  });

  // --------------------------------------------------------------------------
  // Write audit information
  // --------------------------------------------------------------------------

  logAuditEvent(urlHash, 'enrich_complete', {
    silverPath: silverBlobPath,
    nlpStatus: nlpData?.nlpStatus,
    vectorStatus: vectorData?.vectorStatus,
    hasPii: enrichedArticle.hasPii
  }).catch(error => {
    logger.warn('Audit logging failed (non-fatal)', {
      urlHash,
      error: error.message
    });
  });

  logger.info('Article enrichment completed', {
    urlHash,
    nlpStatus: nlpData?.nlpStatus,
    vectorStatus: vectorData?.vectorStatus
  });
};


// ============================================================================
// Helper functions
// ============================================================================

/**
 * Creates the document that is stored in the silver layer.
 */
function buildSilverDocument({
  rawArticle,
  urlHash,
  category,
  ingestedAt,
  bodySnippet,
  nlpResult,
  embeddingResult
}) {
  return {
    // Article information
    id: urlHash,
    url: rawArticle.url ?? null,
    title: rawArticle.title ?? null,
    body_snippet: bodySnippet ?? null,
    source:
      rawArticle.source?.name ??
      rawArticle.source ??
      null,
    category,
    publishedAt: rawArticle.publishedAt ?? null,
    author: rawArticle.author ?? null,

    // NLP information
    nlpStatus: nlpResult?.nlpStatus ?? 'unknown',
    nlpError: nlpResult?.nlpError ?? null,
    sentiment: nlpResult?.sentiment ?? null,
    entities: nlpResult?.entities ?? [],
    keyPhrases: nlpResult?.keyPhrases ?? [],
    hasPii: hasPii(nlpResult?.entities),

    // Vector information
    content_vector: embeddingResult?.vector ?? null,
    vectorStatus:
      embeddingResult?.vectorStatus ?? 'unknown',
    vectorError:
      embeddingResult?.vectorError ?? null,

    // Processing metadata
    ingestedAt,
    enrichedAt: new Date().toISOString(),
    contentTruncated: isContentTruncated(rawArticle)
  };
}


/**
 * Stores information about an article that could not be enriched.
 */
async function writeErrorArticle(
  urlHash,
  blobPath,
  category,
  errorMetadata
) {
  try {
    const articleDate = dateFromBlobPath(blobPath);

    const errorBlobPath =
      `${category}/${articleDate}/${urlHash}.json`;

    await writeJson(
      ERROR_CONTAINER,
      errorBlobPath,
      {
        urlHash,
        blobPath,
        category,
        errorMeta: errorMetadata,
        failedAt: new Date().toISOString()
      }
    );
  } catch (error) {
    // Failure while writing the error record should not
    // cause the original processing to fail again.
    logger.warn('Unable to write article to error container', {
      urlHash,
      error: error.message
    });
  }
}