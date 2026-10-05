'use strict';

/**
 * scripts/register-purview-lineage.js
 *
 * Registers custom data lineage in Microsoft Purview through the
 * Apache Atlas REST API.
 *
 * Custom lineage covered here:
 *
 *   NewsAPI
 *      │
 *      └── Logic App ──► articles-bronze
 *                            │
 *                            └── fn-enrich ──► articles-silver
 *                                                  │
 *                                                  ├── ADF/Databricks ──► articles-gold
 *                                                  │
 *                                                  └── fn-index-refresh ──► Search index
 *
 * Purview can automatically discover some Azure pipeline lineage,
 * but custom Azure Functions require explicit lineage registration.
 *
 * Usage:
 *   node scripts/register-purview-lineage.js
 *
 * Required environment variables:
 *   PURVIEW_ENDPOINT
 *   PURVIEW_CLIENT_ID
 *   PURVIEW_CLIENT_SECRET
 *   PURVIEW_TENANT_ID
 *   STORAGE_ACCOUNT_NAME
 *   SEARCH_SERVICE_NAME
 */

require('dotenv').config({
  path: `${__dirname}/../functions/.env`
});

const axios = require('../functions/node_modules/axios');

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const purviewEndpoint = process.env.PURVIEW_ENDPOINT;
const clientId = process.env.PURVIEW_CLIENT_ID;
const clientSecret = process.env.PURVIEW_CLIENT_SECRET;
const tenantId = process.env.PURVIEW_TENANT_ID;

const storageAccountName =
  process.env.STORAGE_ACCOUNT_NAME;

const searchServiceName =
  process.env.SEARCH_SERVICE_NAME;

const bronzeContainer =
  process.env.BLOB_CONTAINER_BRONZE ??
  'articles-bronze';

const silverContainer =
  process.env.BLOB_CONTAINER_SILVER ??
  'articles-silver';

const searchIndexName =
  process.env.SEARCH_INDEX_NAME ??
  'articles';

// -----------------------------------------------------------------------------
// Validate required configuration
// -----------------------------------------------------------------------------

const requiredSettings = {
  PURVIEW_ENDPOINT: purviewEndpoint,
  PURVIEW_CLIENT_ID: clientId,
  PURVIEW_CLIENT_SECRET: clientSecret,
  PURVIEW_TENANT_ID: tenantId,
  STORAGE_ACCOUNT_NAME: storageAccountName,
  SEARCH_SERVICE_NAME: searchServiceName
};

const missingSettings = Object.entries(
  requiredSettings
)
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingSettings.length > 0) {
  console.error(
    'Missing required environment variables:',
    missingSettings.join(', ')
  );

  process.exit(1);
}

// -----------------------------------------------------------------------------
// Azure AD authentication
// -----------------------------------------------------------------------------

async function getPurviewToken() {
  const tokenEndpoint =
    `https://login.microsoftonline.com/` +
    `${tenantId}/oauth2/v2.0/token`;

  const requestBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://purview.azure.net/.default'
  });

  const response = await axios.post(
    tokenEndpoint,
    requestBody.toString(),
    {
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      }
    }
  );

  return response.data.access_token;
}

// -----------------------------------------------------------------------------
// Atlas client
// -----------------------------------------------------------------------------

function createAtlasClient(accessToken) {
  return axios.create({
    baseURL:
      `${purviewEndpoint}/catalog/api/atlas/v2`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
}

// -----------------------------------------------------------------------------
// Atlas entity operations
// -----------------------------------------------------------------------------

async function upsertEntities(
  atlasClient,
  entities
) {
  const response = await atlasClient.post(
    '/entity/bulk',
    { entities }
  );

  return response.data;
}

// -----------------------------------------------------------------------------
// Data asset builders
// -----------------------------------------------------------------------------

function createBlobContainerEntity(
  containerName
) {
  const isBronze =
    containerName === bronzeContainer;

  return {
    typeName: 'azure_datalake_gen2_filesystem',

    attributes: {
      qualifiedName:
        `https://${storageAccountName}` +
        `.dfs.core.windows.net/${containerName}`,

      name: containerName,

      description: isBronze
        ? 'Raw NewsAPI article JSON ingested by the Logic App.'
        : 'NLP-enriched articles containing sentiment, entities, key phrases, and embeddings.'
    }
  };
}

function createNewsApiEntity() {
  return {
    typeName: 'DataSet',

    attributes: {
      qualifiedName:
        'https://newsapi.org/v2/top-headlines',

      name: 'NewsAPI Top Headlines',

      description:
        'External news source polled every six hours for ' +
        'technology, business, science, and health categories.'
    }
  };
}

function createSearchIndexEntity() {
  return {
    typeName: 'azure_search_index',

    attributes: {
      qualifiedName:
        `https://${searchServiceName}` +
        `.search.windows.net/indexes/${searchIndexName}`,

      name: searchIndexName,

      description:
        'Azure AI Search index supporting hybrid BM25 and HNSW vector search.'
    }
  };
}

// -----------------------------------------------------------------------------
// Process entity builder
// -----------------------------------------------------------------------------

function createProcessEntity({
  name,
  qualifiedName,
  description,
  inputs,
  outputs
}) {
  return {
    typeName: 'Process',

    attributes: {
      qualifiedName,
      name,
      description,
      inputs,
      outputs
    }
  };
}

// -----------------------------------------------------------------------------
// Main registration workflow
// -----------------------------------------------------------------------------

async function main() {
  console.log('Purview Lineage Registration');
  console.log('='.repeat(50));

  console.log(
    `Purview endpoint : ${purviewEndpoint}`
  );

  console.log(
    `Storage account  : ${storageAccountName}`
  );

  console.log(
    `Search service   : ${searchServiceName}`
  );

  console.log('');

  // ---------------------------------------------------------------------------
  // Step 1: Authenticate
  // ---------------------------------------------------------------------------

  console.log(
    'Step 1: Authenticating with Azure AD...'
  );

  let accessToken;

  try {
    accessToken = await getPurviewToken();
    console.log('  ✓ Token acquired');
  } catch (error) {
    console.error(
      '  ✗ Authentication failed:',
      error.response?.data ?? error.message
    );

    process.exit(1);
  }

  const atlasClient =
    createAtlasClient(accessToken);

  // ---------------------------------------------------------------------------
  // Step 2: Register storage and Search entities
  // ---------------------------------------------------------------------------

  console.log(
    '\nStep 2: Registering data asset entities...'
  );

  const bronzeAsset =
    createBlobContainerEntity(
      bronzeContainer
    );

  const silverAsset =
    createBlobContainerEntity(
      silverContainer
    );

  const searchAsset =
    createSearchIndexEntity();

  try {
    await upsertEntities(
      atlasClient,
      [
        bronzeAsset,
        silverAsset,
        searchAsset
      ]
    );

    console.log(
      '  ✓ articles-bronze entity registered'
    );

    console.log(
      '  ✓ articles-silver entity registered'
    );

    console.log(
      '  ✓ articles Search index entity registered'
    );
  } catch (error) {
    console.error(
      '  ✗ Data asset registration failed:',
      error.response?.data ?? error.message
    );

    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Step 3: NewsAPI → Bronze
  // ---------------------------------------------------------------------------

  console.log(
    '\nStep 3: Registering Logic App lineage (NewsAPI → bronze)...'
  );

  const newsApiAsset =
    createNewsApiEntity();

  try {
    await upsertEntities(
      atlasClient,
      [newsApiAsset]
    );

    console.log(
      '  ✓ NewsAPI source entity registered'
    );
  } catch (error) {
    console.error(
      '  ✗ NewsAPI entity registration failed:',
      error.response?.data ?? error.message
    );

    process.exit(1);
  }

  const ingestionProcess =
    createProcessEntity({
      name:
        'Logic App — NewsAPI Ingestion',

      qualifiedName:
        'nlp-pipeline://logic-app-ingestor',

      description: [
        'Azure Logic App polls NewsAPI /v2/top-headlines every six hours.',
        'Processes technology, business, science, and health categories.',
        'Uses fn-hash-url to generate a SHA-256 URL-based article identifier.',
        'Writes article JSON to the articles-bronze container.',
        'Uses managed identity authentication for Blob Storage.'
      ].join(' '),

      inputs: [
        {
          typeName:
            newsApiAsset.typeName,

          uniqueAttributes: {
            qualifiedName:
              newsApiAsset.attributes.qualifiedName
          }
        }
      ],

      outputs: [
        {
          typeName:
            bronzeAsset.typeName,

          uniqueAttributes: {
            qualifiedName:
              bronzeAsset.attributes.qualifiedName
          }
        }
      ]
    });

  try {
    await upsertEntities(
      atlasClient,
      [ingestionProcess]
    );

    console.log(
      '  ✓ Logic App process entity registered'
    );

    console.log(
      '    NewsAPI ──[Logic App]──► articles-bronze'
    );
  } catch (error) {
    console.error(
      '  ✗ Logic App lineage registration failed:',
      error.response?.data ?? error.message
    );

    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Step 4: Bronze → Silver
  // ---------------------------------------------------------------------------

  console.log(
    '\nStep 4: Registering fn-enrich lineage (bronze → silver)...'
  );

  const enrichmentProcess =
    createProcessEntity({
      name:
        'fn-enrich — NLP Enrichment',

      qualifiedName:
        'nlp-pipeline://fn-enrich',

      description: [
        'Azure Function triggered by article-enrich-queue.',
        'Reads raw article JSON from articles-bronze.',
        'Uses Azure Language API for sentiment, NER, and key phrases.',
        'Generates 1536-dimensional embeddings with Azure OpenAI.',
        'Writes the enriched document to articles-silver.',
        'Sets hasPii=true when Person, PhoneNumber, or Email entities are detected.'
      ].join(' '),

      inputs: [
        {
          typeName:
            bronzeAsset.typeName,

          uniqueAttributes: {
            qualifiedName:
              bronzeAsset.attributes.qualifiedName
          }
        }
      ],

      outputs: [
        {
          typeName:
            silverAsset.typeName,

          uniqueAttributes: {
            qualifiedName:
              silverAsset.attributes.qualifiedName
          }
        }
      ]
    });

  try {
    await upsertEntities(
      atlasClient,
      [enrichmentProcess]
    );

    console.log(
      '  ✓ fn-enrich process entity registered'
    );

    console.log(
      '    articles-bronze ──[fn-enrich]──► articles-silver'
    );
  } catch (error) {
    console.error(
      '  ✗ fn-enrich lineage registration failed:',
      error.response?.data ?? error.message
    );

    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Step 5: Silver → Search
  // ---------------------------------------------------------------------------

  console.log(
    '\nStep 5: Registering fn-index-refresh lineage (silver → Search)...'
  );

  const searchRefreshProcess =
    createProcessEntity({
      name:
        'fn-index-refresh — Search Index Refresh',

      qualifiedName:
        'nlp-pipeline://fn-index-refresh',

      description: [
        'Azure Function invoked by the ADF WebActivity.',
        'Reads silver documents for the requested date and category.',
        'Maps silver documents to the Azure AI Search schema.',
        'Upserts documents into the articles Search index.',
        'Returns 207 when some documents fail to index.'
      ].join(' '),

      inputs: [
        {
          typeName:
            silverAsset.typeName,

          uniqueAttributes: {
            qualifiedName:
              silverAsset.attributes.qualifiedName
          }
        }
      ],

      outputs: [
        {
          typeName:
            searchAsset.typeName,

          uniqueAttributes: {
            qualifiedName:
              searchAsset.attributes.qualifiedName
          }
        }
      ]
    });

  try {
    await upsertEntities(
      atlasClient,
      [searchRefreshProcess]
    );

    console.log(
      '  ✓ fn-index-refresh process entity registered'
    );

    console.log(
      '    articles-silver ──[fn-index-refresh]──► articles'
    );
  } catch (error) {
    console.error(
      '  ✗ fn-index-refresh lineage registration failed:',
      error.response?.data ?? error.message
    );

    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log('');
  console.log('='.repeat(50));
  console.log(
    'Lineage registration complete.'
  );

  console.log('');
  console.log('Full lineage graph:');
  console.log(
    '  NewsAPI (https://newsapi.org)'
  );
  console.log(
    '    └─[Logic App]────────────► articles-bronze'
  );
  console.log(
    '         └─[fn-enrich]────────► articles-silver'
  );
  console.log(
    '              ├─[ADF/Databricks]──► articles-gold'
  );
  console.log(
    '              └─[fn-index-refresh]──► articles'
  );

  console.log('');
  console.log('View the catalog in Purview:');
  console.log(
    `  ${purviewEndpoint}/governance/catalog`
  );

  console.log(
    '  Data Map → Browse → Azure Data Lake Storage Gen2 → articles-silver → Lineage'
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