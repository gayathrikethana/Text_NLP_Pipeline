# Text NLP Pipeline — Project Plan

## 1. Project Overview

### Objective

Build an end-to-end Azure-based NLP pipeline that:

* Collects news articles from NewsAPI.
* Stores the incoming articles in the bronze/raw layer.
* Enriches articles with sentiment analysis, named entities, key phrases, and vector embeddings.
* Stores enriched data in the silver layer.
* Creates analytical gold datasets for trends and aggregations.
* Indexes article metadata and embeddings in Azure AI Search.
* Supports hybrid keyword + vector search.
* Exposes the search capability through an API.
* Provides governance and lineage through Microsoft Purview.

### Technology Stack

```text
Azure Logic Apps
Azure Functions (Node.js)
Azure Blob Storage
Azure Data Lake Storage Gen2
Azure Cognitive Services - Language API
Azure OpenAI
Azure Databricks
Azure AI Search
Azure API Management
Microsoft Purview
```

### Main Constraint

NewsAPI's free plan allows:

```text
100 requests/day
100 articles/request
```

Therefore, the theoretical maximum is:

```text
100 × 100 = 10,000 articles/day
```

The implementation intentionally operates below this limit.

---

# 2. Architecture Decisions

## ADR-001 — Choosing Logic Apps for Scheduled Ingestion

### Decision

Use **Azure Logic Apps** as the NewsAPI scheduler.

### Why

Logic Apps already provide:

* Recurrence triggers
* HTTP connectors
* JSON handling
* Looping
* Blob Storage integration
* Event Grid integration

Using ADF only for API polling would add unnecessary infrastructure because ADF is more appropriate for data movement and batch orchestration.

The Logic App therefore handles the lightweight scheduled ingestion workload, while ADF is reserved for the nightly analytical pipeline.

---

## ADR-002 — Event Grid for Blob Event Fan-Out

### Decision

Use **Azure Event Grid** rather than Event Hub.

### Why

The pipeline needs to react when a new article is written to Blob Storage.

Event Grid is suitable because it:

* Works directly with BlobCreated events.
* Uses a push-based model.
* Fits serverless workloads.
* Requires little infrastructure management.

Event Hub would be more appropriate for very high-volume streaming workloads. The expected article volume is much lower than that use case.

---

## ADR-003 — URL Hash for Deduplication

### Decision

Use a SHA-256 hash of the article URL as the unique ingestion identifier.

### Processing

```text
Article URL
    ↓
SHA-256
    ↓
URL hash
    ↓
Table Storage deduplication record
```

The resulting hash is used to determine whether an article has already been processed.

If the hash already exists, the article is skipped.

This makes repeated Logic App executions idempotent.

---

## ADR-004 — Azure Function for NLP Processing

### Decision

Use an **Azure Function running Node.js** for article enrichment.

### Why

The processing chain naturally fits:

```text
Event Grid
    ↓
Azure Function
    ↓
Storage Queue
    ↓
Enrichment Function
```

The Function can also handle the Language API document limit by splitting articles into batches of 10.

Functions provide automatic scaling without requiring a dedicated VM or container.

---

## ADR-005 — Embedding Model

### Decision

Use:

```text
text-embedding-ada-002
```

through Azure OpenAI.

### Why

The selected model produces:

```text
1536-dimensional vectors
```

These vectors can be stored in Azure AI Search and searched using HNSW vector similarity with cosine distance.

The embedding is generated per article because the Language API and embedding calls are already processed concurrently within the enrichment workflow.

---

## ADR-006 — Databricks for Gold Processing

### Decision

Use an Azure Databricks PySpark notebook for the gold layer.

### Why

Databricks provides:

* Spark-based aggregations
* Delta Lake
* MERGE/upsert support
* Rolling-window calculations
* Scalable analytical processing
* MLflow integration

The gold layer therefore performs the larger analytical calculations outside the individual Azure Functions.

---

## ADR-007 — Hybrid Search

### Decision

Combine:

```text
BM25 keyword search
        +
HNSW vector search
        ↓
Reciprocal Rank Fusion (RRF)
```

### Why

Keyword search works well for exact queries such as:

```text
Apple Inc Q3 earnings
```

Vector search is better for queries where the wording differs but the meaning is similar.

Combining both approaches provides better coverage.

An optional semantic ranker can further rerank the top results.

---

## ADR-008 — API Security

### Decision

Put Azure API Management in front of the search Function.

Authentication uses:

```text
OAuth 2.0
+
JWT validation
+
APIM subscription rate limiting
```

The Function itself does not perform the primary authentication.

Instead:

```text
Client
  ↓
APIM
  ↓
JWT validation
  ↓
Rate limiting
  ↓
Search Function
```

This keeps authentication and API protection at the gateway boundary.

---

## ADR-009 — Article Storage

### Decision

Keep full article content in ADLS Gen2 and use Azure AI Search primarily for searchable metadata and vectors.

The Search index contains fields such as:

```text
id
url
title
source
category
published_at
sentiment_score
sentiment_label
entities
key_phrases
content_vector
```

Full article content remains in storage rather than making the Search index the primary document store.

---

# 3. End-to-End Data Flow

```text
NewsAPI
   │
   │ Scheduled requests
   ▼
Logic App
   │
   │ News articles
   ▼
Blob Storage
   │
   │ Bronze / raw data
   ▼
Event Grid
   ├───────────────────────┐
   ▼                       ▼
fn-nlp-trigger       fn-audit-logger
   │                       │
   │                       └── Audit Table
   ▼
Azure Storage Queue
   │
   ▼
fn-enrich
   │
   ├── Azure Language
   │     ├── Sentiment
   │     ├── NER
   │     └── Key phrases
   │
   ├── Azure OpenAI
   │     └── Embedding
   │
   ▼
ADLS Gen2
   │
   │ Silver layer
   ▼
ADF nightly pipeline
   │
   ├── Validate silver layer
   │
   ├── Databricks
   │      └── Gold aggregations
   │
   └── fn-index-refresh
              │
              ▼
       Azure AI Search
              │
              ▼
        fn-search-api
              │
              ▼
             APIM
              │
              ▼
           Consumers
```

---

# 4. Analytical Gold Layer

The nightly ADF workflow runs at:

```text
02:00 UTC
```

The Databricks notebook produces three primary analytical datasets.

### Sentiment Trends

```text
sentiment_trends_by_category
```

Uses a rolling seven-day window.

### Entity Analysis

```text
top_entities_per_week
```

Provides frequently occurring entities by category.

### Keyword Trends

```text
trending_keywords
```

Uses a rolling three-day window to identify changing keyword frequency.

Gold output is stored under:

```text
gold/{report_type}/{date}/
```

---

# 5. Azure AI Search

The Search index uses both textual and vector fields.

```text
Keyword fields
    ├── title
    ├── body_snippet
    ├── category
    ├── source
    └── entities

Vector field
    └── content_vector
```

The vector configuration uses:

```text
Dimensions: 1536
Algorithm: HNSW
Metric: cosine
```

Search requests can therefore combine exact keyword matching with semantic similarity.

---

# 6. API Layer

The search Function receives requests such as:

```http
GET /api/search?q=Apple earnings&category=business&top=10&semantic=true
```

Authentication:

```http
Authorization: Bearer <JWT>
```

The response contains:

```json
{
  "count": 10,
  "results": [
    {
      "id": "abc123",
      "title": "...",
      "url": "...",
      "score": 0.94,
      "sentiment_label": "positive",
      "entities": [
        "Apple",
        "Tim Cook"
      ],
      "key_phrases": [
        "quarterly earnings"
      ],
      "published_at": "2024-01-15T00:00:00Z"
    }
  ],
  "trends": null
}
```

---

# 7. Project Structure

```text
nlp-pipeline/
│
├── README.md
├── .env.example
├── .gitignore
├── package.json
│
├── infra/
│   ├── main.bicep
│   ├── parameters.json
│   │
│   ├── modules/
│   │   ├── storage.bicep
│   │   ├── functions.bicep
│   │   ├── logic-app.bicep
│   │   ├── eventgrid.bicep
│   │   ├── cognitive.bicep
│   │   ├── databricks.bicep
│   │   ├── search.bicep
│   │   ├── apim.bicep
│   │   └── purview.bicep
│   │
│   └── adf/
│       ├── pipeline_nlp_nightly.json
│       ├── dataset_silver_container.json
│       └── trigger_nightly_schedule.json
│
├── functions/
│   ├── package.json
│   ├── host.json
│   ├── local.settings.json.example
│   │
│   ├── shared/
│   │   ├── blobClient.js
│   │   ├── tableClient.js
│   │   ├── queueClient.js
│   │   ├── languageClient.js
│   │   ├── openaiClient.js
│   │   ├── searchClient.js
│   │   └── logger.js
│   │
│   ├── fn-nlp-trigger/
│   │   ├── function.json
│   │   └── index.js
│   │
│   ├── fn-audit-logger/
│   │   ├── function.json
│   │   └── index.js
│   │
│   ├── fn-enrich/
│   │   ├── function.json
│   │   └── index.js
│   │
│   ├── fn-index-refresh/
│   │   ├── function.json
│   │   └── index.js
│   │
│   └── fn-search-api/
│       ├── function.json
│       └── index.js
│
├── logic-app/
│   └── workflow.json
│
├── databricks/
│   ├── gold_aggregation.py
│   └── utils/
│       └── delta_helpers.py
│
├── search/
│   └── index-schema.json
│
├── apim/
│   ├── inbound-policy.xml
│   └── outbound-policy.xml
│
├── purview/
│   ├── classification-rules.json
│   └── scan-config.json
│
├── scripts/
│   ├── create-index.js
│   ├── create-search-alias.js
│   ├── backfill-silver.js
│   └── test-pipeline.js
│
└── docs/
    ├── architecture.md
    ├── local-dev.md
    ├── deployment.md
    └── api-reference.md
```

---

# 8. Environment Configuration

The `.env.example` file contains the following configuration groups.

```bash
# NewsAPI
NEWSAPI_KEY=

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=

BLOB_CONTAINER_BRONZE=articles-bronze
BLOB_CONTAINER_SILVER=articles-silver
ADLS_CONTAINER_GOLD=articles-gold

TABLE_DEDUP=articleDedup
TABLE_AUDIT=articleAudit

QUEUE_ENRICH=article-enrich-queue

# Azure Language
LANGUAGE_ENDPOINT=https://<name>.cognitiveservices.azure.com/
LANGUAGE_API_KEY=
LANGUAGE_API_VERSION=2023-04-01

# Azure OpenAI
OPENAI_ENDPOINT=https://<name>.openai.azure.com/
OPENAI_API_KEY=
OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-ada-002

# Azure AI Search
SEARCH_ENDPOINT=https://<name>.search.windows.net
SEARCH_API_KEY=
SEARCH_INDEX_NAME=articles

# API Management
APIM_ENDPOINT=https://<name>.azure-api.net
APIM_SUBSCRIPTION_KEY=

# Databricks
DATABRICKS_HOST=https://<workspace>.azuredatabricks.net
DATABRICKS_TOKEN=
DATABRICKS_CLUSTER_ID=

# Application Insights
APPINSIGHTS_INSTRUMENTATIONKEY=
```

---

# 9. AI Search Index Schema

The core Search fields are:

```json
{
  "name": "articles",
  "fields": [
    {
      "name": "id",
      "type": "Edm.String",
      "key": true,
      "filterable": true
    },
    {
      "name": "url",
      "type": "Edm.String",
      "retrievable": true
    },
    {
      "name": "title",
      "type": "Edm.String",
      "searchable": true,
      "analyzer": "en.microsoft"
    },
    {
      "name": "body_snippet",
      "type": "Edm.String",
      "searchable": true,
      "analyzer": "en.microsoft"
    },
    {
      "name": "source",
      "type": "Edm.String",
      "filterable": true,
      "facetable": true
    },
    {
      "name": "category",
      "type": "Edm.String",
      "filterable": true,
      "facetable": true
    },
    {
      "name": "published_at",
      "type": "Edm.DateTimeOffset",
      "sortable": true,
      "filterable": true
    },
    {
      "name": "sentiment_label",
      "type": "Edm.String",
      "filterable": true,
      "facetable": true
    },
    {
      "name": "sentiment_score",
      "type": "Edm.Double",
      "sortable": true
    },
    {
      "name": "entities",
      "type": "Collection(Edm.String)",
      "searchable": true,
      "filterable": true
    },
    {
      "name": "key_phrases",
      "type": "Collection(Edm.String)",
      "searchable": true
    },
    {
      "name": "content_vector",
      "type": "Collection(Edm.Single)",
      "dimensions": 1536,
      "vectorSearchProfile": "hnsw-cosine"
    }
  ],
  "vectorSearch": {
    "algorithms": [
      {
        "name": "hnsw-config",
        "kind": "hnsw",
        "parameters": {
          "m": 4,
          "metric": "cosine"
        }
      }
    ],
    "profiles": [
      {
        "name": "hnsw-cosine",
        "algorithm": "hnsw-config"
      }
    ]
  },
  "semanticSearch": {
    "configurations": [
      {
        "name": "semantic-config",
        "prioritizedFields": {
          "titleField": {
            "fieldName": "title"
          },
          "contentFields": [
            {
              "fieldName": "body_snippet"
            }
          ],
          "keywordsFields": [
            {
              "fieldName": "key_phrases"
            }
          ]
        }
      }
    ]
  }
}
```

---

# 10. Function Contracts

## fn-enrich Queue Message

```json
{
  "blobPath": "raw/technology/2024-01-15/abc123.json",
  "urlHash": "abc123",
  "category": "technology",
  "ingestedAt": "2024-01-15T02:00:00Z"
}
```

---

## Silver Article Schema

```json
{
  "id": "abc123",
  "url": "https://...",
  "title": "...",
  "body_snippet": "first 500 chars of content",
  "source": "BBC",
  "category": "technology",
  "published_at": "2024-01-15T00:00:00Z",
  "sentiment": {
    "label": "positive",
    "score": 0.87
  },
  "entities": [
    {
      "text": "Apple",
      "category": "Organization"
    }
  ],
  "key_phrases": [
    "quarterly earnings",
    "revenue growth"
  ],
  "content_vector": [
    0.012,
    -0.034
  ],
  "enriched_at": "2024-01-15T02:05:00Z"
}
```

---

# 11. Error Handling

| Pipeline Area | Failure                  | Handling                                                                                  |
| ------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| Ingestion     | NewsAPI rate limit       | Retry three times using exponential backoff and use a dead-letter path for failed batches |
| Ingestion     | Duplicate article        | Check URL hash in Table Storage and skip existing records                                 |
| Enrichment    | Language API failure     | Handle each article independently and write failed records to the error location          |
| Enrichment    | OpenAI timeout           | Retry the request and allow the silver record to remain without a completed vector        |
| Indexing      | Search upsert failure    | Process documents in batches and retry failed batches                                     |
| ADF           | Databricks failure       | Keep previous gold data and notify through pipeline failure handling                      |
| API           | Invalid search request   | Return a structured HTTP 400 response                                                     |
| API           | Repeated failed requests | Allow APIM error caching for a short period                                               |

---

# 12. Local Development

## Local Components

The following parts can run locally:

```text
Azurite
Azure Functions Core Tools v4
NewsAPI
Databricks notebook with PySpark
```

The following services require Azure resources unless mocked:

```text
Azure Language API
Azure OpenAI
Azure AI Search
```

### Local Storage

Azurite provides local replacements for:

```text
Blob Storage
Table Storage
Queue Storage
```

### Local Function Runtime

Azure Functions Core Tools v4 runs the Functions application locally.

### NewsAPI

A real NewsAPI key is required for live article ingestion.

### NLP Services

Language and OpenAI can either use Azure endpoints or be replaced with mock implementations during local development.

### Search

There is no local Azure AI Search emulator in this implementation, so a real Search resource is required.

### Databricks

The Databricks processing notebook can be executed locally using PySpark.

---

# 13. Local Execution Sequence

Run the local environment in this order:

```text
1. Start Azurite
       ↓
2. Start Azure Functions
       ↓
3. Trigger ingestion/test pipeline
       ↓
4. Monitor Storage Queue
       ↓
5. Run article enrichment
       ↓
6. Verify silver output
       ↓
7. Refresh Search index
       ↓
8. Test Search API
```

---

# 14. Deployment Sequence

Deploy the infrastructure in dependency order.

### 1. Storage

```text
infra/modules/storage.bicep
```

Creates:

```text
Blob Storage
ADLS Gen2
Table Storage
Queue Storage
```

### 2. Cognitive Services

```text
infra/modules/cognitive.bicep
```

Provides:

```text
Language API
Azure OpenAI
```

### 3. Functions

```text
infra/modules/functions.bicep
```

Deploy the Function App and its application settings.

### 4. Event Grid

```text
infra/modules/eventgrid.bicep
```

Connect BlobCreated events to the relevant Functions.

### 5. Logic App

```text
infra/modules/logic-app.bicep
```

Configure the NewsAPI ingestion workflow.

### 6. Create Search Index

```bash
node scripts/create-index.js
```

### 7. Search Infrastructure

Deploy:

```text
infra/modules/search.bicep
```

### 8. Databricks

Deploy:

```text
infra/modules/databricks.bicep
```

Then upload:

```text
databricks/gold_aggregation.py
```

### 9. ADF

Create the dataset first, followed by the pipeline and trigger.

```bash
az datafactory dataset create \
  --factory-name <adf> \
  -g <rg> \
  --dataset-name SilverContainerDataset \
  --properties @infra/adf/dataset_silver_container.json

az datafactory pipeline create \
  --factory-name <adf> \
  -g <rg> \
  --pipeline-name nlp_pipeline_nightly \
  --pipeline @infra/adf/pipeline_nlp_nightly.json

az datafactory trigger create \
  --factory-name <adf> \
  -g <rg> \
  --trigger-name NightlyScheduleTrigger \
  --properties @infra/adf/trigger_nightly_schedule.json

az datafactory trigger start \
  --factory-name <adf> \
  -g <rg> \
  --trigger-name NightlyScheduleTrigger
```

### 10. API Management

Deploy:

```text
infra/modules/apim.bicep
```

Then apply the APIM policies.

### 11. Purview

Deploy:

```text
infra/modules/purview.bicep
```

Configure the required scans and classification rules.

### 12. Final Smoke Test

```bash
node scripts/test-pipeline.js
```

---

# 15. README Requirements

The final README should contain the following sections.

```text
1. Architecture overview
   - Architecture diagram
   - Short explanation of the pipeline

2. Design decisions
   - ADR list

3. Prerequisites
   - Azure subscription
   - Node.js 18+
   - Azure CLI
   - Azurite

4. Environment setup
   - .env.example
   - Required configuration

5. Local development
   - Azurite
   - Functions
   - Testing

6. Deployment
   - Azure deployment commands
   - Deployment sequence

7. Running the pipeline
   - Logic App trigger
   - Test script

8. Search API
   - API endpoint
   - Authentication
   - curl examples

9. Monitoring
   - Application Insights
   - ADF monitoring

10. Known limitations
   - NewsAPI request limits
   - Search tier limitations
   - Databricks local-development limitations
```

---

# 16. Important Edge Cases

## 1. Missing Article Content

NewsAPI may return an article without a usable `content` field.

Fallback order:

```text
content
   ↓
description
   ↓
title
```

If the content is incomplete:

```text
contentTruncated = true
```

---

## 2. Language API Batch Limit

The Language API accepts a maximum of 10 documents per request.

Therefore:

```text
articles
   ↓
split into groups of 10
   ↓
Language API
```

---

## 3. Empty Embedding Input

Do not attempt to generate an embedding from an empty string.

Instead:

```json
{
  "content_vector": null,
  "vectorStatus": "empty_content"
}
```

---

## 4. Duplicate Articles

Use the URL hash as the deduplication key.

```text
PartitionKey = first two characters of urlHash
RowKey       = urlHash
```

This allows repeated Logic App executions to remain idempotent.

---

## 5. Search Batch Size

Azure AI Search document uploads should be split into batches.

Maximum batch size:

```text
1000 documents
```

Therefore, large silver datasets are processed in chunks.

---

## 6. Idempotent Gold Processing

Gold processing should support repeatable writes.

The Databricks implementation uses:

```text
MERGE
+
date partition replacement
```

so that rerunning a particular date does not create duplicate analytical records.

---

## 7. APIM Cache and Index Freshness

Search responses can be cached for:

```text
60 seconds
```

This provides a small performance benefit while keeping the index sufficiently close to real time.

This behavior should be documented in the README.

---

## 8. PII Detection

The enrichment layer identifies potential PII through:

```text
Person entities
Email patterns
Phone patterns
```

Articles matching these conditions are flagged for Purview classification and governance.

---

# 17. Source-of-Truth Rule

This project plan defines the intended implementation for the pipeline.

Any implementation changes should be checked against:

```text
Architecture
Data flow
Function contracts
Storage layout
Search schema
Error handling
Deployment order
Edge-case behavior
```

The project should remain consistent with these contracts throughout development.
