'use strict';

/**
 * queueClient.js
 *
 * Helper functions for working with Azure Storage Queue.
 *
 * Queue:
 *   QUEUE_ENRICH
 *   Default: article-enrich-queue
 *
 * Messages contain a reference to the article that needs
 * NLP enrichment.
 */

const { QueueClient } = require('@azure/storage-queue');
const createLogger = require('./logger');

const logger = createLogger('queueClient');


// -----------------------------------------------------------------------------
// Queue configuration
// -----------------------------------------------------------------------------

const QUEUE_NAME =
  process.env.QUEUE_ENRICH ??
  'article-enrich-queue';

// Processing lock duration: 5 minutes.
const VISIBILITY_TIMEOUT_SECS = 300;

let queueClient = null;


// -----------------------------------------------------------------------------
// Client initialization
// -----------------------------------------------------------------------------

/**
 * Create and cache the Azure Queue client.
 */
async function getClient() {

  if (queueClient) {
    return queueClient;
  }

  const connectionString =
    process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING is not set'
    );
  }

  const client =
    new QueueClient(
      connectionString,
      QUEUE_NAME
    );

  await client.createIfNotExists();

  queueClient = client;

  return queueClient;
}


// -----------------------------------------------------------------------------
// Enqueue operations
// -----------------------------------------------------------------------------

/**
 * Add one article to the enrichment queue.
 *
 * @param {Object} article
 * @param {string} article.blobPath
 * @param {string} article.urlHash
 * @param {string} article.category
 * @param {string} article.ingestedAt
 * @returns {Promise<string>}
 */
async function enqueueArticle({
  blobPath,
  urlHash,
  category,
  ingestedAt
}) {

  const client =
    await getClient();

  const message =
    JSON.stringify({
      blobPath,
      urlHash,
      category,
      ingestedAt
    });

  const result =
    await client.sendMessage(message);

  logger.debug(
    'Enqueued article',
    {
      urlHash,
      messageId: result.messageId
    }
  );

  return result.messageId;
}


/**
 * Add multiple articles to the queue.
 *
 * Messages are sent concurrently because the expected
 * project volume is relatively small.
 */
async function enqueueArticles(articles) {

  const results =
    await Promise.allSettled(
      articles.map(enqueueArticle)
    );

  const successful =
    results.filter(
      result => result.status === 'fulfilled'
    );

  const failed =
    results.filter(
      result => result.status === 'rejected'
    );


  if (failed.length > 0) {

    logger.error(
      'Some enqueue operations failed',
      {
        total: articles.length,
        failed: failed.length,
        errors: failed.map(
          result => result.reason?.message
        )
      }
    );
  }


  return {
    total: articles.length,
    enqueued: successful.length,
    failed: failed.length
  };
}


// -----------------------------------------------------------------------------
// Queue inspection helpers
// -----------------------------------------------------------------------------

/**
 * Peek at queue messages without removing them.
 *
 * Azure Storage Queue allows a maximum of 32 messages
 * to be returned in one peek operation.
 */
async function peekMessages(count = 10) {

  const client =
    await getClient();

  const messageCount =
    Math.min(count, 32);

  const result =
    await client.peekMessages({
      numberOfMessages: messageCount
    });


  return result.peekedMessageItems.map(
    message => {

      try {
        return JSON.parse(
          Buffer
            .from(
              message.messageText,
              'base64'
            )
            .toString('utf-8')
        );
      } catch {
        return message.messageText;
      }

    }
  );
}


/**
 * Return the approximate number of messages
 * currently waiting in the queue.
 */
async function getQueueDepth() {

  const client =
    await getClient();

  const properties =
    await client.getProperties();

  return (
    properties.approximateMessagesCount ??
    0
  );
}


// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  enqueueArticle,
  enqueueArticles,
  peekMessages,
  getQueueDepth,
  VISIBILITY_TIMEOUT_SECS,
  QUEUE_NAME
};