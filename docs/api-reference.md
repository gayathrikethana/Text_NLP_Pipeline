# Search API Reference

## 1. Endpoint

### Production

```text
GET https://<apim-name>.azure-api.net/search
```

### Local development

When API Management is not being used:

```text
GET http://localhost:7071/api/fn-search-api
```

---

## 2. Authentication

### Production

Requests sent through APIM use OAuth 2.0 client-credentials authentication.

First obtain an access token from Microsoft Entra ID:

```bash
TOKEN=$(curl -s -X POST \
  "https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=<client-id>" \
  -d "client_secret=<client-secret>" \
  -d "scope=api://<api-app-id-uri>/.default" \
  | jq -r '.access_token')
```

The token can then be supplied with the search request:

```bash
curl "https://<apim>.azure-api.net/search?q=apple+earnings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Ocp-Apim-Subscription-Key: <subscription-key>"
```

### Local mode

The Azure Function uses `authLevel: anonymous`, so authentication is not required when running locally.

---

## 3. Query Parameters

| Parameter   | Type    | Required | Default | Constraints            | Purpose                             |
| ----------- | ------- | -------: | ------: | ---------------------- | ----------------------------------- |
| `q`         | string  |      Yes |       — | Maximum 500 characters | Text to search for                  |
| `top`       | integer |       No |    `10` | `1–50`                 | Maximum number of results returned  |
| `category`  | string  |       No |       — | Valid category         | Restrict results to a news category |
| `source`    | string  |       No |       — | Exact match            | Restrict results to a source        |
| `sentiment` | string  |       No |       — | Valid sentiment        | Filter articles by sentiment        |
| `semantic`  | boolean |       No | `false` | `true` / `false`       | Enable semantic reranking           |
| `vector`    | boolean |       No |  `true` | `true` / `false`       | Enable vector search                |
| `from`      | string  |       No |       — | `YYYY-MM-DD`           | Inclusive publication-date start    |
| `to`        | string  |       No |       — | `YYYY-MM-DD`           | Inclusive publication-date end      |

### Supported categories

```text
technology
business
science
health
```

### Supported sentiment values

```text
positive
negative
neutral
mixed
```

---

## 4. Search Strategies

The API supports four search configurations.

| Search type       | Configuration                   | Description                                                              |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Hybrid            | `vector=true`, `semantic=false` | Default mode combining BM25 keyword search and vector search through RRF |
| Keyword           | `vector=false`                  | Traditional keyword matching with faster execution                       |
| Hybrid + semantic | `vector=true`, `semantic=true`  | Combines vector retrieval with semantic reranking for higher precision   |
| Semantic          | `vector=false`, `semantic=true` | Uses BM25 retrieval followed by semantic reranking                       |

### Result scoring

For requests where `semantic=false`, the `recency-boost` scoring profile is used. Articles published within the previous seven days can receive up to twice the normal relevance boost, with logarithmic decay.

When `semantic=true`, the scoring profile is not applied. Ordering is instead controlled by the semantic reranking model.

---

## 5. Successful Response

A successful request returns HTTP `200`.

```json
{
  "query": {
    "q": "Apple earnings",
    "top": 10,
    "filters": {
      "category": "technology",
      "source": null,
      "sentiment": null,
      "from": null,
      "to": null
    },
    "semantic": false,
    "vector": true
  },
  "count": 42,
  "results": [
    {
      "score": 0.9421,
      "id": "e9bca57a5f8d50f4",
      "url": "https://www.theverge.com/2024/01/15/apple-q1-earnings",
      "title": "Apple reports record quarterly earnings",
      "source": "The Verge",
      "category": "technology",
      "publishedAt": "2024-01-15T17:09:12Z",
      "sentimentLabel": "positive",
      "sentimentScore": 0.9,
      "entities": [
        "Apple",
        "Tim Cook",
        "Cupertino"
      ],
      "keyPhrases": [
        "record earnings",
        "quarterly results",
        "revenue growth"
      ]
    }
  ],
  "facets": {
    "categories": [
      {
        "value": "technology",
        "count": 38
      },
      {
        "value": "business",
        "count": 4
      }
    ],
    "sentiments": [
      {
        "value": "positive",
        "count": 30
      },
      {
        "value": "neutral",
        "count": 8
      },
      {
        "value": "negative",
        "count": 4
      }
    ]
  },
  "durationMs": 142,
  "warning": null
}
```

---

## 6. Response Fields

| Field                      | Type        | Meaning                                                                          |
| -------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `query`                    | object      | Parsed request information returned to the client                                |
| `query.vector`             | boolean     | Indicates whether vector retrieval was actually used                             |
| `count`                    | integer     | Number of matching documents in the index                                        |
| `results`                  | array       | Ranked search documents                                                          |
| `results[].score`          | number      | Relevance score produced by RRF or semantic ranking                              |
| `results[].id`             | string      | Stable URL-hash identifier for the article                                       |
| `results[].publishedAt`    | string      | Publication timestamp in ISO 8601 UTC format                                     |
| `results[].sentimentLabel` | string      | Article sentiment: `positive`, `negative`, `neutral`, or `mixed`                 |
| `results[].sentimentScore` | number      | Positive sentiment confidence from `0.0` to `1.0`                                |
| `results[].entities`       | string[]    | Named entities identified by the Language API                                    |
| `results[].keyPhrases`     | string[]    | Key phrases extracted from the article                                           |
| `facets`                   | object      | Category and sentiment counts for filtering/drill-down                           |
| `durationMs`               | integer     | Total function execution time in milliseconds                                    |
| `warning`                  | string/null | Warning returned when vector processing fails and keyword search is used instead |

> Search scores should only be compared within the same query; they are not normalized across different queries.

---

## 7. Error Responses

### 400 — Invalid request

Examples:

```json
{
  "error": "Query parameter \"q\" is required"
}
```

```json
{
  "error": "\"category\" must be one of: technology, business, science, health"
}
```

```json
{
  "error": "\"from\" cannot be later than \"to\""
}
```

### 401 — Authentication failure

Returned by APIM when the supplied Bearer token is missing or invalid:

```json
{
  "statusCode": 401,
  "message": "Unauthorized: valid Bearer token required"
}
```

### 429 — Rate limit exceeded

```json
{
  "statusCode": 429,
  "message": "Rate limit is exceeded."
}
```

The response includes:

```text
Retry-After: <seconds>
X-RateLimit-Remaining: 0
```

### 500 — Search service failure

```json
{
  "error": "Search service unavailable. Please try again shortly."
}
```

---

## 8. Request Examples

### Basic search

```bash
curl "https://<apim>.azure-api.net/search?q=Apple+earnings" \
  -H "Authorization: Bearer $TOKEN"
```

### Category-filtered search

```bash
curl "https://<apim>.azure-api.net/search?q=electric+vehicles&category=technology&top=5"
```

### Semantic search

```bash
curl "https://<apim>.azure-api.net/search?q=climate+policy+impact+on+agriculture&semantic=true&top=10"
```

### Negative business news

```bash
curl "https://<apim>.azure-api.net/search?q=layoffs&category=business&sentiment=negative"
```

### Date-restricted search

```bash
curl "https://<apim>.azure-api.net/search?q=interest+rates&from=2024-01-01&to=2024-01-31"
```

### Keyword-only search

This disables vector retrieval:

```bash
curl "https://<apim>.azure-api.net/search?q=Tim+Cook&vector=false"
```

### Multiple filters

```bash
curl "https://<apim>.azure-api.net/search?q=AI&category=technology&sentiment=positive&from=2024-01-10&top=20"
```

---

## 9. API Limits

| Setting                              |          Limit |
| ------------------------------------ | -------------: |
| Requests per minute per subscription |            100 |
| Successful-response cache duration   |     60 seconds |
| Error-response cache duration        |      5 seconds |
| Maximum results using `top`          |             50 |
| Maximum query length                 | 500 characters |

---

## 10. Response Headers

| Header                        | Purpose                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `X-RateLimit-Remaining`       | Number of requests remaining in the current 60-second window                              |
| `Retry-After`                 | Number of seconds to wait after receiving a 429 response                                  |
| `X-Cache`                     | Indicates whether APIM returned a cached response (`HIT`) or called the Function (`MISS`) |
| `Access-Control-Allow-Origin` | CORS response header                                                                      |

The CORS configuration is currently permissive and should be restricted to approved origins for production use.

---

## 11. APIM Caching

APIM stores search responses for **60 seconds**.

For example, two requests using the same values for all nine supported query parameters within the cache period can receive the same cached response. Such a response is identified by:

```text
X-Cache: HIT
```

A request that is not found in the cache reaches the Azure Function and produces:

```text
X-Cache: MISS
```

Any change to a query parameter such as `q`, `top`, `category`, `source`, `sentiment`, `semantic`, `vector`, `from`, or `to` creates a different cache key.

### Index refresh consideration

The nightly ADF process can add newly processed articles to the Azure AI Search index. A previously cached query may therefore temporarily return the older result set until its 60-second cache entry expires.

This short cache period provides a balance between reducing repeated Search requests and keeping newly indexed content reasonably fresh.
