'use strict';

/**
 * fn-search-api
 * Trigger: HTTP GET
 *
 * Consumer-facing search endpoint.
 *
 * APIM provides the external security and traffic controls:
 *   - OAuth 2.0 / JWT validation
 *   - Rate limiting
 *   - Response caching
 *
 * This function performs:
 *   1. Query parameter validation
 *   2. Optional Azure OpenAI query embedding
 *   3. Date-filter construction
 *   4. Azure AI Search execution
 *   5. API response formatting
 *
 * When vector embedding fails, keyword search is used as a fallback.
 */

const {
  search
} = require('../shared/searchClient');

const {
  embedText,
  buildEmbeddingInput
} = require('../shared/openaiClient');

const {
  INGEST_CATEGORIES
} = require('../shared/config');

const createLogger =
  require('../shared/logger');

const logger =
  createLogger('fn-search-api');

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS = 50;
const DEFAULT_RESULTS = 10;

module.exports = async function (context, req) {
  const startTime = Date.now();

  // --------------------------------------------------------------------------
  // Validate request parameters
  // --------------------------------------------------------------------------

  const parameters =
    parseSearchParameters(req.query);

  if (parameters.error) {
    context.res = {
      status: 400,
      body: {
        error: parameters.error
      }
    };

    return;
  }

  const {
    q,
    top,
    category,
    source,
    sentiment,
    semantic,
    vector,
    from,
    to
  } = parameters;

  logger.info('Search request received', {
    q,
    top,
    category,
    source,
    sentiment,
    semantic,
    vector
  });

  // --------------------------------------------------------------------------
  // Generate query embedding when vector search is enabled
  // --------------------------------------------------------------------------

  let queryVector = null;
  let vectorWarning = null;

  if (vector) {
    try {
      const embedding =
        await embedText(
          buildEmbeddingInput(q, null)
        );

      if (embedding.vectorStatus === 'ok') {
        queryVector = embedding.vector;
      } else {
        vectorWarning =
          `Vector embedding failed (${embedding.vectorStatus}) — ` +
          `falling back to keyword search`;

        logger.warn(vectorWarning, { q });
      }

    } catch (error) {
      vectorWarning =
        'Vector embedding threw unexpectedly — ' +
        'falling back to keyword search';

      logger.error(vectorWarning, {
        q,
        error: error.message
      });
    }
  }

  // --------------------------------------------------------------------------
  // Construct the published date filter
  // --------------------------------------------------------------------------

  let publishedDateFilter = null;

  if (from || to) {
    const dateConditions = [];

    if (from) {
      dateConditions.push(
        `published_at ge ${from}T00:00:00Z`
      );
    }

    if (to) {
      dateConditions.push(
        `published_at le ${to}T23:59:59Z`
      );
    }

    publishedDateFilter =
      dateConditions.join(' and ');
  }

  // --------------------------------------------------------------------------
  // Execute Azure AI Search query
  // --------------------------------------------------------------------------

  let searchResponse;

  try {
    searchResponse = await search({
      q,
      top,
      category,
      source,
      sentiment,
      semantic,
      vector: queryVector,
      dateFilter: publishedDateFilter
    });

  } catch (error) {
    logger.error('Azure AI Search request failed', {
      q,
      error: error.message
    });

    context.res = {
      status: 500,
      body: {
        error:
          'Search service unavailable. Please try again shortly.'
      }
    };

    return;
  }

  // --------------------------------------------------------------------------
  // Prepare API response
  // --------------------------------------------------------------------------

  const responseBody = {
    query: {
      q,
      top,

      filters: {
        category: category ?? null,
        source: source ?? null,
        sentiment: sentiment ?? null,
        from: from ?? null,
        to: to ?? null
      },

      semantic,

      vector: !!queryVector
    },

    count: searchResponse.count,

    results:
      searchResponse.results.map(formatSearchResult),

    facets:
      searchResponse.facets ?? null,

    durationMs:
      Date.now() - startTime
  };

  if (vectorWarning) {
    responseBody.warning = vectorWarning;
  }

  logger.info('Search request completed', {
    q,
    count: searchResponse.count,
    returned: searchResponse.results.length,
    durationMs: responseBody.durationMs
  });

  context.res = {
    status: 200,
    body: responseBody
  };
};


// ============================================================================
// Helper functions
// ============================================================================

/**
 * Validates and converts all supported search query parameters.
 */
function parseSearchParameters(query = {}) {

  // --------------------------------------------------------------------------
  // Search text
  // --------------------------------------------------------------------------

  const searchText =
    (query.q ?? '').trim();

  if (!searchText) {
    return {
      error: 'Query parameter "q" is required'
    };
  }

  if (searchText.length > MAX_QUERY_LENGTH) {
    return {
      error:
        `Query parameter "q" must be ` +
        `${MAX_QUERY_LENGTH} characters or fewer`
    };
  }

  // --------------------------------------------------------------------------
  // Number of results
  // --------------------------------------------------------------------------

  let resultLimit = DEFAULT_RESULTS;

  if (query.top !== undefined) {
    resultLimit =
      parseInt(query.top, 10);

    if (isNaN(resultLimit) || resultLimit < 1) {
      return {
        error:
          '"top" must be a positive integer'
      };
    }

    if (resultLimit > MAX_RESULTS) {
      return {
        error:
          `"top" cannot exceed ${MAX_RESULTS}`
      };
    }
  }

  // --------------------------------------------------------------------------
  // Category
  // --------------------------------------------------------------------------

  const validCategories =
    new Set(INGEST_CATEGORIES);

  const selectedCategory =
    query.category?.trim().toLowerCase() ?? null;

  if (
    selectedCategory &&
    !validCategories.has(selectedCategory)
  ) {
    return {
      error:
        `"category" must be one of: ` +
        `${[...validCategories].join(', ')}`
    };
  }

  // --------------------------------------------------------------------------
  // Sentiment
  // --------------------------------------------------------------------------

  const validSentiments =
    new Set([
      'positive',
      'negative',
      'neutral',
      'mixed'
    ]);

  const selectedSentiment =
    query.sentiment?.trim().toLowerCase() ?? null;

  if (
    selectedSentiment &&
    !validSentiments.has(selectedSentiment)
  ) {
    return {
      error:
        `"sentiment" must be one of: ` +
        `${[...validSentiments].join(', ')}`
    };
  }

  // --------------------------------------------------------------------------
  // Source
  // --------------------------------------------------------------------------

  const selectedSource =
    query.source?.trim() ?? null;

  // --------------------------------------------------------------------------
  // Search modes
  // --------------------------------------------------------------------------

  const semanticSearch =
    query.semantic === 'true' ||
    query.semantic === '1';

  // Vector search is enabled by default.
  const vectorSearch =
    query.vector !== 'false' &&
    query.vector !== '0';

  // --------------------------------------------------------------------------
  // Date filters
  // --------------------------------------------------------------------------

  const startDate =
    query.from?.trim() ?? null;

  const endDate =
    query.to?.trim() ?? null;

  const ISO_DATE_PATTERN =
    /^\d{4}-\d{2}-\d{2}$/;

  if (
    startDate &&
    !ISO_DATE_PATTERN.test(startDate)
  ) {
    return {
      error:
        '"from" must be in YYYY-MM-DD format'
    };
  }

  if (
    endDate &&
    !ISO_DATE_PATTERN.test(endDate)
  ) {
    return {
      error:
        '"to" must be in YYYY-MM-DD format'
    };
  }

  if (
    startDate &&
    endDate &&
    startDate > endDate
  ) {
    return {
      error:
        '"from" cannot be later than "to"'
    };
  }

  return {
    q: searchText,
    top: resultLimit,
    category: selectedCategory,
    source: selectedSource,
    sentiment: selectedSentiment,
    semantic: semanticSearch,
    vector: vectorSearch,
    from: startDate,
    to: endDate
  };
}


/**
 * Converts an Azure AI Search result into the public API response shape.
 */
function formatSearchResult(result) {
  return {
    score:
      result.score ?? null,

    id:
      result.id ?? null,

    url:
      result.url ?? null,

    title:
      result.title ?? null,

    source:
      result.source ?? null,

    category:
      result.category ?? null,

    publishedAt:
      result.published_at ?? null,

    sentimentLabel:
      result.sentiment_label ?? null,

    sentimentScore:
      result.sentiment_score_positive ?? null,

    entities:
      result.entities ?? [],

    keyPhrases:
      result.key_phrases ?? []
  };
}


// Export helper functions for unit tests.
module.exports._parseParams =
  parseSearchParameters;

module.exports._formatResult =
  formatSearchResult;