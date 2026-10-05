'use strict';

/**
 * searchClient.js
 *
 * Azure AI Search helper used by:
 *   - fn-index-refresh: document upsert operations
 *   - fn-search-api: hybrid article searches
 *
 * Search mode:
 *   BM25 keyword search + HNSW vector search
 *   with optional semantic reranking.
 */

const {
  SearchClient,
  AzureKeyCredential,
  SearchIndexClient
} = require('@azure/search-documents');

const createLogger = require('./logger');

const logger =
  createLogger('searchClient');


// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const INDEX_NAME =
  process.env.SEARCH_INDEX_NAME ??
  'articles';

const UPSERT_BATCH_SIZE = 1000;

let searchClient = null;
let indexClient = null;


// -----------------------------------------------------------------------------
// Client creation
// -----------------------------------------------------------------------------

/**
 * Return the Azure AI Search document client.
 *
 * The client is created once and reused for subsequent calls.
 */
function getSearchClient() {

  if (searchClient) {
    return searchClient;
  }

  const endpoint =
    process.env.SEARCH_ENDPOINT;

  const apiKey =
    process.env.SEARCH_API_KEY;

  if (!endpoint) {
    throw new Error(
      'SEARCH_ENDPOINT is not set'
    );
  }

  if (!apiKey) {
    throw new Error(
      'SEARCH_API_KEY is not set'
    );
  }

  searchClient =
    new SearchClient(
      endpoint,
      INDEX_NAME,
      new AzureKeyCredential(apiKey)
    );

  return searchClient;
}


/**
 * Return the Azure AI Search index-management client.
 */
function getIndexClient() {

  if (indexClient) {
    return indexClient;
  }

  const endpoint =
    process.env.SEARCH_ENDPOINT;

  const apiKey =
    process.env.SEARCH_API_KEY;

  if (!endpoint) {
    throw new Error(
      'SEARCH_ENDPOINT is not set'
    );
  }

  if (!apiKey) {
    throw new Error(
      'SEARCH_API_KEY is not set'
    );
  }

  indexClient =
    new SearchIndexClient(
      endpoint,
      new AzureKeyCredential(apiKey)
    );

  return indexClient;
}


// -----------------------------------------------------------------------------
// Array helper
// -----------------------------------------------------------------------------

/**
 * Divide an array into smaller batches.
 */
function chunk(items, size) {

  const batches = [];

  for (
    let start = 0;
    start < items.length;
    start += size
  ) {
    batches.push(
      items.slice(start, start + size)
    );
  }

  return batches;
}


// -----------------------------------------------------------------------------
// Document upsert
// -----------------------------------------------------------------------------

/**
 * Merge or upload article documents into the Search index.
 *
 * Azure AI Search accepts a maximum of 1,000 documents
 * per indexing batch, so larger collections are split first.
 *
 * @param {Array<object>} documents
 * @returns {{total: number, succeeded: number, failed: number, errors: Array}}
 */
async function upsertDocuments(documents) {

  const client =
    getSearchClient();

  const batches =
    chunk(
      documents,
      UPSERT_BATCH_SIZE
    );

  let succeeded = 0;
  let failed = 0;

  const errors = [];


  for (
    const [batchIndex, batch] of
    batches.entries()
  ) {

    try {

      const response =
        await client.mergeOrUploadDocuments(
          batch
        );

      const successfulItems =
        response.results.filter(
          item => item.succeeded
        );

      const failedItems =
        response.results.filter(
          item => !item.succeeded
        );


      succeeded +=
        successfulItems.length;

      failed +=
        failedItems.length;


      failedItems.forEach(item => {
        errors.push({
          key: item.key,
          error: item.errorMessage
        });
      });


      logger.info(
        'Upsert batch complete',
        {
          batchIndex,
          batchSize: batch.length,
          succeeded: successfulItems.length,
          failed: failedItems.length
        }
      );

    } catch (error) {

      logger.error(
        'Upsert batch threw',
        {
          batchIndex,
          error: error.message
        }
      );

      failed += batch.length;

      errors.push({
        batchIndex,
        error: error.message
      });
    }
  }


  return {
    total: documents.length,
    succeeded,
    failed,
    errors
  };
}


// -----------------------------------------------------------------------------
// Hybrid search
// -----------------------------------------------------------------------------

/**
 * Search articles using keyword and optional vector retrieval.
 *
 * Semantic reranking can also be enabled by the caller.
 *
 * @param {object} params
 * @param {string} params.q
 * @param {number} params.top
 * @param {string} [params.category]
 * @param {string} [params.source]
 * @param {string} [params.sentiment]
 * @param {boolean} [params.semantic]
 * @param {number[]} [params.vector]
 * @param {string} [params.dateFilter]
 */
async function search({
  q,
  top = 10,
  category,
  source,
  sentiment,
  semantic = false,
  vector,
  dateFilter
}) {

  const client =
    getSearchClient();


  // ---------------------------------------------------------------------------
  // Build the OData filter
  // ---------------------------------------------------------------------------

  const filterParts = [];


  if (category) {
    filterParts.push(
      `category eq '${escapeFilterValue(category)}'`
    );
  }

  if (source) {
    filterParts.push(
      `source eq '${escapeFilterValue(source)}'`
    );
  }

  if (sentiment) {
    filterParts.push(
      `sentiment_label eq '${escapeFilterValue(sentiment)}'`
    );
  }

  if (dateFilter) {
    filterParts.push(dateFilter);
  }


  const filter =
    filterParts.length > 0
      ? filterParts.join(' and ')
      : undefined;


  // ---------------------------------------------------------------------------
  // Base search configuration
  // ---------------------------------------------------------------------------

  const searchOptions = {

    top,

    filter,

    select: [
      'id',
      'url',
      'title',
      'body_snippet',
      'source',
      'category',
      'published_at',
      'sentiment_label',
      'sentiment_score_positive',
      'entities',
      'key_phrases'
    ],

    facets: [
      'category,count:10',
      'sentiment_label,count:5'
    ],

    includeTotalCount: true
  };


  // ---------------------------------------------------------------------------
  // Vector search
  // ---------------------------------------------------------------------------

  if (
    vector &&
    Array.isArray(vector)
  ) {

    searchOptions.vectorSearchOptions = {

      queries: [
        {
          kind: 'vector',
          fields: ['content_vector'],
          vector,

          // Retrieve additional candidates so that
          // reciprocal-rank fusion has a larger pool.
          kNearestNeighborsCount:
            Math.max(top * 2, 50)
        }
      ]

    };
  }


  // ---------------------------------------------------------------------------
  // Semantic or standard ranking
  // ---------------------------------------------------------------------------

  if (semantic) {

    searchOptions.queryType =
      'semantic';

    searchOptions.semanticSearchOptions = {
      configurationName:
        'semantic-config'
    };

    searchOptions.queryLanguage =
      'en-us';

  } else {

    // Recency boosting is used for normal
    // keyword/vector searches.
    searchOptions.scoringProfile =
      'recency-boost';
  }


  // ---------------------------------------------------------------------------
  // Execute the search
  // ---------------------------------------------------------------------------

  const response =
    await client.search(
      q,
      searchOptions
    );


  const results = [];


  for await (
    const result of response.results
  ) {

    results.push({
      score: result.score,
      ...result.document
    });
  }


  // ---------------------------------------------------------------------------
  // Extract facets
  // ---------------------------------------------------------------------------

  const facets = {};


  if (response.facets) {

    const categoryFacets =
      response.facets.category;

    const sentimentFacets =
      response.facets.sentiment_label;


    if (categoryFacets) {

      facets.categories =
        categoryFacets.map(item => ({
          value: item.value,
          count: item.count
        }));
    }


    if (sentimentFacets) {

      facets.sentiments =
        sentimentFacets.map(item => ({
          value: item.value,
          count: item.count
        }));
    }
  }


  return {
    count:
      response.count ??
      results.length,

    results,

    facets:
      Object.keys(facets).length > 0
        ? facets
        : null
  };
}


// -----------------------------------------------------------------------------
// Utility functions
// -----------------------------------------------------------------------------

/**
 * Escape a single quote before placing a value
 * inside an OData string literal.
 */
function escapeFilterValue(value) {
  return value.replace(/'/g, "''");
}


/**
 * Return the number of documents currently stored
 * in the Search index.
 */
async function getDocumentCount() {

  const client =
    getSearchClient();

  return client.getDocumentsCount();
}


// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

module.exports = {
  upsertDocuments,
  search,
  getDocumentCount,
  getSearchClient,
  getIndexClient
};