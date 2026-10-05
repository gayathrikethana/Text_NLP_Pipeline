'use strict';

/**
 * fn-hash-url
 * Trigger: HTTP POST
 *
 * Receives an article URL from the Logic App and creates
 * the short hash used throughout the pipeline as the article
 * identifier, blob filename, and deduplication key.
 *
 * Request:
 *   { "url": "https://example.com/article" }
 *
 * Response:
 *   { "urlHash": "...", "url": "https://example.com/article" }
 */

const { hashUrl } = require('../shared/urlHash');
const createLogger = require('../shared/logger');

const logger = createLogger('fn-hash-url');

module.exports = async function (context, req) {
  const requestUrl = req.body?.url;

  // Validate that the request contains a usable URL string.
  if (
    !requestUrl ||
    typeof requestUrl !== 'string' ||
    requestUrl.trim().length === 0
  ) {
    context.res = {
      status: 400,
      body: {
        error: 'Request body must contain a non-empty "url" string'
      }
    };

    return;
  }

  const cleanUrl = requestUrl.trim();
  const articleHash = hashUrl(cleanUrl);

  logger.debug('Article URL hashed', {
    urlHash: articleHash,
    urlLength: cleanUrl.length
  });

  context.res = {
    status: 200,
    body: {
      urlHash: articleHash,
      url: cleanUrl
    }
  };
};