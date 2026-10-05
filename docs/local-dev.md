Local Development Guide
Prerequisites

Install the following tools before setting up the project locally:

# Node.js 18+
node --version   # must be >= 18

# Azure Functions Core Tools v4
npm install -g azure-functions-core-tools@4 --unsafe-perm true

func --version   # must be 4.x

# Azurite - local Blob, Queue, and Table Storage emulator
npm install -g azurite

azurite --version

# Azure CLI
az --version

az login

Python 3.8 or later is only required when testing the Databricks notebook locally:

pip install pyspark delta-spark
Environment Setup

Move into the Functions directory and create the local environment file:

cd functions
cp local.settings.example.txt .env

Open .env and provide the required values.

For most local development settings, the existing defaults can be retained. The following values need to be configured:

Variable	Value	Source
NEWSAPI_KEY	Your NewsAPI key	NewsAPI account
AZURE_STORAGE_CONNECTION_STRING	UseDevelopmentStorage=true	Azurite default
LANGUAGE_ENDPOINT	Language API endpoint	Azure portal → Cognitive Services → Keys and Endpoint
LANGUAGE_API_KEY	Language API key	Same Azure portal page
OPENAI_ENDPOINT	Azure OpenAI endpoint	Azure portal → Azure OpenAI → Keys and Endpoint
OPENAI_API_KEY	Azure OpenAI key	Same Azure portal page
SEARCH_ENDPOINT	Azure AI Search endpoint	Azure portal → AI Search → Overview
SEARCH_API_KEY	Search admin key	Azure portal → AI Search → Keys

Important: Azure Language, Azure OpenAI, and Azure AI Search do not have local emulators. Real Azure resources are therefore required for these components.

Starting the Local Stack
Step 1: Start Azurite

Open a separate terminal and start the local Storage emulator:

mkdir -p .azurite

azurite \
  --location .azurite \
  --debug .azurite/debug.log

Azurite exposes the following local endpoints:

Blob Storage: http://127.0.0.1:10000
Queue Storage: http://127.0.0.1:10001
Table Storage: http://127.0.0.1:10002

Keep this terminal running while testing the application.

The emulator data is stored under .azurite/, so it remains available between local runs.

Step 2: Create the Search Index

Create the Search index the first time you run the application:

node scripts/create-index.js

The operation is idempotent, so the command can safely be executed again.

The index must exist before fn-search-api or fn-index-refresh can operate correctly.

Step 3: Start the Azure Functions

Open another terminal:

cd functions

func start

The Functions host should load the six project functions:

fn-audit-logger:  eventGridTrigger

fn-enrich:        queueTrigger

fn-hash-url:     [GET,POST] http://localhost:7071/api/fn-hash-url

fn-index-refresh: [POST] http://localhost:7071/api/fn-index-refresh

fn-nlp-trigger:  eventGridTrigger

fn-search-api:   [GET] http://localhost:7071/api/fn-search-api
Testing Individual Components
Test fn-hash-url

Send an article URL to the hash function:

curl -X POST http://localhost:7071/api/fn-hash-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.theverge.com/2024/01/15/apple-earnings"}'

Expected response:

{
  "urlHash": "e9bca57a5f8d50f4",
  "url": "https://www.theverge.com/2024/01/15/apple-earnings"
}
Simulate a Logic App Blob Write

For local testing, a sample bronze article can be created directly in Azurite.

Create the sample article:

cat > /tmp/sample-article.json << 'EOF'
{
  "source": {
    "id": "the-verge",
    "name": "The Verge"
  },
  "author": "Jane Doe",
  "title": "Apple reports record quarterly earnings",
  "description": "Apple Inc reported strong Q1 results.",
  "url": "https://www.theverge.com/2024/01/15/apple-earnings",
  "urlToImage": null,
  "publishedAt": "2024-01-15T17:09:12Z",
  "content": "Apple Inc reported record quarterly earnings on Tuesday. [+5204 chars]"
}
EOF

Upload the sample file to the local bronze container:

az storage blob upload \
  --connection-string "UseDevelopmentStorage=true" \
  --container-name articles-bronze \
  --name "technology/$(date +%Y-%m-%d)/test123.json" \
  --file /tmp/sample-article.json \
  --create-container

This directly writes the article to Azurite and therefore bypasses the Logic App.

Trigger the NLP Pipeline Locally

Event Grid itself is not available through Azurite. Therefore, when testing locally, manually invoke fn-nlp-trigger using the Azure Functions admin endpoint:

curl -X POST http://localhost:7071/admin/functions/fn-nlp-trigger \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "eventType": "Microsoft.Storage.BlobCreated",
      "subject": "/blobServices/default/containers/articles-bronze/blobs/technology/2024-01-15/test123.json",
      "eventTime": "2024-01-15T02:00:00Z",
      "data": {
        "url": "http://127.0.0.1:10000/devstoreaccount1/articles-bronze/technology/2024-01-15/test123.json",
        "contentLength": 512
      }
    }
  }'

In the deployed Azure environment, Event Grid automatically generates this event when a bronze blob is created.

Check the Enrichment Queue

After triggering fn-nlp-trigger, inspect the queue:

az storage queue peek \
  --connection-string "UseDevelopmentStorage=true" \
  --name article-enrich-queue \
  --num-messages 5

The queue should contain the article message.

Verify fn-enrich

The queue-triggered fn-enrich function should process the message automatically.

Check the terminal where func start is running. You should see messages similar to:

[fn-enrich] Enrichment started { urlHash: 'test123', category: 'technology' }

[fn-enrich] Enrichment complete { nlpStatus: 'ok', vectorStatus: 'ok' }
Check the Silver Blob

After enrichment completes, check the silver container:

az storage blob list \
  --connection-string "UseDevelopmentStorage=true" \
  --container-name articles-silver \
  --prefix "technology/$(date +%Y-%m-%d)/" \
  --output table

A processed article should be present under the corresponding technology/date path.

Trigger Search Index Refresh

The index refresh function can be called manually:

curl -X POST http://localhost:7071/api/fn-index-refresh \
  -H "Content-Type: application/json" \
  -d "{\"date\": \"$(date +%Y-%m-%d)\", \"category\": \"technology\"}"

A successful response should look similar to:

{
  "date": "...",
  "processed": 1,
  "succeeded": 1,
  "failed": 0,
  "errors": []
}
Search the Indexed Article

Once the article has been indexed, test the Search API:

curl "http://localhost:7071/api/fn-search-api?q=Apple+earnings&category=technology"

The response should contain the indexed article and its associated search metadata.

Running Tests
Unit Tests

Unit tests do not require Azure services:

cd functions

npm test
Smoke Test — Unit Mode

Run the local smoke test:

node scripts/test-pipeline.js

This mode does not require live Azure credentials.

Smoke Test — Integration Mode

For the integration test, make sure the required Azure credentials are configured in .env:

node scripts/test-pipeline.js --integration
Backfilling Data

If bronze articles exist but their corresponding silver documents are missing—for example, because fn-enrich was temporarily unavailable—the backfill utility can be used.

Preview the Backfill

Use --dry-run first:

node scripts/backfill-silver.js \
  --date 2024-01-15 \
  --dry-run
Run the Backfill
node scripts/backfill-silver.js \
  --date 2024-01-15
Backfill a Date Range
node scripts/backfill-silver.js \
  --from 2024-01-01 \
  --to 2024-01-15
Force Re-enrichment

If silver documents already exist but need to be processed again:

node scripts/backfill-silver.js \
  --date 2024-01-15 \
  --force
Common Issues
func start Shows "No functions found"

The Functions host expects the function definitions in the functions/ directory.

Make sure the command is being executed from:

cd functions
func start

and not from the project root.

Queue Trigger Does Not Fire

Azure Functions polls the Azurite Storage queues locally.

Check that:

Azurite is running.
AzureWebJobsStorage is configured as:
UseDevelopmentStorage=true
The queue name is correct.
The Functions host was started from the functions/ directory.
AZURE_STORAGE_CONNECTION_STRING vs AzureWebJobsStorage

Both settings should use the Azurite connection string during local development:

UseDevelopmentStorage=true

AzureWebJobsStorage is required by the Azure Functions runtime, while AZURE_STORAGE_CONNECTION_STRING is used by the application's shared Storage clients.

Both point to the same local Azurite instance.

Language API Returns 401

A common cause is an unwanted space or newline in LANGUAGE_API_KEY.

Check the environment variable with:

node -e "console.log('[' + process.env.LANGUAGE_API_KEY + ']')"

The printed value should not contain leading or trailing whitespace.

Search Index Cannot Be Found

Create the index before starting the Functions host:

node scripts/create-index.js

The articles index must exist before either fn-search-api or fn-index-refresh can use it.

Event Grid Trigger Does Not Fire Locally

Event Grid is an Azure cloud service and is not emulated by Azurite.

For local testing, manually invoke the functions through the Azure Functions admin endpoint as described earlier.

In the deployed Azure environment, Event Grid automatically triggers fn-nlp-trigger and fn-audit-logger when a blob is created.