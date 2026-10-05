'use strict';

/**
 * languageClient.js
 *
 * Wrapper around Azure AI Language Text Analytics.
 *
 * For each article batch, the client performs:
 *   - Sentiment analysis
 *   - Named entity recognition
 *   - Key phrase extraction
 *
 * Azure limits:
 *   - 10 documents per request
 *   - 5,120 characters per document
 *
 * Articles are therefore limited to 5,000 characters before
 * they are sent to the Language API.
 */

const {
  TextAnalyticsClient,
  AzureKeyCredential
} = require('@azure/ai-text-analytics');

const createLogger = require('./logger');

const logger =
  createLogger('languageClient');

const MAX_DOC_CHARS = 5000;
const BATCH_SIZE = 10;

let languageClient = null;


/**
 * Creates the Azure AI Language client when required.
 */
function getClient() {
  if (languageClient) {
    return languageClient;
  }

  const endpoint =
    process.env.LANGUAGE_ENDPOINT;

  const apiKey =
    process.env.LANGUAGE_API_KEY;

  if (!endpoint) {
    throw new Error(
      'LANGUAGE_ENDPOINT is not set'
    );
  }

  if (!apiKey) {
    throw new Error(
      'LANGUAGE_API_KEY is not set'
    );
  }

  languageClient =
    new TextAnalyticsClient(
      endpoint,
      new AzureKeyCredential(apiKey)
    );

  return languageClient;
}


// -----------------------------------------------------------------------------
// Utility functions
// -----------------------------------------------------------------------------

/**
 * Limits article text to the maximum size sent to Azure AI Language.
 *
 * If possible, the text is cut at a word boundary rather than
 * in the middle of a word.
 */
function truncateText(text) {
  if (
    !text ||
    text.length <= MAX_DOC_CHARS
  ) {
    return text ?? '';
  }

  const limitedText =
    text.substring(0, MAX_DOC_CHARS);

  const lastSpace =
    limitedText.lastIndexOf(' ');

  if (lastSpace > MAX_DOC_CHARS * 0.8) {
    return limitedText.substring(
      0,
      lastSpace
    );
  }

  return limitedText;
}


/**
 * Splits an array into smaller batches.
 */
function chunk(items, size) {
  const groups = [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    groups.push(
      items.slice(index, index + size)
    );
  }

  return groups;
}


// -----------------------------------------------------------------------------
// NLP enrichment
// -----------------------------------------------------------------------------

/**
 * Analyze a collection of articles using Azure AI Language.
 *
 * The returned results remain in the same order as
 * the original input articles.
 */
async function enrichArticles(articles) {
  const client = getClient();

  // Map allows results from the three API operations
  // to be combined using the article ID.
  const results = new Map();

  const documents = articles.map(article => ({
    id: article.id,
    text: truncateText(article.text),
    language: article.language ?? 'en'
  }));

  const articleBatches =
    chunk(documents, BATCH_SIZE);

  for (const batch of articleBatches) {
    await Promise.all([
      runSentiment(client, batch, results),
      runEntities(client, batch, results),
      runKeyPhrases(client, batch, results)
    ]);
  }

  // Make sure every input article receives a result.
  return articles.map(article => {
    return results.get(article.id) ?? {
      id: article.id,
      nlpStatus: 'failed',
      nlpError:
        'No result returned from Language API',
      sentiment: null,
      entities: [],
      keyPhrases: []
    };
  });
}


/**
 * Run sentiment analysis for one batch.
 */
async function runSentiment(
  client,
  batch,
  results
) {
  try {
    const response =
      await client.analyzeSentiment(batch);

    for (const document of response) {
      ensureResult(results, document.id);

      const result =
        results.get(document.id);

      if (document.error) {
        result.nlpStatus = 'failed';
        result.nlpError =
          document.error.message;
        continue;
      }

      result.sentiment = {
        label: document.sentiment,
        scores: document.confidenceScores
      };
    }

  } catch (error) {
    logger.error(
      'analyzeSentiment batch failed',
      { error: error.message }
    );

    batch.forEach(document => {
      ensureResult(results, document.id);

      const result =
        results.get(document.id);

      result.nlpStatus = 'failed';
      result.nlpError = error.message;
    });
  }
}


/**
 * Run named entity recognition for one batch.
 */
async function runEntities(
  client,
  batch,
  results
) {
  try {
    const response =
      await client.recognizeEntities(batch);

    for (const document of response) {
      ensureResult(results, document.id);

      if (document.error) {
        continue;
      }

      results.get(document.id).entities =
        document.entities.map(entity => ({
          text: entity.text,
          category: entity.category,
          subcategory:
            entity.subCategory ?? null,
          confidenceScore:
            entity.confidenceScore
        }));
    }

  } catch (error) {
    logger.error(
      'recognizeEntities batch failed',
      { error: error.message }
    );

    // Entity extraction is non-fatal.
    // Other NLP operations can still succeed.
    batch.forEach(document => {
      ensureResult(results, document.id);

      const result =
        results.get(document.id);

      if (!result.entities) {
        result.entities = [];
      }
    });
  }
}


/**
 * Extract key phrases for one batch.
 */
async function runKeyPhrases(
  client,
  batch,
  results
) {
  try {
    const response =
      await client.extractKeyPhrases(batch);

    for (const document of response) {
      ensureResult(results, document.id);

      if (document.error) {
        continue;
      }

      results.get(document.id).keyPhrases =
        document.keyPhrases;
    }

  } catch (error) {
    logger.error(
      'extractKeyPhrases batch failed',
      { error: error.message }
    );

    batch.forEach(document => {
      ensureResult(results, document.id);

      const result =
        results.get(document.id);

      if (!result.keyPhrases) {
        result.keyPhrases = [];
      }
    });
  }
}


/**
 * Create the initial result object for an article.
 */
function ensureResult(results, articleId) {
  if (results.has(articleId)) {
    return;
  }

  results.set(articleId, {
    id: articleId,
    nlpStatus: 'ok',
    sentiment: null,
    entities: [],
    keyPhrases: []
  });
}


/**
 * Determines whether the extracted entities contain
 * any of the PII categories tracked by the pipeline.
 */
function hasPii(entities = []) {
  const piiCategories =
    new Set([
      'Person',
      'PhoneNumber',
      'Email'
    ]);

  return entities.some(entity =>
    piiCategories.has(entity.category)
  );
}


module.exports = {
  enrichArticles,
  hasPii,
  BATCH_SIZE,
  MAX_DOC_CHARS
};