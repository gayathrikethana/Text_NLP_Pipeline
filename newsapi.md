# NewsAPI.org — Complete Agent Reference

> **Purpose:**  
> This document provides a detailed reference for an AI agent or automated
> system consuming the NewsAPI.org REST API. It covers endpoints, request
> parameters, response fields, data types, constraints, edge cases, and
> integration examples.

---

## 1. Overview

NewsAPI.org is a JSON REST API that aggregates news articles from a large
number of sources worldwide.

It exposes three primary endpoints:

| Endpoint | Path | Use Case |
|---|---|---|
| Everything | `GET /v2/everything` | Full-text search across indexed articles |
| Top Headlines | `GET /v2/top-headlines` | Current headlines by country, category, or source |
| Sources | `GET /v2/top-headlines/sources` | Discover available publisher sources |

**Base URL:** `https://newsapi.org`

**Protocol:** HTTPS

**Authentication:** Every request requires an API key. The key can be supplied
either through the `apiKey` query parameter or the `X-Api-Key` HTTP header.
The header method is preferred because it avoids putting the key directly
into the request URL.

**Response format:** JSON (`application/json`)

### Free-tier considerations

According to this reference:

- 100 requests per day
- Up to 100 articles per request
- Developer use only
- `/v2/everything` has a restricted date range on the free tier

---

## 2. Authentication

### Query Parameter

```text
GET https://newsapi.org/v2/top-headlines?country=us&apiKey=YOUR_KEY
HTTP Header

The preferred approach is:

GET https://newsapi.org/v2/top-headlines?country=us

X-Api-Key: YOUR_KEY
Authentication Errors

An invalid or malformed key can produce a response such as:

{
  "status": "error",
  "code": "apiKeyInvalid",
  "message": "Your API key is invalid."
}

Common mistakes include:

Passing NEWSAPI_KEY=abc123 instead of only abc123
Adding whitespace or newline characters to the key
Sending the key in the request body
Using an expired or disabled key

For example, this is incorrect:

apiKey=NEWSAPI_KEY=abc123

The value should contain only:

abc123
3. Shared Response Envelope

Successful responses generally follow this structure:

{
  "status": "ok",
  "totalResults": 6645,
  "articles": []
}
Field	Type	Presence	Description
status	string	Always	"ok" for success, "error" for failure
totalResults	integer	Success	Total number of matching articles
articles	array	Success	Articles returned for the current page
code	string	Error only	Machine-readable error code
message	string	Error only	Human-readable error description

The Sources endpoint returns sources instead of articles.

4. Endpoint: Everything
/v2/everything
Purpose

The Everything endpoint provides full-text search across indexed news
articles.

It can be used for:

Article discovery
Keyword searches
Trend analysis
News monitoring
Domain-specific searches
Request
GET https://newsapi.org/v2/everything
Parameters
Parameter	Type	Required	Default	Description
apiKey	string	Yes*	—	API key. Not required when using X-Api-Key.
q	string	No	—	Search keywords or phrases
searchIn	string	No	All fields	Restricts search to title, description, or content
sources	string	No	—	Comma-separated source IDs, up to 20
domains	string	No	—	Domains to include
excludeDomains	string	No	—	Domains to exclude
from	string	No	Oldest available	Earliest article date
to	string	No	Newest available	Latest article date
language	string	No	All	ISO-639-1 language code
sortBy	string	No	publishedAt	relevancy, popularity, or publishedAt
pageSize	integer	No	100	Number of articles per page; maximum 100
page	integer	No	1	Page number
Advanced q Syntax
Syntax	Meaning	Example
"phrase"	Exact phrase	"bitcoin halving"
+word	Word must appear	+bitcoin
-word	Word must not appear	-ethereum
AND	Both terms required	crypto AND regulation
OR	Either term	ethereum OR litecoin
NOT	Exclude term	crypto NOT bitcoin
(group)	Logical grouping	crypto AND (ethereum OR litecoin)
Examples

English Bitcoin articles:

GET https://newsapi.org/v2/everything?q=bitcoin&language=en&sortBy=publishedAt&apiKey=KEY

AI articles from selected domains:

GET https://newsapi.org/v2/everything?q=artificial+intelligence&domains=wired.com,techcrunch.com&apiKey=KEY

Search only article titles:

GET https://newsapi.org/v2/everything?q="climate+change"&searchIn=title&apiKey=KEY

Search within a date range:

GET https://newsapi.org/v2/everything?q=bitcoin&from=2026-06-01&to=2026-06-17&apiKey=KEY
5. Endpoint: Top Headlines
/v2/top-headlines
Purpose

Returns current news headlines. It can be filtered using countries,
categories, sources, or keywords.

Request
GET https://newsapi.org/v2/top-headlines
Parameters
Parameter	Type	Required	Default	Description
apiKey	string	Yes*	—	API key
country	string	No	—	ISO 3166-1 country code
category	string	No	—	News category
sources	string	No	—	Comma-separated source IDs
q	string	No	—	Keyword search
pageSize	integer	No	20	Articles per page; maximum 100
page	integer	No	1	Page number

Supported categories include:

business
entertainment
general
health
science
sports
technology
Parameter Restrictions

The following combinations are invalid:

country + sources
category + sources
country + category + sources

Examples of valid combinations:

country
category
country + category
sources
q + any valid filter
Examples

US technology headlines:

GET https://newsapi.org/v2/top-headlines?country=us&category=technology&apiKey=KEY

Headlines from selected sources:

GET https://newsapi.org/v2/top-headlines?sources=bbc-news,the-verge&apiKey=KEY

Keyword search:

GET https://newsapi.org/v2/top-headlines?q=bitcoin&apiKey=KEY
6. Article Object

Articles returned by the Everything and Top Headlines endpoints use the
following structure:

{
  "source": {
    "id": "the-verge",
    "name": "The Verge"
  },
  "author": "Robert Hart",
  "title": "Example article title",
  "description": "Example article description",
  "url": "https://www.example.com/article",
  "urlToImage": "https://www.example.com/image.jpg",
  "publishedAt": "2026-05-29T17:09:12Z",
  "content": "Example article content... [+9574 chars]"
}
source

The source object identifies the publisher.

Field	Type	Nullable	Description
source.id	string	Yes	NewsAPI source identifier
source.name	string	No	Publisher display name

source.id can be null.

Example:

{
  "id": null,
  "name": "Gizmodo.com"
}

Therefore, applications should always null-check source.id.

For display purposes, source.name should be preferred.

author

The article byline.

It can contain:

A person's name
A team or publication name
A pseudonym
null

Examples:

"Robert Hart"
"Kyle Torpey"
"EditorDavid"
"Boing Boing's Shop"
null

Do not assume that the value represents a person's name.

title

The article headline.

Example:

"Victims ID'd in B-52 bomber crash - CBS News"

Some publishers append their brand name to the title.

If a clean title is required, the trailing publisher name can be removed
during preprocessing.

description

A short article summary or excerpt.

This field can be null.

It is useful as a fallback when content is unavailable or truncated.

url

The canonical article URL.

The URL is a strong candidate for article deduplication.

For this pipeline, the URL is hashed to generate the article identifier.

urlToImage

URL of an article image.

This field may be:

null
Article-specific
A publisher-hosted image
A generic publisher placeholder

Do not assume that the image is unique to the article.

publishedAt

Publication timestamp.

Example:

2026-05-29T17:09:12Z

The value is an ISO 8601 timestamp.

The NewsAPI field is:

publishedAt

not:

published_at

JavaScript example:

const date = new Date(article.publishedAt);

Python example:

from datetime import datetime

date = datetime.fromisoformat(
    article["publishedAt"].replace("Z", "+00:00")
)
content

Article content returned by NewsAPI.

The content may be truncated and can contain a marker such as:

[+9574 chars]

Example:

Gudtrip is the most ridiculous AI/crypto/weed product... [+9574 chars]

The suffix indicates that additional content was not included in the
returned API response.

The pipeline should remove the marker before NLP processing.

Content can also contain:

HTML fragments
\r\n line endings
null
Recommended Text Fallback

Use the following order:

content
    ↓
description
    ↓
title

Before NLP processing:

Remove the [+N chars] marker.
Remove HTML tags.
Normalize whitespace.
Fall back to description if necessary.
Use title as the final fallback.
Complete Article Field Summary
Field	Type	Nullable	Notes
source	object	No	Publisher information
source.id	string	Yes	Can frequently be null
source.name	string	No	Publisher name
author	string	Yes	Often null
title	string	No	May contain publisher suffix
description	string	Yes	Short article summary
url	string	No	Canonical article URL
urlToImage	string	Yes	May be generic
publishedAt	string	No	ISO 8601 UTC timestamp
content	string	Yes	May be truncated
7. Endpoint: Sources
/v2/top-headlines/sources
Purpose

Returns the curated publisher list available through NewsAPI.

Source IDs can then be used with the sources parameter of other endpoints.

Request
GET https://newsapi.org/v2/top-headlines/sources
Parameters
Parameter	Type	Required	Default	Description
apiKey	string	Yes*	—	API key
category	string	No	All	Filter by category
language	string	No	All	Filter by language
country	string	No	All	Filter by country
Example Response
{
  "status": "ok",
  "sources": [
    {
      "id": "abc-news",
      "name": "ABC News",
      "description": "Your trusted source for breaking news...",
      "url": "https://abcnews.go.com",
      "category": "general",
      "language": "en",
      "country": "us"
    }
  ]
}
Source Fields
Field	Type	Nullable	Description
id	string	No	Machine-readable source identifier
name	string	No	Publisher name
description	string	No	Publisher description
url	string	No	Publisher homepage
category	string	No	Primary news category
language	string	No	ISO-639-1 language code
country	string	No	ISO 3166-1 country code

Only curated sources appear in this endpoint.

Consequently, an article can still have:

{
  "source": {
    "id": null,
    "name": "Example Publisher"
  }
}
8. Pagination

The Everything and Top Headlines endpoints support pagination.

Example:

totalResults = 6645
pageSize     = 100
page         = 1

Total pages = ceil(6645 / 100)
            = 67
Pagination Requests

Page 1:

GET /v2/everything?q=bitcoin&pageSize=100&page=1&apiKey=KEY

Page 2:

GET /v2/everything?q=bitcoin&pageSize=100&page=2&apiKey=KEY

Page N:

GET /v2/everything?q=bitcoin&pageSize=100&page=N&apiKey=KEY

According to this reference, free-tier access may restrict the number of
pages that can actually be retrieved.

If the requested page exceeds the available results, the returned articles
array can be empty or contain fewer items than pageSize.

9. Error Responses

Errors use the following structure:

{
  "status": "error",
  "code": "apiKeyInvalid",
  "message": "Your API key is invalid."
}
Common Error Codes
HTTP Status	Code	Cause
401	apiKeyInvalid	Missing, incorrect, or malformed key
401	apiKeyDisabled	API key disabled
429	rateLimited	Too many requests
400	parameterInvalid	Invalid parameter
400	parametersMissing	Required parameter missing
400	sourcesTooMany	More than 20 sources specified
400	sourceDoesNotExist	Invalid source ID
426	upgradePlan	Feature requires a higher plan
500	unexpectedError	Server-side failure

For temporary server or rate-limit errors, the client should use
appropriate retry and backoff behavior.

10. Data Quality and Edge Cases
source.id Can Be Null

Never assume that source.id exists.

Examples:

{
  "id": null,
  "name": "Gizmodo.com"
}
{
  "id": null,
  "name": "Slashdot.org"
}
{
  "id": null,
  "name": "Boing Boing"
}

Use source.name for display purposes and null-check source.id before
using it.

content Can Contain HTML

Example:

<ul><li></li></ul>
Gudtrip is the most ridiculous AI/crypto/weed product...

HTML should be removed before NLP processing.

content Can Be Truncated

Example:

While previous bitcoin selloffs... [+896 chars]

The pipeline should remove the truncation marker before sending text to
Azure AI Language or generating embeddings.

author Is Not Necessarily a Person

Possible values include:

Boing Boing's Shop
EditorDavid
null

Treat it as an unstructured byline rather than assuming it represents a
person.

Publisher Names Can Appear in Titles

Example:

Victims ID'd in B-52 crash that killed 8 - CBS News

If the application requires a clean headline, the publisher suffix can be
removed during preprocessing.

urlToImage May Be Generic

Some publishers reuse the same image across multiple articles.

Therefore, urlToImage should not be treated as a guaranteed unique article
image.

publishedAt Uses camelCase

The NewsAPI response field is:

publishedAt

not:

published_at

Any mapping to a database or search schema using snake_case must explicitly
perform the conversion.

Date Restrictions

According to this reference, the free tier restricts /v2/everything
results to a recent date window.

Applications should therefore avoid assuming that arbitrary historical
queries are available on the free plan.

11. Deduplication Strategy

The same article can appear in multiple API requests, especially when the
pipeline polls the API repeatedly.

The recommended approach is:

Step 1 — Read the article URL
article.url
Step 2 — Generate a deterministic hash
SHA-256(article.url)
Step 3 — Use the shortened hash as the identifier

For this pipeline:

SHA-256(url)[0:16]
Step 4 — Use the hash as the storage key

Example:

e9bca57a5f8d50f4
Step 5 — Check the deduplication store

Before performing expensive NLP processing, check whether the article has
already been processed.

Do not use the article title alone for deduplication because the same story
can appear with different titles.

12. Quick Reference
Response Envelope
status         string
totalResults   integer
articles       array
code           string     # errors only
message        string     # errors only
Article
source.id      string?    nullable
source.name    string     publisher name
author         string?    nullable
title          string     headline
description    string?    nullable
url            string     canonical URL
urlToImage     string?    nullable
publishedAt    string     ISO 8601 UTC
content        string?    nullable/truncated
Source
id             string     source identifier
name           string     display name
description    string     publisher description
url            string     publisher homepage
category       string     news category
language       string     ISO-639-1
country        string     ISO 3166-1
13. Integration Checklist
Before Calling the API
 API key contains only the raw key value.
 No variable name or extra characters are included.
 API key is supplied through apiKey or X-Api-Key.
 The key is not placed in the request body.
 Parameter combinations are valid.
 sources is not combined with country or category.
 Query parameters are URL-encoded.
 Date parameters use ISO 8601 format.
When Processing the Response
 Check status === "ok" before processing articles.
 Null-check source.id.
 Null-check author.
 Null-check description.
 Null-check urlToImage.
 Null-check content.
 Remove [+N chars] from content.
 Remove HTML from article text.
 Use content → description → title as the text fallback chain.
 Use article.url or its hash for deduplication.
 Parse publishedAt as an ISO 8601 timestamp.
 Preserve publishedAt as the source field name until explicit mapping
to another schema is required.