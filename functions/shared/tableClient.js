'use strict';

/**
 * tableClient.js
 *
 * Azure Table Storage helper for:
 *
 * 1. articleDedup
 *    Used to prevent the same article from being processed repeatedly.
 *
 * 2. articleAudit
 *    Stores pipeline events for monitoring and troubleshooting.
 */

const {
  TableClient,
  TableServiceClient,
  odata
} = require('@azure/data-tables');

const createLogger = require('./logger');

const logger =
  createLogger('tableClient');


// -----------------------------------------------------------------------------
// Table configuration
// -----------------------------------------------------------------------------

const DEDUP_TABLE =
  process.env.TABLE_DEDUP ??
  'articleDedup';

const AUDIT_TABLE =
  process.env.TABLE_AUDIT ??
  'articleAudit';


// Table clients are created only when they are first needed.
const clients = {};


// -----------------------------------------------------------------------------
// Client creation
// -----------------------------------------------------------------------------

/**
 * Get a cached TableClient for the requested table.
 */
function getClient(tableName) {

  if (clients[tableName]) {
    return clients[tableName];
  }

  const connectionString =
    process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING is not set'
    );
  }

  clients[tableName] =
    TableClient.fromConnectionString(
      connectionString,
      tableName
    );

  return clients[tableName];
}


/**
 * Create the required tables if they do not already exist.
 *
 * This can be called during a function cold start.
 */
async function ensureTables() {

  const connectionString =
    process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error(
      'AZURE_STORAGE_CONNECTION_STRING is not set'
    );
  }

  const service =
    TableServiceClient.fromConnectionString(
      connectionString
    );


  const tableNames = [
    DEDUP_TABLE,
    AUDIT_TABLE
  ];


  for (const tableName of tableNames) {

    try {

      await service.createTable(
        tableName
      );

      logger.info(
        'Table created',
        {
          name: tableName
        }
      );

    } catch (error) {

      // A 409 or TableAlreadyExists means
      // the table is already available.
      const alreadyExists =
        error.statusCode === 409 ||
        error.message?.includes(
          'TableAlreadyExists'
        );

      if (!alreadyExists) {
        throw error;
      }
    }
  }
}


// -----------------------------------------------------------------------------
// Deduplication
// -----------------------------------------------------------------------------

/**
 * Check whether an article has already been ingested.
 *
 * @returns {Promise<boolean>}
 *   true  -> article already exists
 *   false -> article is new
 */
async function isDuplicate(urlHash) {

  const client =
    getClient(DEDUP_TABLE);

  const partitionKey =
    urlHash.substring(0, 2);


  try {

    await client.getEntity(
      partitionKey,
      urlHash
    );

    return true;

  } catch (error) {

    // Missing entity means this is a new article.
    if (error.statusCode === 404) {
      return false;
    }

    throw error;
  }
}


/**
 * Add an article to the deduplication table.
 */
async function markIngested(
  urlHash,
  {
    url,
    category,
    ingestedAt
  }
) {

  const client =
    getClient(DEDUP_TABLE);

  const partitionKey =
    urlHash.substring(0, 2);


  await client.upsertEntity(
    {
      partitionKey,
      rowKey: urlHash,
      url,
      category,
      ingestedAt
    },
    'Replace'
  );


  logger.debug(
    'Marked ingested',
    {
      urlHash
    }
  );
}


// -----------------------------------------------------------------------------
// Audit logging
// -----------------------------------------------------------------------------

/**
 * Record an event associated with an article.
 *
 * @param {string} urlHash
 * @param {string} event
 * @param {object} details
 */
async function logAuditEvent(
  urlHash,
  event,
  details = {}
) {

  const client =
    getClient(AUDIT_TABLE);

  const timestamp =
    new Date().toISOString();

  const dateKey =
    timestamp.split('T')[0];

  const rowKey =
    `${urlHash}_${event}_${Date.now()}`;


  await client.upsertEntity(
    {
      partitionKey: dateKey,
      rowKey,
      urlHash,
      event,
      details: JSON.stringify(details),
      ts: timestamp
    },
    'Replace'
  );


  logger.debug(
    'Audit event written',
    {
      urlHash,
      event
    }
  );
}


// -----------------------------------------------------------------------------
// Audit queries
// -----------------------------------------------------------------------------

/**
 * Retrieve all audit records for a particular date.
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function getAuditsByDate(
  dateStr
) {

  const client =
    getClient(AUDIT_TABLE);

  const filter =
    odata`PartitionKey eq ${dateStr}`;

  const auditRecords = [];


  for await (
    const entity of client.listEntities({
      queryOptions: {
        filter
      }
    })
  ) {

    auditRecords.push(entity);
  }


  return auditRecords;
}


// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

module.exports = {
  ensureTables,
  isDuplicate,
  markIngested,
  logAuditEvent,
  getAuditsByDate
};