'use strict';

/**
 * articleText.js
 *
 * Helper functions for extracting usable text
 * from a NewsAPI article.
 */

/**
 * Checks whether a value is a non-empty string.
 */
const hasText = (value) =>
  typeof value === 'string' &&
  value.trim().length > 0;


/**
 * Returns the best text available from an article.
 *
 * Priority:
 *   1. content
 *   2. description
 *   3. title
 *
 * NewsAPI content can contain a "[+N chars]" truncation
 * marker and publishers may return HTML fragments.
 */
function extractText(article) {
  if (hasText(article.content)) {
    return article.content
      .replace(/\s*\[\+\d+ chars\]\s*$/, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (hasText(article.description)) {
    return article.description.trim();
  }

  return article.title?.trim() ?? '';
}


/**
 * Identifies which article field supplied the extracted text.
 */
function textSource(article) {
  if (article.content?.trim()) {
    return 'content';
  }

  if (article.description?.trim()) {
    return 'description';
  }

  return 'title';
}


/**
 * Checks whether NewsAPI marked the content as truncated.
 */
function isContentTruncated(article) {
  const content = article.content;

  return !!(
    content?.includes('[+') &&
    content?.includes('chars]')
  );
}


/**
 * Extracts the date from a bronze blob path.
 *
 * Expected format:
 *   category/YYYY-MM-DD/hash.json
 *
 * Falls back to today's date when the path
 * does not contain a date segment.
 */
function dateFromBlobPath(blobPath) {
  const pathParts = blobPath.split('/');

  return (
    pathParts[1] ??
    new Date().toISOString().split('T')[0]
  );
}


module.exports = {
  extractText,
  textSource,
  isContentTruncated,
  dateFromBlobPath
};