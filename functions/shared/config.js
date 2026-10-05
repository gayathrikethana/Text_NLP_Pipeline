'use strict';

/**
 * config.js
 *
 * Central configuration used by the NLP pipeline.
 *
 * Keep shared values here instead of hardcoding them
 * in individual functions or scripts.
 *
 * The ingestion categories are shared by the Logic App,
 * fn-index-refresh, and Databricks processing.
 */


/**
 * Categories retrieved from NewsAPI.
 *
 * INGEST_CATEGORIES can be overridden through an environment
 * variable containing comma-separated category names.
 *
 * Example:
 *   INGEST_CATEGORIES=technology,business
 */
const INGEST_CATEGORIES = process.env.INGEST_CATEGORIES
  ? process.env.INGEST_CATEGORIES
      .split(',')
      .map(category => category.trim())
      .filter(Boolean)
  : [
      'technology',
      'business',
      'science',
      'health'
    ];


/**
 * Azure Blob Storage container names.
 */
const CONTAINERS = {
  BRONZE:
    process.env.BLOB_CONTAINER_BRONZE ??
    'articles-bronze',

  SILVER:
    process.env.BLOB_CONTAINER_SILVER ??
    'articles-silver',

  GOLD:
    process.env.ADLS_CONTAINER_GOLD ??
    'articles-gold',

  ERROR:
    'articles-error'
};


/**
 * Azure Table Storage table names.
 */
const TABLES = {
  DEDUP:
    process.env.TABLE_DEDUP ??
    'articleDedup',

  AUDIT:
    process.env.TABLE_AUDIT ??
    'articleAudit'
};


/**
 * Azure Storage Queue names.
 */
const QUEUES = {
  ENRICH:
    process.env.QUEUE_ENRICH ??
    'article-enrich-queue'
};


module.exports = {
  INGEST_CATEGORIES,
  CONTAINERS,
  TABLES,
  QUEUES
};