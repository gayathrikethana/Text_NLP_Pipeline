# Logic App — NewsAPI Ingestion

## Overview

The Logic App polls the NewsAPI `/v2/top-headlines` endpoint every 6 hours:

- 00:00 UTC
- 06:00 UTC
- 12:00 UTC
- 18:00 UTC

One API request is made for each configured news category. Each returned
article is written as an individual JSON blob into the bronze layer of
Azure Blob Storage.

## NewsAPI Rate Limit

The ingestion schedule is designed to remain comfortably within the
NewsAPI free-tier request limit.

| Constraint | Value |
|---|---:|
| NewsAPI free-tier limit | 100 requests/day |
| Categories | 4 |
| Polls per day | 4 |
| Requests per poll | 4 |
| **Total requests/day** | **16** |
| Articles per request | Up to 100 |
| **Maximum articles/day** | **~1,600** |

The pipeline therefore uses approximately **16 requests per day**, leaving
considerable room below the 100-request daily limit.

## Design Decisions

### Why `/v2/top-headlines` instead of `/v2/everything`?

The pipeline uses `/v2/top-headlines` because the ingestion design organizes
articles around the NewsAPI `category` parameter.

The configured categories are:

- technology
- business
- science
- health

The category is also used when creating bronze storage paths and during
downstream aggregation.

### Why use the `X-Api-Key` header?

The NewsAPI key is sent through the `X-Api-Key` HTTP header instead of being
included as a query-string parameter.

This avoids exposing the API key through URLs and reduces the chance of it
appearing in HTTP access logs.

The Logic App receives the key through a secure parameter. In a production
deployment, the secret can be backed by Azure Key Vault.

### Why create one blob per article?

Each article is stored as its own JSON blob rather than storing an entire
NewsAPI response in a single file.

The Event Grid workflow is triggered by `BlobCreated` events. With one
article per blob, each event represents exactly one article and can move
through the enrichment pipeline independently.

This also keeps responsibilities separated:

- Logic App — ingestion
- Event Grid — event notification
- `fn-nlp-trigger` — deduplication and queueing
- `fn-enrich` — NLP processing

### Why use `fn-hash-url`?

The URL is used to generate a deterministic identifier for each article.

The Logic App calls `fn-hash-url`, which calculates:

```text
SHA-256(article URL)

and keeps the first 16 hexadecimal characters as the article identifier.

This identifier is then used for deduplication and for the bronze blob name.

Keeping the hashing operation in a small dedicated Azure Function also
keeps the Logic App workflow simpler.

Bronze Blob Path

Articles are stored using the following structure:

{bronzeContainer}/{category}/{YYYY-MM-DD}/{urlHash}.json

Example:

articles-bronze/technology/2024-01-15/e9bca57a5f8d50f4.json

The date represents the ingestion date, rather than the article's
publishedAt value.

The Logic App uses:

utcNow('yyyy-MM-dd')

when creating the storage path.

This allows the nightly ADF process to scan the previous day's ingestion
partition and process everything received during that period.

Idempotency

The article blob is written using a PUT operation.

If the same article is processed again, the URL hash produces the same
filename and the existing blob is overwritten.

This makes repeated Logic App executions safe in cases such as transient
failures or workflow retries.

The deduplication table used by fn-nlp-trigger prevents the same article
from being unnecessarily enriched again.

Error Handling
NewsAPI rate limiting

If NewsAPI responds with HTTP 429, the Logic App HTTP action uses
exponential retry behavior.

The configured workflow allows three retry attempts.

If all retries fail:

The current category is skipped.
The failure is logged through the Log_API_error Compose action.
Processing can continue for the remaining categories.
Individual article failures

If writing one article to Blob Storage fails, that article is skipped and
the remaining articles continue through the workflow.

There is no dependency between individual article writes.

Invalid NewsAPI response

The workflow checks the API response status field before entering the
article-processing loop.

Only a response with:

status = "ok"

continues to article processing.

Otherwise, the returned error code and message are logged.

Deployment
Required Parameters

The following parameters must be configured during deployment.

Parameter	Description
newsApiKey	NewsAPI key without a prefix or surrounding whitespace
storageConnectionString	Azure Storage connection string
bronzeContainer	Bronze container name; defaults to articles-bronze
ingestCategories	Comma-separated category list
hashFunctionUrl	Full HTTP endpoint of fn-hash-url
hashFunctionKey	Function-level key used to call fn-hash-url

The default category list is:

technology,business,science,health

Example function URL:

https://<app>.azurewebsites.net/api/fn-hash-url
Azure CLI Deployment
az logic workflow create \
  --resource-group <rg> \
  --name nlp-pipeline-ingestor \
  --definition @logic-app/workflow.json \
  --parameters newsApiKey=<key> \
               storageConnectionString="<connection-string>" \
               hashFunctionUrl=https://<app>.azurewebsites.net/api/fn-hash-url \
               hashFunctionKey=<function-key>
Manual Test

After deployment, run the Logic App manually from:

Azure Portal
→ Logic Apps
→ Run Trigger
→ Run Now

Then verify the pipeline in the following order:

1. Check the bronze layer

Confirm that JSON blobs are created under:

articles-bronze/{category}/{today}/
2. Check Event Grid

Verify that BlobCreated events are reaching fn-nlp-trigger.

The function logs should show that articles are being queued.

3. Check the queue

Confirm that messages are appearing in:

article-enrich-queue
4. Check the silver layer

After fn-enrich processes the queue, enriched article JSON files should
appear in:

articles-silver/{category}/{date}/
Monitoring

The main monitoring location is:

Azure Portal
→ Logic Apps
→ Run History