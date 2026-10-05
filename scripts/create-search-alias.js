'use strict';

/**
 * scripts/create-search-alias.js
 *
 * Switches an Azure AI Search alias to a new index version.
 *
 * This is useful when an index change cannot be applied in place,
 * such as changing field types, removing fields, or changing analyzers.
 *
 * Typical workflow:
 *   1. Create a new versioned index, for example articles-v2.
 *   2. Populate the new index from the silver layer.
 *   3. Run this script to move the articles alias to articles-v2.
 *   4. Applications using the alias immediately use the new index.
 *   5. Remove the previous index after validation.
 *
 * Usage:
 *   node scripts/create-search-alias.js \
 *     --alias articles \
 *     --target articles-v2
 *
 * Required environment variables:
 *   SEARCH_ENDPOINT
 *   SEARCH_API_KEY
 */

require('dotenv').config({
  path: `${__dirname}/../functions/.env`
});

const {
  SearchIndexClient,
  AzureKeyCredential
} = require('@azure/search-documents');

const searchEndpoint = process.env.SEARCH_ENDPOINT;
const searchApiKey = process.env.SEARCH_API_KEY;

// -----------------------------------------------------------------------------
// Parse command-line arguments
// -----------------------------------------------------------------------------

const commandArgs = process.argv.slice(2);

function getArgument(flag) {
  const index = commandArgs.indexOf(flag);

  if (index === -1) {
    return null;
  }

  return commandArgs[index + 1] ?? null;
}

const aliasName = getArgument('--alias');
const targetIndexName = getArgument('--target');

// -----------------------------------------------------------------------------
// Validate configuration
// -----------------------------------------------------------------------------

if (!searchEndpoint || !searchApiKey) {
  console.error(
    'ERROR: SEARCH_ENDPOINT and SEARCH_API_KEY must be set'
  );

  process.exit(1);
}

if (!aliasName || !targetIndexName) {
  console.error(
    'Usage: node create-search-alias.js ' +
    '--alias <alias> --target <index>'
  );

  process.exit(1);
}

// -----------------------------------------------------------------------------
// Alias update
// -----------------------------------------------------------------------------

async function main() {
  const searchClient = new SearchIndexClient(
    searchEndpoint,
    new AzureKeyCredential(searchApiKey)
  );

  console.log(`Alias  : ${aliasName}`);
  console.log(`Target : ${targetIndexName}`);
  console.log('');

  // ---------------------------------------------------------------------------
  // Confirm that the destination index exists
  // ---------------------------------------------------------------------------

  try {
    const targetIndex =
      await searchClient.getIndex(targetIndexName);

    console.log(
      `Target index confirmed: ${targetIndex.name} ` +
      `(${targetIndex.fields.length} fields)`
    );
  } catch (error) {
    if (error.statusCode === 404) {
      console.error(
        `ERROR: Target index "${targetIndexName}" does not exist. ` +
        'Create and populate it before switching the alias.'
      );

      process.exit(1);
    }

    throw error;
  }

  // ---------------------------------------------------------------------------
  // Point the alias at the new index
  // ---------------------------------------------------------------------------

  await searchClient.createOrUpdateAlias({
    name: aliasName,
    indexes: [targetIndexName]
  });

  console.log(
    `Alias "${aliasName}" now points to "${targetIndexName}"`
  );

  console.log(
    'Clients using the alias will use the new index.'
  );

  console.log('');
  console.log(
    'After validating the new index, the previous index can be removed with:'
  );

  console.log(
    '  az search index delete --service-name <name> ' +
    '-g <rg> --index-name <old-index> --yes'
  );
}

// -----------------------------------------------------------------------------
// Application entry point
// -----------------------------------------------------------------------------

main().catch(error => {
  console.error(
    'FATAL:',
    error.message ?? error
  );

  process.exit(1);
});