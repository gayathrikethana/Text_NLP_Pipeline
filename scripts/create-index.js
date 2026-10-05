'use strict';

/**
 * scripts/create-index.js
 *
 * Creates or updates the Azure AI Search index using
 * search/index-schema.json.
 *
 * The operation is safe to repeat because createOrUpdateIndex()
 * is idempotent.
 *
 * Azure AI Search field rules:
 *   - New fields can be added.
 *   - Existing field types cannot be changed.
 *   - Existing analyzers cannot be changed.
 *   - The key field cannot be changed.
 *   - Existing fields cannot be removed.
 *
 * For breaking schema changes, create a new index and perform
 * an alias swap using create-search-alias.js.
 *
 * Usage:
 *   node scripts/create-index.js
 *   node scripts/create-index.js --delete
 *
 * WARNING:
 *   --delete removes the existing index and its indexed documents.
 *
 * Required environment variables:
 *   SEARCH_ENDPOINT
 *   SEARCH_API_KEY
 *
 * Optional:
 *   SEARCH_INDEX_NAME
 */

require('dotenv').config({
  path: `${__dirname}/../functions/.env`
});

const {
  SearchIndexClient,
  AzureKeyCredential
} = require('@azure/search-documents');

const fs = require('fs');
const path = require('path');

const searchEndpoint = process.env.SEARCH_ENDPOINT;
const searchApiKey = process.env.SEARCH_API_KEY;
const indexName = process.env.SEARCH_INDEX_NAME ?? 'articles';

const schemaFile = path.join(
  __dirname,
  '../search/index-schema.json'
);

const shouldDeleteIndex =
  process.argv.includes('--delete');

// -----------------------------------------------------------------------------
// Validate environment configuration
// -----------------------------------------------------------------------------

if (!searchEndpoint) {
  console.error('ERROR: SEARCH_ENDPOINT not set');
  process.exit(1);
}

if (!searchApiKey) {
  console.error('ERROR: SEARCH_API_KEY not set');
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Load index schema
// -----------------------------------------------------------------------------

let indexSchema;

try {
  const schemaContent = fs.readFileSync(
    schemaFile,
    'utf-8'
  );

  indexSchema = JSON.parse(schemaContent);
} catch (error) {
  console.error(
    `ERROR: Could not read schema from ${schemaFile}: ` +
    `${error.message}`
  );

  process.exit(1);
}

// The environment variable takes precedence over the
// name stored in the schema file.
indexSchema.name = indexName;

// -----------------------------------------------------------------------------
// Main deployment process
// -----------------------------------------------------------------------------

async function main() {
  const searchClient = new SearchIndexClient(
    searchEndpoint,
    new AzureKeyCredential(searchApiKey)
  );

  console.log(`Search endpoint : ${searchEndpoint}`);
  console.log(`Index name      : ${indexName}`);
  console.log(`Schema file     : ${schemaFile}`);
  console.log(`Force delete    : ${shouldDeleteIndex}`);
  console.log('');

  // ---------------------------------------------------------------------------
  // Optional index deletion
  // ---------------------------------------------------------------------------

  if (shouldDeleteIndex) {
    try {
      await searchClient.deleteIndex(indexName);
      console.log(`Deleted index: ${indexName}`);
    } catch (error) {
      if (error.statusCode === 404) {
        console.log(
          'Index did not exist — skipping delete'
        );
      } else {
        throw error;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Check whether the index already exists
  // ---------------------------------------------------------------------------

  let existingIndex = null;

  try {
    existingIndex = await searchClient.getIndex(indexName);

    console.log(
      `Index exists — updating ` +
      `(${existingIndex.fields.length} fields currently)`
    );
  } catch (error) {
    if (error.statusCode === 404) {
      console.log(
        'Index does not exist — creating fresh'
      );
    } else {
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Check for fields removed from the schema
  // ----------------------------------------------------------------------------

  if (existingIndex) {
    warnAboutRemovedFields(
      existingIndex,
      indexSchema
    );
  }

  // ---------------------------------------------------------------------------
  // Create or update the index
  // ---------------------------------------------------------------------------

  // Remove project-specific comments before sending
  // the schema to Azure AI Search.
  const searchableSchema = stripComments(indexSchema);

  const result =
    await searchClient.createOrUpdateIndex(
      searchableSchema
    );

  console.log('');
  console.log(
    'Index created/updated successfully'
  );

  console.log(`  Name   : ${result.name}`);
  console.log(
    `  Fields : ${result.fields.length}`
  );

  console.log(
    `  Vector profiles : ` +
    `${result.vectorSearch?.profiles?.length ?? 0}`
  );

  console.log(
    `  Semantic configs: ` +
    `${result.semantic?.configurations?.length ?? 0}`
  );

  console.log(
    `  Scoring profiles: ` +
    `${result.scoringProfiles?.length ?? 0}`
  );

  // ---------------------------------------------------------------------------
  // Retrieve index statistics
  // ---------------------------------------------------------------------------

  try {
    const statistics =
      await searchClient.getIndexStatistics(
        indexName
      );

    console.log(
      `  Document count  : ${statistics.documentCount}`
    );

    console.log(
      `  Storage bytes   : ${statistics.storageSize}`
    );
  } catch {
    // Statistics may not be available immediately
    // after creating or updating an index.
    console.log(
      '  (stats not yet available)'
    );
  }
}

// -----------------------------------------------------------------------------
// Schema validation helpers
// -----------------------------------------------------------------------------

function warnAboutRemovedFields(
  existingIndex,
  updatedSchema
) {
  const existingFieldNames = new Set(
    existingIndex.fields.map(field => field.name)
  );

  const schemaFieldNames = new Set(
    updatedSchema.fields.map(field => field.name)
  );

  const removedFields = [
    ...existingFieldNames
  ].filter(
    fieldName => !schemaFieldNames.has(fieldName)
  );

  if (removedFields.length === 0) {
    return;
  }

  console.warn(
    `WARNING: Schema removes existing fields: ` +
    `[${removedFields.join(', ')}]`
  );

  console.warn(
    'Azure AI Search does not allow removing fields from a live index.'
  );

  console.warn(
    'Use --delete to recreate the index, or use ' +
    'create-search-alias.js for a zero-downtime replacement.'
  );

  console.warn(
    'Proceeding anyway — Search will ignore the removal attempt.'
  );
}

// -----------------------------------------------------------------------------
// Remove schema comments before sending the definition to Azure
// -----------------------------------------------------------------------------

const {
  stripComments
} = require('./schemaUtils');

function stripComments(schema) {
  return stripComments(schema);
}

// -----------------------------------------------------------------------------
// Start application
// -----------------------------------------------------------------------------

main().catch(error => {
  console.error(
    'FATAL:',
    error.message ?? error
  );

  process.exit(1);
});