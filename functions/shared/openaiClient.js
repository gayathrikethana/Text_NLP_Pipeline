'use strict';

/**
 * openaiClient.js
 *
 * Azure OpenAI helper for generating article embeddings.
 *
 * Embedding model:
 *   text-embedding-ada-002
 *
 * The model produces 1536-dimensional vectors that are
 * used by Azure AI Search for semantic/vector retrieval.
 *
 * Behavior:
 *   - Empty input is skipped.
 *   - Long input is truncated.
 *   - Authentication failures are not retried.
 *   - Rate limits and temporary server failures are retried.
 */

const axios = require('axios');
const createLogger = require('./logger');

const logger =
  createLogger('openaiClient');


// ada-002 supports approximately 8,191 tokens.
// 32,000 characters is used as a practical character-based limit.
const MAX_INPUT_CHARS = 32000;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;


/**
 * Generate an embedding for one piece of text.
 *
 * @param {string} text
 * @returns {{
 *   vector: number[]|null,
 *   vectorStatus: string,
 *   dimensions: number|null,
 *   vectorError?: string
 * }}
 */
async function embedText(text) {

  // Nothing to embed.
  if (
    !text ||
    text.trim().length === 0
  ) {
    logger.warn(
      'Skipping embedding — empty text'
    );

    return {
      vector: null,
      vectorStatus: 'empty_content',
      dimensions: null
    };
  }

  const endpoint =
    process.env.OPENAI_ENDPOINT;

  const apiKey =
    process.env.OPENAI_API_KEY;

  const deployment =
    process.env.OPENAI_EMBEDDING_DEPLOYMENT ??
    'text-embedding-ada-002';

  if (!endpoint) {
    throw new Error(
      'OPENAI_ENDPOINT is not set'
    );
  }

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set'
    );
  }


  // Keep the request within the configured input limit.
  const embeddingInput =
    text.length > MAX_INPUT_CHARS
      ? text.substring(0, MAX_INPUT_CHARS)
      : text;


  const apiUrl =
    `${endpoint.replace(/\/$/, '')}` +
    `/openai/deployments/${deployment}` +
    `/embeddings?api-version=2023-05-15`;

  let lastError;


  // ---------------------------------------------------------------------------
  // Request with retry handling
  // ---------------------------------------------------------------------------

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    try {
      const response =
        await axios.post(
          apiUrl,
          {
            input: embeddingInput,
            model: deployment
          },
          {
            headers: {
              'api-key': apiKey,
              'Content-Type':
                'application/json'
            },
            timeout: 30000
          }
        );


      const vector =
        response.data?.data?.[0]?.embedding;


      if (
        !vector ||
        !Array.isArray(vector)
      ) {
        throw new Error(
          'Unexpected response shape from OpenAI embeddings API'
        );
      }


      logger.debug(
        'Embedding generated',
        {
          dimensions: vector.length,
          attempt
        }
      );


      return {
        vector,
        vectorStatus: 'ok',
        dimensions: vector.length
      };

    } catch (error) {

      lastError = error;

      const statusCode =
        error.response?.status;


      // Authentication failures will not succeed
      // by repeating the same request.
      if (
        statusCode === 401 ||
        statusCode === 403
      ) {
        logger.error(
          'OpenAI authentication error — not retrying',
          {
            status: statusCode,
            error: error.message
          }
        );

        break;
      }


      // Give temporary failures another chance.
      if (attempt < MAX_RETRIES) {

        const retryDelay =
          BASE_DELAY_MS *
          Math.pow(2, attempt - 1);

        logger.warn(
          'Embedding attempt failed, retrying',
          {
            attempt,
            delay: retryDelay,
            status: statusCode,
            error: error.message
          }
        );

        await sleep(retryDelay);
      }
    }
  }


  // Every attempt failed.
  logger.error(
    'All embedding attempts failed',
    {
      error: lastError?.message
    }
  );


  return {
    vector: null,
    vectorStatus: 'failed',
    dimensions: null,
    vectorError: lastError?.message
  };
}


/**
 * Combine article title and body text into the input
 * used for vector generation.
 *
 * Format:
 *   title
 *
 *   body snippet
 */
function buildEmbeddingInput(
  title,
  bodySnippet
) {
  return [title, bodySnippet]
    .filter(Boolean)
    .join('\n\n');
}


/**
 * Pause execution for the requested number of milliseconds.
 */
function sleep(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}


module.exports = {
  embedText,
  buildEmbeddingInput,
  MAX_INPUT_CHARS
};