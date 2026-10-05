'use strict';

/**
 * scripts/test-pipeline.js
 *
 * End-to-end smoke test for the News NLP pipeline.
 *
 * Modes:
 *
 * 1. UNIT mode (default)
 *    Runs without Azure services and validates helpers, mappings,
 *    configuration, schemas, and project contracts using fixture data.
 *
 * 2. INTEGRATION mode (--integration)
 *    Performs live checks against NewsAPI and Azure AI Search.
 *
 * Usage:
 *   node scripts/test-pipeline.js
 *   node scripts/test-pipeline.js --integration
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = one or more tests failed
 */

require('dotenv').config({
  path: `${__dirname}/../functions/.env`
});

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const integrationMode =
  process.argv.includes('--integration');

const testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function runTest(name, callback) {
  try {
    callback();

    testResults.passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    testResults.failed++;
    testResults.errors.push({
      name,
      error: error.message
    });

    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(
      message ?? 'Assertion failed'
    );
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label ?? 'assertEqual'}: ` +
      `expected ${JSON.stringify(expected)}, ` +
      `got ${JSON.stringify(actual)}`
    );
  }
}

function assertNull(value, label) {
  if (value !== null && value !== undefined) {
    throw new Error(
      `${label ?? 'assertNull'}: ` +
      `expected null/undefined, ` +
      `got ${JSON.stringify(value)}`
    );
  }
}

function assertNotNull(value, label) {
  if (value === null || value === undefined) {
    throw new Error(
      `${label ?? 'assertNotNull'}: ` +
      'expected non-null value'
    );
  }
}

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

const NEWSAPI_ARTICLE = {
  source: {
    id: 'the-verge',
    name: 'The Verge'
  },
  author: 'Jane Doe',
  title: 'Apple reports record quarterly earnings',
  description:
    'Apple Inc reported strong Q1 results exceeding analyst expectations.',
  url:
    'https://www.theverge.com/2024/01/15/apple-q1-earnings',
  urlToImage:
    'https://platform.theverge.com/img.jpg',
  publishedAt: '2024-01-15T17:09:12Z',
  content:
    'Apple Inc reported record quarterly earnings on Tuesday. [+5204 chars]'
};

const NEWSAPI_ARTICLE_NULL_FIELDS = {
  source: {
    id: null,
    name: 'Gizmodo.com'
  },
  author: null,
  title: 'Tech roundup',
  description: null,
  url:
    'https://gizmodo.com/tech-roundup',
  urlToImage: null,
  publishedAt: '2024-01-15T12:00:00Z',
  content: null
};

const NEWSAPI_ARTICLE_HTML = {
  source: {
    id: null,
    name: 'Boing Boing'
  },
  author: "Boing Boing's Shop",
  title: 'Gadget roundup',
  description: 'Weekly picks.',
  url:
    'https://boingboing.net/gadget-roundup',
  urlToImage: null,
  publishedAt: '2024-01-15T08:00:00Z',
  content:
    '<ul><li></li></ul>\r\n' +
    'Weekly picks from the shop. [+1200 chars]'
};

const NLP_RESULT = {
  id: 'abc123',
  nlpStatus: 'ok',
  sentiment: {
    label: 'positive',
    scores: {
      positive: 0.9,
      negative: 0.05,
      neutral: 0.05
    }
  },
  entities: [
    {
      text: 'Apple',
      category: 'Organization',
      confidenceScore: 0.99
    },
    {
      text: 'Tim Cook',
      category: 'Person',
      confidenceScore: 0.95
    }
  ],
  keyPhrases: [
    'record earnings',
    'quarterly results'
  ]
};

const EMBEDDING_RESULT = {
  vector: new Array(1536).fill(0.01),
  vectorStatus: 'ok',
  dimensions: 1536
};

// Realistic silver-layer document matching fn-enrich output.
const SILVER_DOCUMENT = {
  id: 'abc123',
  url: NEWSAPI_ARTICLE.url,
  title: NEWSAPI_ARTICLE.title,
  body_snippet:
    'Apple Inc reported record quarterly earnings on Tuesday.',
  source: 'The Verge',
  category: 'technology',
  publishedAt: '2024-01-15T17:09:12Z',
  author: 'Jane Doe',
  nlpStatus: 'ok',
  nlpError: null,
  sentiment: NLP_RESULT.sentiment,
  entities: NLP_RESULT.entities,
  keyPhrases: NLP_RESULT.keyPhrases,
  hasPii: true,
  content_vector: EMBEDDING_RESULT.vector,
  vectorStatus: 'ok',
  vectorError: null,
  ingestedAt: '2024-01-15T02:00:00Z',
  enrichedAt: '2024-01-15T02:05:00Z',
  contentTruncated: true
};

// -----------------------------------------------------------------------------
// Section 1: shared/config.js
// -----------------------------------------------------------------------------

console.log(
  '\n── shared/config.js ────────────────────────────────────────────'
);

const {
  INGEST_CATEGORIES,
  CONTAINERS,
  TABLES,
  QUEUES
} = require('../functions/shared/config');

runTest(
  'INGEST_CATEGORIES is a non-empty array',
  () => {
    assert(
      Array.isArray(INGEST_CATEGORIES) &&
      INGEST_CATEGORIES.length > 0,
      'INGEST_CATEGORIES must be a non-empty array'
    );
  }
);

runTest(
  'INGEST_CATEGORIES contains expected defaults',
  () => {
    [
      'technology',
      'business',
      'science',
      'health'
    ].forEach(category => {
      assert(
        INGEST_CATEGORIES.includes(category),
        `Missing category: ${category}`
      );
    });
  }
);

runTest(
  'CONTAINERS has all required keys',
  () => {
    [
      'BRONZE',
      'SILVER',
      'GOLD',
      'ERROR'
    ].forEach(key => {
      assertNotNull(
        CONTAINERS[key],
        `CONTAINERS.${key}`
      );
    });
  }
);

runTest(
  'TABLES and QUEUES have required keys',
  () => {
    assertNotNull(
      TABLES.DEDUP,
      'TABLES.DEDUP'
    );

    assertNotNull(
      TABLES.AUDIT,
      'TABLES.AUDIT'
    );

    assertNotNull(
      QUEUES.ENRICH,
      'QUEUES.ENRICH'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 2: shared/blobClient.js
// -----------------------------------------------------------------------------

console.log(
  '\n── shared/blobClient.js ────────────────────────────────────────'
);

const {
  buildBlobPath,
  dateFromBlobPath
} = require('../functions/shared/blobClient');

runTest(
  'buildBlobPath produces correct path',
  () => {
    assertEqual(
      buildBlobPath(
        'technology',
        '2024-01-15',
        'abc123'
      ),
      'technology/2024-01-15/abc123.json',
      'buildBlobPath'
    );
  }
);

runTest(
  'dateFromBlobPath extracts date correctly',
  () => {
    assertEqual(
      dateFromBlobPath(
        'technology/2024-01-15/abc123.json'
      ),
      '2024-01-15',
      'dateFromBlobPath'
    );
  }
);

runTest(
  'dateFromBlobPath returns unknown for malformed path',
  () => {
    assertEqual(
      dateFromBlobPath('badpath'),
      'unknown',
      'fallback'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 3: fn-hash-url
// -----------------------------------------------------------------------------

console.log(
  '\n── fn-hash-url ─────────────────────────────────────────────────'
);

runTest(
  'SHA-256 hash is 16 hex chars',
  () => {
    const hash = crypto
      .createHash('sha256')
      .update(NEWSAPI_ARTICLE.url)
      .digest('hex')
      .substring(0, 16);

    assert(
      /^[0-9a-f]{16}$/.test(hash),
      'Hash format'
    );
  }
);

runTest(
  'Hash is deterministic',
  () => {
    const firstHash = crypto
      .createHash('sha256')
      .update(NEWSAPI_ARTICLE.url)
      .digest('hex')
      .substring(0, 16);

    const secondHash = crypto
      .createHash('sha256')
      .update(NEWSAPI_ARTICLE.url)
      .digest('hex')
      .substring(0, 16);

    assertEqual(
      firstHash,
      secondHash,
      'Deterministic hash'
    );
  }
);

runTest(
  'Different URLs produce different hashes',
  () => {
    const firstHash = crypto
      .createHash('sha256')
      .update(NEWSAPI_ARTICLE.url)
      .digest('hex')
      .substring(0, 16);

    const secondHash = crypto
      .createHash('sha256')
      .update(NEWSAPI_ARTICLE_NULL_FIELDS.url)
      .digest('hex')
      .substring(0, 16);

    assert(
      firstHash !== secondHash,
      'Different URLs must hash differently'
    );
  }
);

runTest(
  'Whitespace trimmed before hashing',
  () => {
    const expectedHash = crypto
      .createHash('sha256')
      .update(NEWSAPI_ARTICLE.url.trim())
      .digest('hex')
      .substring(0, 16);

    const actualHash = crypto
      .createHash('sha256')
      .update(
        `  ${NEWSAPI_ARTICLE.url}  `.trim()
      )
      .digest('hex')
      .substring(0, 16);

    assertEqual(
      expectedHash,
      actualHash,
      'Trim before hash'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 4: shared/languageClient.js
// -----------------------------------------------------------------------------

console.log(
  '\n── shared/languageClient.js ────────────────────────────────────'
);

const {
  hasPii,
  BATCH_SIZE,
  MAX_DOC_CHARS
} = require('../functions/shared/languageClient');

runTest(
  'BATCH_SIZE is 10 (Language API limit)',
  () => {
    assertEqual(
      BATCH_SIZE,
      10,
      'BATCH_SIZE'
    );
  }
);

runTest(
  'MAX_DOC_CHARS is within Language API 5120 limit',
  () => {
    assert(
      MAX_DOC_CHARS <= 5120 &&
      MAX_DOC_CHARS > 4000,
      'MAX_DOC_CHARS range'
    );
  }
);

runTest(
  'hasPii detects Person entity',
  () => {
    assert(
      hasPii([{ category: 'Person' }]),
      'Person is PII'
    );
  }
);

runTest(
  'hasPii detects PhoneNumber entity',
  () => {
    assert(
      hasPii([{ category: 'PhoneNumber' }]),
      'PhoneNumber is PII'
    );
  }
);

runTest(
  'hasPii detects Email entity',
  () => {
    assert(
      hasPii([{ category: 'Email' }]),
      'Email is PII'
    );
  }
);

runTest(
  'hasPii returns false for non-PII entities',
  () => {
    assert(
      !hasPii([
        { category: 'Organization' },
        { category: 'Location' }
      ]),
      'Non-PII'
    );
  }
);

runTest(
  'hasPii returns false for empty array',
  () => {
    assert(
      !hasPii([]),
      'Empty entities'
    );
  }
);

runTest(
  'hasPii correctly flags Tim Cook (Person) in fixture',
  () => {
    assert(
      hasPii(NLP_RESULT.entities),
      'Tim Cook is Person → PII'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 5: fn-enrich text extraction
// -----------------------------------------------------------------------------

console.log(
  '\n── fn-enrich text extraction ───────────────────────────────────'
);

// Keep this helper aligned with fn-enrich text extraction behavior.
function extractText(article) {
  if (
    article.content &&
    article.content.trim().length > 0
  ) {
    const cleanedContent =
      article.content.replace(
        /\s*\[[\+\d]+ chars\]\s*$/,
        ''
      );

    return cleanedContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (
    article.description &&
    article.description.trim().length > 0
  ) {
    return article.description.trim();
  }

  return article.title?.trim() ?? '';
}

runTest(
  'Strips [+N chars] truncation marker',
  () => {
    const text =
      extractText(NEWSAPI_ARTICLE);

    assert(
      !text.includes('[+'),
      'Truncation marker removed'
    );

    assert(
      text.includes('Apple Inc reported'),
      'Content preserved'
    );
  }
);

runTest(
  'Falls back to title when content and description are null',
  () => {
    const text =
      extractText(
        NEWSAPI_ARTICLE_NULL_FIELDS
      );

    assertEqual(
      text,
      'Tech roundup',
      'Title fallback'
    );
  }
);

runTest(
  'Strips HTML fragments from content',
  () => {
    const text =
      extractText(NEWSAPI_ARTICLE_HTML);

    assert(
      !text.includes('<ul>'),
      'HTML tags removed'
    );

    assert(
      !text.includes('<li>'),
      'HTML tags removed'
    );

    assert(
      text.includes('Weekly picks'),
      'Text preserved after HTML strip'
    );
  }
);

runTest(
  'Words do not run together after HTML stripping',
  () => {
    const text = extractText({
      content:
        '<b>Apple</b><em>earnings</em> strong.'
    });

    assert(
      !text.includes('Appleearnings'),
      'Words separated after HTML strip'
    );
  }
);

runTest(
  'Handles Windows CRLF line endings',
  () => {
    const text = extractText({
      content: 'Line one.\r\nLine two.'
    });

    assert(
      !text.includes('\r\n'),
      'CRLF removed'
    );
  }
);

runTest(
  'contentTruncated flag is true for truncated content',
  () => {
    const rawArticle =
      NEWSAPI_ARTICLE;

    const truncated =
      !!(
        rawArticle.content?.includes('[+') &&
        rawArticle.content?.includes('chars]')
      );

    assert(
      truncated === true,
      'contentTruncated should be true'
    );
  }
);

runTest(
  'contentTruncated is false for full content',
  () => {
    const rawArticle = {
      content:
        'Full article text with no truncation marker.'
    };

    const truncated =
      !!(
        rawArticle.content?.includes('[+') &&
        rawArticle.content?.includes('chars]')
      );

    assert(
      truncated === false,
      'contentTruncated should be false'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 6: fn-enrich silver document contract
// -----------------------------------------------------------------------------

console.log(
  '\n── fn-enrich silver doc schema ─────────────────────────────────'
);

runTest(
  'Silver doc has all required identity fields',
  () => {
    [
      'id',
      'url',
      'title',
      'body_snippet',
      'source',
      'category',
      'publishedAt'
    ].forEach(field => {
      assertNotNull(
        SILVER_DOCUMENT[field],
        `silver.${field}`
      );
    });
  }
);

runTest(
  'Silver doc publishedAt is camelCase',
  () => {
    assertNotNull(
      SILVER_DOCUMENT.publishedAt,
      'publishedAt present'
    );

    assert(
      !('published_at' in SILVER_DOCUMENT),
      'No snake_case published_at in silver'
    );
  }
);

runTest(
  'Silver doc source extracts source.name correctly',
  () => {
    const source =
      NEWSAPI_ARTICLE.source?.name ??
      NEWSAPI_ARTICLE.source ??
      null;

    assertEqual(
      source,
      'The Verge',
      'source.name extraction'
    );
  }
);

runTest(
  'Silver doc source.id null is handled',
  () => {
    const source =
      NEWSAPI_ARTICLE_NULL_FIELDS
        .source?.name ?? null;

    assertEqual(
      source,
      'Gizmodo.com',
      'Null source.id — name used'
    );
  }
);

runTest(
  'Silver NLP fields are present',
  () => {
    assertNotNull(
      SILVER_DOCUMENT.sentiment,
      'sentiment'
    );

    assert(
      Array.isArray(SILVER_DOCUMENT.entities),
      'entities is array'
    );

    assert(
      Array.isArray(SILVER_DOCUMENT.keyPhrases),
      'keyPhrases is array'
    );
  }
);

runTest(
  'Silver hasPii flag is correct for Person entity',
  () => {
    assert(
      SILVER_DOCUMENT.hasPii === true,
      'hasPii true (Tim Cook is Person)'
    );
  }
);

runTest(
  'Silver content_vector is 1536 dimensions',
  () => {
    assertEqual(
      SILVER_DOCUMENT.content_vector.length,
      1536,
      'vector dimensions'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 7: fn-index-refresh search document mapping
// -----------------------------------------------------------------------------

console.log(
  '\n── fn-index-refresh _mapToSearchDoc ────────────────────────────'
);

const {
  _mapToSearchDoc
} = require('../functions/fn-index-refresh');

runTest(
  '_mapToSearchDoc maps all fields correctly',
  () => {
    const document =
      _mapToSearchDoc(SILVER_DOCUMENT);

    assertNotNull(
      document,
      '_mapToSearchDoc returns non-null'
    );

    assertEqual(
      document.id,
      'abc123',
      'id'
    );

    assertEqual(
      document.title,
      SILVER_DOCUMENT.title,
      'title'
    );

    assertEqual(
      document.source,
      'The Verge',
      'source'
    );

    assertEqual(
      document.category,
      'technology',
      'category'
    );
  }
);

runTest(
  '_mapToSearchDoc maps sentiment_label correctly',
  () => {
    const document =
      _mapToSearchDoc(SILVER_DOCUMENT);

    assertEqual(
      document.sentiment_label,
      'positive',
      'sentiment_label'
    );
  }
);

runTest(
  '_mapToSearchDoc maps positive sentiment score',
  () => {
    const document =
      _mapToSearchDoc(SILVER_DOCUMENT);

    assertEqual(
      document.sentiment_score_positive,
      0.9,
      'sentiment_score_positive'
    );
  }
);

runTest(
  '_mapToSearchDoc flattens entities to strings',
  () => {
    const document =
      _mapToSearchDoc(SILVER_DOCUMENT);

    assert(
      Array.isArray(document.entities),
      'entities is array'
    );

    assert(
      document.entities.every(
        entity => typeof entity === 'string'
      ),
      'entities are strings'
    );

    assert(
      document.entities.includes('Apple'),
      'Apple in entities'
    );

    assert(
      document.entities.includes('Tim Cook'),
      'Tim Cook in entities'
    );
  }
);

runTest(
  '_mapToSearchDoc maps publishedAt to published_at',
  () => {
    const document =
      _mapToSearchDoc(SILVER_DOCUMENT);

    assertNotNull(
      document.published_at,
      'published_at in Search doc'
    );

    assertEqual(
      document.published_at,
      '2024-01-15T17:09:12Z',
      'published_at value'
    );
  }
);

runTest(
  '_mapToSearchDoc returns null when id is missing',
  () => {
    assertNull(
      _mapToSearchDoc(null),
      'null doc'
    );

    assertNull(
      _mapToSearchDoc(undefined),
      'undefined doc'
    );

    assertNull(
      _mapToSearchDoc({
        title: 'No id'
      }),
      'missing id'
    );
  }
);

runTest(
  '_mapToSearchDoc keeps content_vector for indexing',
  () => {
    const document =
      _mapToSearchDoc(SILVER_DOCUMENT);

    assert(
      'content_vector' in document,
      'content_vector present for indexing'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 8: fn-search-api parameter parsing
// -----------------------------------------------------------------------------

console.log(
  '\n── fn-search-api _parseParams ──────────────────────────────────'
);

const {
  _parseParams,
  _formatResult
} = require('../functions/fn-search-api');

runTest(
  '_parseParams rejects missing q',
  () => {
    assertNotNull(
      _parseParams({}).error,
      'missing q error'
    );
  }
);

runTest(
  '_parseParams rejects empty q',
  () => {
    assertNotNull(
      _parseParams({ q: '   ' }).error,
      'empty q error'
    );
  }
);

runTest(
  '_parseParams rejects q over 500 chars',
  () => {
    assertNotNull(
      _parseParams({
        q: 'a'.repeat(501)
      }).error,
      'q too long'
    );
  }
);

runTest(
  '_parseParams defaults top to 10',
  () => {
    assertEqual(
      _parseParams({ q: 'test' }).top,
      10,
      'default top'
    );
  }
);

runTest(
  '_parseParams rejects top greater than 50',
  () => {
    assertNotNull(
      _parseParams({
        q: 'test',
        top: '51'
      }).error,
      'top > 50'
    );
  }
);

runTest(
  '_parseParams rejects invalid category',
  () => {
    assertNotNull(
      _parseParams({
        q: 'test',
        category: 'sports'
      }).error,
      'invalid category'
    );
  }
);

runTest(
  '_parseParams accepts all INGEST_CATEGORIES',
  () => {
    INGEST_CATEGORIES.forEach(category => {
      const result =
        _parseParams({
          q: 'test',
          category
        });

      assert(
        !result.error,
        `Category "${category}" should be valid`
      );
    });
  }
);

runTest(
  '_parseParams rejects invalid sentiment',
  () => {
    assertNotNull(
      _parseParams({
        q: 'test',
        sentiment: 'happy'
      }).error,
      'invalid sentiment'
    );
  }
);

runTest(
  '_parseParams rejects invalid from date format',
  () => {
    assertNotNull(
      _parseParams({
        q: 'test',
        from: '15-01-2024'
      }).error,
      'bad from format'
    );
  }
);

runTest(
  '_parseParams rejects from date later than to date',
  () => {
    assertNotNull(
      _parseParams({
        q: 'test',
        from: '2024-01-31',
        to: '2024-01-01'
      }).error,
      'from > to'
    );
  }
);

runTest(
  '_parseParams defaults vector to true',
  () => {
    assertEqual(
      _parseParams({ q: 'test' }).vector,
      true,
      'vector default'
    );
  }
);

runTest(
  '_parseParams defaults semantic to false',
  () => {
    assertEqual(
      _parseParams({ q: 'test' }).semantic,
      false,
      'semantic default'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 9: fn-search-api result formatting
// -----------------------------------------------------------------------------

console.log(
  '\n── fn-search-api _formatResult ─────────────────────────────────'
);

const RAW_SEARCH_RESULT = {
  score: 0.94,
  id: 'abc123',
  url: 'https://example.com/article',
  title: 'Apple earnings',
  source: 'BBC',
  category: 'technology',
  published_at: '2024-01-15T00:00:00Z',
  sentiment_label: 'positive',
  sentiment_score_positive: 0.9,
  entities: [
    'Apple',
    'Tim Cook'
  ],
  key_phrases: [
    'record earnings'
  ]
};

runTest(
  '_formatResult maps all fields',
  () => {
    const result =
      _formatResult(RAW_SEARCH_RESULT);

    assertEqual(
      result.score,
      0.94,
      'score'
    );

    assertEqual(
      result.id,
      'abc123',
      'id'
    );

    assertEqual(
      result.sentimentLabel,
      'positive',
      'sentimentLabel'
    );

    assertEqual(
      result.sentimentScore,
      0.9,
      'sentimentScore'
    );

    assertEqual(
      result.publishedAt,
      '2024-01-15T00:00:00Z',
      'publishedAt camelCase'
    );
  }
);

runTest(
  '_formatResult converts published_at to publishedAt',
  () => {
    const result =
      _formatResult(RAW_SEARCH_RESULT);

    assertNotNull(
      result.publishedAt,
      'publishedAt present'
    );

    assert(
      !('published_at' in result),
      'No snake_case in API response'
    );
  }
);

runTest(
  '_formatResult converts sentiment_score_positive to sentimentScore',
  () => {
    const result =
      _formatResult(RAW_SEARCH_RESULT);

    assertNotNull(
      result.sentimentScore,
      'sentimentScore mapped'
    );

    assert(
      !(
        'sentiment_score_positive' in result
      ),
      'Internal field name not exposed'
    );
  }
);

runTest(
  '_formatResult returns empty arrays for missing collections',
  () => {
    const result =
      _formatResult({
        id: 'x',
        score: 0.5
      });

    assert(
      Array.isArray(result.entities) &&
      result.entities.length === 0,
      'empty entities'
    );

    assert(
      Array.isArray(result.keyPhrases) &&
      result.keyPhrases.length === 0,
      'empty keyPhrases'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 10: Search schema contract
// -----------------------------------------------------------------------------

console.log(
  '\n── index-schema.json field contract ───────────────────────────'
);

const schema = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      '../search/index-schema.json'
    ),
    'utf-8'
  )
);

const schemaFieldNames =
  new Set(
    schema.fields.map(field => field.name)
  );

runTest(
  'Search schema has no defaultScoringProfile',
  () => {
    assert(
      !(
        'defaultScoringProfile' in schema
      ),
      'defaultScoringProfile must be absent — ' +
      'applied conditionally in searchClient'
    );
  }
);

runTest(
  'Search schema uses sentiment_score_positive',
  () => {
    assert(
      schemaFieldNames.has(
        'sentiment_score_positive'
      ),
      'sentiment_score_positive present'
    );

    assert(
      !schemaFieldNames.has(
        'sentiment_score'
      ),
      'old sentiment_score absent'
    );
  }
);

runTest(
  'All fn-index-refresh mapped fields exist in schema',
  () => {
    const mappedFields = [
      'id',
      'url',
      'title',
      'body_snippet',
      'source',
      'category',
      'published_at',
      'sentiment_label',
      'sentiment_score_positive',
      'entities',
      'key_phrases',
      'content_vector'
    ];

    mappedFields.forEach(field => {
      assert(
        schemaFieldNames.has(field),
        `Schema missing field: ${field}`
      );
    });
  }
);

runTest(
  'content_vector is not retrievable',
  () => {
    const vectorField =
      schema.fields.find(
        field =>
          field.name === 'content_vector'
      );

    assert(
      vectorField.retrievable === false,
      'content_vector retrievable must be false'
    );
  }
);

runTest(
  'content_vector dimensions are 1536',
  () => {
    const vectorField =
      schema.fields.find(
        field =>
          field.name === 'content_vector'
      );

    assertEqual(
      vectorField.dimensions,
      1536,
      'vector dimensions'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 11: schemaUtils.js
// -----------------------------------------------------------------------------

console.log(
  '\n── scripts/schemaUtils.js ──────────────────────────────────────'
);

const {
  stripComments
} = require('./schemaUtils');

runTest(
  'stripComments removes comment fields recursively',
  () => {
    const cleaned =
      stripComments({
        name: 'test',
        comment: 'top level',
        fields: [
          {
            name: 'id',
            comment: 'key field'
          }
        ],
        nested: {
          deep: {
            value: 1,
            comment: 'deep comment'
          }
        }
      });

    assert(
      !JSON.stringify(cleaned)
        .includes('"comment"'),
      'All comments stripped'
    );
  }
);

runTest(
  'stripComments preserves non-comment fields',
  () => {
    const cleaned =
      stripComments({
        a: 1,
        b: {
          c: 2
        },
        comment: 'x'
      });

    assertEqual(
      cleaned.a,
      1,
      'a preserved'
    );

    assertEqual(
      cleaned.b.c,
      2,
      'b.c preserved'
    );
  }
);

runTest(
  'stripComments cleans the real search schema',
  () => {
    const cleaned =
      stripComments(schema);

    assert(
      !JSON.stringify(cleaned)
        .includes('"comment"'),
      'Real schema cleaned'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 12: Purview classification rules
// -----------------------------------------------------------------------------

console.log(
  '\n── purview/classification-rules.json ──────────────────────────'
);

const classificationRules =
  JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        '../purview/classification-rules.json'
      ),
      'utf-8'
    )
  );

runTest(
  'Classification rules file parses as valid JSON',
  () => {
    assert(
      Array.isArray(
        classificationRules.classificationRules
      ),
      'classificationRules is array'
    );
  }
);

runTest(
  'Has exactly 4 classification rules',
  () => {
    assertEqual(
      classificationRules
        .classificationRules.length,
      4,
      'Expected 4 rules'
    );
  }
);

runTest(
  'NLP_Pipeline_PII_Article targets hasPii:true',
  () => {
    const rule =
      classificationRules
        .classificationRules
        .find(
          item =>
            item.name ===
            'NLP_Pipeline_PII_Article'
        );

    assertNotNull(
      rule,
      'NLP_Pipeline_PII_Article rule'
    );

    const pattern =
      rule.dataPatterns[0].pattern;

    assert(
      pattern.includes('hasPii'),
      'hasPii in pattern'
    );

    assert(
      pattern.includes('true'),
      'true value in pattern'
    );
  }
);

runTest(
  'NLP_Pipeline_Person_Entity targets Person',
  () => {
    const rule =
      classificationRules
        .classificationRules
        .find(
          item =>
            item.name ===
            'NLP_Pipeline_Person_Entity'
        );

    assertNotNull(
      rule,
      'NLP_Pipeline_Person_Entity rule'
    );

    assert(
      rule.dataPatterns[0]
        .pattern
        .includes('Person'),
      'Person in pattern'
    );
  }
);

runTest(
  'Phone and Email pattern rules exist',
  () => {
    const names =
      classificationRules
        .classificationRules
        .map(rule => rule.name);

    assert(
      names.includes(
        'NLP_Pipeline_Phone_Pattern'
      ),
      'Phone rule present'
    );

    assert(
      names.includes(
        'NLP_Pipeline_Email_Pattern'
      ),
      'Email rule present'
    );
  }
);

runTest(
  'All classification rules are Enabled',
  () => {
    classificationRules
      .classificationRules
      .forEach(rule => {
        assertEqual(
          rule.ruleStatus,
          'Enabled',
          `Rule ${rule.name} must be Enabled`
        );
      });
  }
);

runTest(
  'All rules target ADLS Gen2 and AzureBlob',
  () => {
    classificationRules
      .classificationRules
      .forEach(rule => {
        assert(
          rule.dataSources.includes(
            'AzureDataLakeStorageGen2'
          ),
          `${rule.name} targets ADLS`
        );

        assert(
          rule.dataSources.includes(
            'AzureBlob'
          ),
          `${rule.name} targets AzureBlob`
        );
      });
  }
);

runTest(
  'Sensitivity labels include Public and Confidential',
  () => {
    assert(
      Array.isArray(
        classificationRules.sensitivityLabels
      ),
      'sensitivityLabels array'
    );

    const labelNames =
      classificationRules
        .sensitivityLabels
        .map(label => label.name);

    assert(
      labelNames.includes('Public'),
      'Public label'
    );

    assert(
      labelNames.includes('Confidential'),
      'Confidential label'
    );
  }
);

runTest(
  'Confidential label has higher order than Public',
  () => {
    const publicLabel =
      classificationRules
        .sensitivityLabels
        .find(
          label => label.name === 'Public'
        );

    const confidentialLabel =
      classificationRules
        .sensitivityLabels
        .find(
          label =>
            label.name === 'Confidential'
        );

    assert(
      confidentialLabel.order >
      publicLabel.order,
      'Confidential order > Public order'
    );
  }
);

runTest(
  'PII rule matches hasPii:true with or without spaces',
  () => {
    const rule =
      classificationRules
        .classificationRules
        .find(
          item =>
            item.name ===
            'NLP_Pipeline_PII_Article'
        );

    const pattern =
      new RegExp(
        rule.dataPatterns[0].pattern
      );

    assert(
      pattern.test('"hasPii": true'),
      'matches hasPii: true'
    );

    assert(
      pattern.test('"hasPii":true'),
      'matches hasPii:true'
    );

    assert(
      !pattern.test('"hasPii": false'),
      'does not match hasPii: false'
    );

    assert(
      !pattern.test('"hasPii":false'),
      'does not match hasPii:false'
    );
  }
);

runTest(
  'Email pattern matches valid email addresses',
  () => {
    const rule =
      classificationRules
        .classificationRules
        .find(
          item =>
            item.name ===
            'NLP_Pipeline_Email_Pattern'
        );

    const pattern =
      new RegExp(
        rule.dataPatterns[0].pattern
      );

    assert(
      pattern.test('user@example.com'),
      'standard email'
    );

    assert(
      pattern.test(
        'user.name+tag@domain.co'
      ),
      'complex email'
    );

    assert(
      !pattern.test('notanemail'),
      'rejects plain word'
    );

    assert(
      !pattern.test('@nodomain'),
      'rejects no local part'
    );
  }
);

runTest(
  'Phone pattern matches common US formats',
  () => {
    const rule =
      classificationRules
        .classificationRules
        .find(
          item =>
            item.name ===
            'NLP_Pipeline_Phone_Pattern'
        );

    const pattern =
      new RegExp(
        rule.dataPatterns[0].pattern
      );

    assert(
      pattern.test('555-867-5309'),
      'dashes format'
    );

    assert(
      pattern.test('(555) 867-5309'),
      'parens format'
    );

    assert(
      pattern.test('+1 555 867 5309'),
      'E.164 format'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 13: Purview scan configuration
// -----------------------------------------------------------------------------

console.log(
  '\n── purview/scan-config.json ────────────────────────────────────'
);

const scanConfig =
  JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        '../purview/scan-config.json'
      ),
      'utf-8'
    )
  );

runTest(
  'Scan config contains scans and dataSources arrays',
  () => {
    assert(
      Array.isArray(scanConfig.scans),
      'scans is array'
    );

    assert(
      Array.isArray(scanConfig.dataSources),
      'dataSources is array'
    );
  }
);

runTest(
  'Has exactly 4 scan definitions',
  () => {
    assertEqual(
      scanConfig.scans.length,
      4,
      'Expected 4 scans'
    );
  }
);

runTest(
  'Bronze+Silver scan applies all custom classification rules',
  () => {
    const scan =
      scanConfig.scans.find(
        item =>
          item.name ===
          'scan-bronze-silver'
      );

    assertNotNull(
      scan,
      'scan-bronze-silver'
    );

    const rules =
      scan.scanRuleSet
        .classificationRules;

    [
      'NLP_Pipeline_PII_Article',
      'NLP_Pipeline_Person_Entity',
      'NLP_Pipeline_Phone_Pattern',
      'NLP_Pipeline_Email_Pattern'
    ].forEach(ruleName => {
      assert(
        rules.includes(ruleName),
        `${ruleName} in bronze/silver scan`
      );
    });
  }
);

runTest(
  'Bronze+Silver scan scopes both containers',
  () => {
    const scan =
      scanConfig.scans.find(
        item =>
          item.name ===
          'scan-bronze-silver'
      );

    const scopeText =
      JSON.stringify(scan.scope);

    assert(
      scopeText.includes('articles-bronze'),
      'bronze in scope'
    );

    assert(
      scopeText.includes('articles-silver'),
      'silver in scope'
    );
  }
);

runTest(
  'Bronze+Silver scan uses daily schedule',
  () => {
    const scan =
      scanConfig.scans.find(
        item =>
          item.name ===
          'scan-bronze-silver'
      );

    assertEqual(
      scan.trigger.type,
      'Schedule',
      'trigger type'
    );

    assertEqual(
      scan.trigger.recurrence.frequency,
      'Day',
      'daily frequency'
    );
  }
);

runTest(
  'Search index scan targets AzureCognitiveSearch',
  () => {
    const scan =
      scanConfig.scans.find(
        item =>
          item.name ===
          'scan-search-index'
      );

    assertNotNull(
      scan,
      'scan-search-index'
    );

    assertEqual(
      scan.dataSourceType,
      'AzureCognitiveSearch',
      'Search type'
    );
  }
);

runTest(
  'Gold scan has no custom PII classification rules',
  () => {
    const scan =
      scanConfig.scans.find(
        item =>
          item.name === 'scan-gold'
      );

    assertNotNull(
      scan,
      'scan-gold'
    );

    assertEqual(
      scan.scanRuleSet
        .classificationRules.length,
      0,
      'Gold scan must have no custom classification rules'
    );
  }
);

runTest(
  'All scan dataSourceName values reference defined sources',
  () => {
    const sourceNames =
      new Set(
        scanConfig.dataSources
          .map(source => source.name)
      );

    scanConfig.scans.forEach(scan => {
      assert(
        sourceNames.has(
          scan.dataSourceName
        ),
        `Scan ${scan.name} references ` +
        `undefined source: ${scan.dataSourceName}`
      );
    });
  }
);

runTest(
  'All 3 data source kinds are defined',
  () => {
    const sourceKinds =
      scanConfig.dataSources
        .map(source => source.kind);

    assert(
      sourceKinds.includes(
        'AzureDataLakeStorageGen2'
      ),
      'ADLS source defined'
    );

    assert(
      sourceKinds.includes(
        'AzureCognitiveSearch'
      ),
      'Search source defined'
    );

    assert(
      sourceKinds.includes(
        'AzureStorage'
      ),
      'Table Storage source defined'
    );
  }
);

runTest(
  'Scan schedule starts after the ADF pipeline',
  () => {
    const bronzeSilverScan =
      scanConfig.scans.find(
        item =>
          item.name ===
          'scan-bronze-silver'
      );

    const startTime =
      bronzeSilverScan
        .trigger
        .recurrence
        .startTime;

    const hour =
      parseInt(
        startTime
          .split('T')[1]
          .split(':')[0],
        10
      );

    // ADF starts at 02:00 UTC and is expected to
    // finish by 03:00 UTC.
    assert(
      hour >= 3,
      'Bronze/silver scan must start after 03:00 UTC'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 14: hasPii pipeline contract
// -----------------------------------------------------------------------------

console.log(
  '\n── Layer 6: hasPii pipeline contract ───────────────────────────'
);

runTest(
  'hasPii=true when Person entity is present',
  () => {
    assert(
      hasPii([{ category: 'Person' }]) === true,
      'Person triggers hasPii'
    );
  }
);

runTest(
  'hasPii=true when PhoneNumber entity is present',
  () => {
    assert(
      hasPii([{ category: 'PhoneNumber' }]) === true,
      'PhoneNumber triggers hasPii'
    );
  }
);

runTest(
  'hasPii=true when Email entity is present',
  () => {
    assert(
      hasPii([{ category: 'Email' }]) === true,
      'Email triggers hasPii'
    );
  }
);

runTest(
  'hasPii=false for non-PII entities',
  () => {
    assert(
      hasPii([
        { category: 'Organization' },
        { category: 'Location' },
        { category: 'DateTime' }
      ]) === false,
      'Non-PII entities do not trigger hasPii'
    );
  }
);

runTest(
  'Purview PII rule and fn-enrich hasPii are aligned',
  () => {
    const piiRule =
      classificationRules
        .classificationRules
        .find(
          rule =>
            rule.name ===
            'NLP_Pipeline_PII_Article'
        );

    const piiPattern =
      new RegExp(
        piiRule.dataPatterns[0].pattern
      );

    const piiCategories = [
      'Person',
      'PhoneNumber',
      'Email'
    ];

    piiCategories.forEach(category => {
      const flag =
        hasPii([
          { category }
        ]);

      assert(
        flag === true,
        `${category} must set hasPii=true`
      );

      const silverJson =
        JSON.stringify({
          id: 'abc123',
          hasPii: flag
        });

      assert(
        piiPattern.test(silverJson),
        `${category} -> hasPii=true -> ` +
        'Purview rule matches silver JSON'
      );
    });
  }
);

runTest(
  'Non-PII entities do not trigger Purview classification',
  () => {
    const piiRule =
      classificationRules
        .classificationRules
        .find(
          rule =>
            rule.name ===
            'NLP_Pipeline_PII_Article'
        );

    const piiPattern =
      new RegExp(
        piiRule.dataPatterns[0].pattern
      );

    const flag =
      hasPii([
        { category: 'Organization' }
      ]);

    const silverJson =
      JSON.stringify({
        id: 'abc123',
        hasPii: flag
      });

    assert(
      flag === false,
      'Organization must not set hasPii=true'
    );

    assert(
      !piiPattern.test(silverJson),
      'hasPii=false must not match Purview rule'
    );
  }
);

// -----------------------------------------------------------------------------
// Section 15: Databricks gold aggregation wiring
// -----------------------------------------------------------------------------

console.log(
  '\n── databricks/gold_aggregation.py wiring ───────────────────────'
);

const goldAggregationSource =
  fs.readFileSync(
    path.join(
      __dirname,
      '../databricks/gold_aggregation.py'
    ),
    'utf-8'
  );

runTest(
  'gold_aggregation imports delta_helpers',
  () => {
    assert(
      goldAggregationSource.includes(
        'from utils.delta_helpers import'
      ),
      'missing delta_helpers import'
    );
  }
);

runTest(
  'gold_aggregation imports overwrite_partition',
  () => {
    assert(
      goldAggregationSource.includes(
        'overwrite_partition'
      ),
      'overwrite_partition not imported'
    );
  }
);

runTest(
  'gold_aggregation imports assert_silver_schema',
  () => {
    assert(
      goldAggregationSource.includes(
        'assert_silver_schema'
      ),
      'assert_silver_schema not imported'
    );
  }
);

runTest(
  'gold_aggregation imports log_data_quality',
  () => {
    assert(
      goldAggregationSource.includes(
        'log_data_quality'
      ),
      'log_data_quality not imported'
    );
  }
);

runTest(
  'assert_silver_schema runs before aggregation',
  () => {
    const importIndex =
      goldAggregationSource.indexOf(
        'from utils.delta_helpers import'
      );

    const schemaCheckIndex =
      goldAggregationSource.indexOf(
        'assert_silver_schema(silver)'
      );

    const sentimentIndex =
      goldAggregationSource.indexOf(
        'Gold 1: Sentiment Trends'
      );

    assert(
      schemaCheckIndex > importIndex,
      'assert_silver_schema called after import'
    );

    assert(
      schemaCheckIndex < sentimentIndex,
      'assert_silver_schema called before Gold 1 aggregation'
    );
  }
);

runTest(
  'log_data_quality runs after loading silver',
  () => {
    const countIndex =
      goldAggregationSource.indexOf(
        'total_articles = silver.count()'
      );

    const qualityLogIndex =
      goldAggregationSource.indexOf(
        'log_data_quality(silver'
      );

    assert(
      qualityLogIndex > countIndex,
      'log_data_quality called after silver.count()'
    );
  }
);

runTest(
  'gold_aggregation uses overwrite_partition instead of inline mode',
  () => {
    const modeLines =
      goldAggregationSource
        .split('\n')
        .filter(line =>
          line.includes('.mode(') &&
          !line.trim().startsWith('#')
        );

    assert(
      modeLines.length === 0,
      'Inline .mode() still present: ' +
      modeLines.join(' | ')
    );
  }
);

runTest(
  'sentiment_trends uses overwrite_partition',
  () => {
    assert(
      goldAggregationSource.includes(
        'overwrite_partition(sentiment_trends'
      ),
      'sentiment_trends uses overwrite_partition'
    );
  }
);

runTest(
  'top_entities uses overwrite_partition',
  () => {
    assert(
      goldAggregationSource.includes(
        'overwrite_partition(top_entities'
      ),
      'top_entities uses overwrite_partition'
    );
  }
);

runTest(
  'trending_keywords uses overwrite_partition',
  () => {
    assert(
      goldAggregationSource.includes(
        'overwrite_partition(trending_keywords'
      ),
      'trending_keywords uses overwrite_partition'
    );
  }
);

runTest(
  'gold_aggregation has local-testing import fallback',
  () => {
    assert(
      goldAggregationSource.includes(
        'except ImportError'
      ),
      'no ImportError fallback for local testing'
    );

    assert(
      goldAggregationSource.includes(
        'sys.path.insert'
      ),
      'no sys.path fallback'
    );
  }
);

runTest(
  'publishedAt is aliased to published_at for gold layer',
  () => {
    assert(
      goldAggregationSource.includes(
        'F.col("publishedAt").alias("published_at")'
      ),
      'publishedAt alias missing'
    );

    assert(
      !goldAggregationSource
        .split('\n')
        .some(line =>
          line.includes(
            'F.col("published_at")'
          ) &&
          !line.trim().startsWith('#')
        ),
      'raw F.col("published_at") still present'
    );
  }
);

// -----------------------------------------------------------------------------
// Databricks helper structure
// -----------------------------------------------------------------------------

console.log(
  '\n── databricks/utils/delta_helpers.py structure ─────────────────'
);

const deltaHelpersSource =
  fs.readFileSync(
    path.join(
      __dirname,
      '../databricks/utils/delta_helpers.py'
    ),
    'utf-8'
  );

const requiredHelperFunctions = [
  'overwrite_partition',
  'assert_silver_schema',
  'log_data_quality',
  'rolling_window_filter',
  'prior_window_filter',
  'safe_explode_entities',
  'merge_into_delta'
];

requiredHelperFunctions.forEach(functionName => {
  runTest(
    `delta_helpers.py defines ${functionName}`,
    () => {
      assert(
        deltaHelpersSource.includes(
          `def ${functionName}(`
        ),
        `${functionName} missing`
      );
    }
  );
});

runTest(
  'assert_silver_schema checks publishedAt camelCase',
  () => {
    assert(
      deltaHelpersSource.includes(
        '"publishedAt"'
      ),
      'assert_silver_schema must check publishedAt'
    );
  }
);

// -----------------------------------------------------------------------------
// Search directory contract
// -----------------------------------------------------------------------------

console.log(
  '\n── search/ directory: push model, no dead pull-model files ─────'
);

runTest(
  'search directory contains index-schema.json',
  () => {
    assert(
      fs.existsSync(
        path.join(
          __dirname,
          '../search/index-schema.json'
        )
      ),
      'index-schema.json missing'
    );
  }
);

runTest(
  'indexer.json does not exist',
  () => {
    assert(
      !fs.existsSync(
        path.join(
          __dirname,
          '../search/indexer.json'
        )
      ),
      'indexer.json exists but should not — ' +
      'pipeline uses push model'
    );
  }
);

runTest(
  'skillset.json does not exist',
  () => {
    assert(
      !fs.existsSync(
        path.join(
          __dirname,
          '../search/skillset.json'
        )
      ),
      'skillset.json exists but should not — ' +
      'NLP enrichment is performed by fn-enrich'
    );
  }
);

runTest(
  'PROJECT_PLAN documents the push model decision',
  () => {
    const projectPlan =
      fs.readFileSync(
        path.join(
          __dirname,
          '../docs/PROJECT_PLAN.md'
        ),
        'utf-8'
      );

    assert(
      projectPlan.includes('push API') ||
      projectPlan.includes(
        'mergeOrUploadDocuments'
      ) ||
      projectPlan.includes(
        'intentionally absent'
      ),
      'PROJECT_PLAN should explain push model design decision'
    );
  }
);

// -----------------------------------------------------------------------------
// Integration tests
// -----------------------------------------------------------------------------

async function runIntegrationTests() {
  console.log(
    '\n── Integration tests (live Azure) ──────────────────────────────'
  );

  console.log(
    '  Checking required environment variables...'
  );

  const requiredVariables = [
    'NEWSAPI_KEY',
    'AZURE_STORAGE_CONNECTION_STRING',
    'LANGUAGE_ENDPOINT',
    'LANGUAGE_API_KEY',
    'OPENAI_ENDPOINT',
    'OPENAI_API_KEY',
    'SEARCH_ENDPOINT',
    'SEARCH_API_KEY'
  ];

  const missingVariables =
    requiredVariables.filter(
      variable => !process.env[variable]
    );

  if (missingVariables.length > 0) {
    console.error(
      `  Missing env vars: ${missingVariables.join(', ')}`
    );

    console.error(
      '  Copy functions/local.settings.example.txt ' +
      '→ functions/.env and fill in the required values'
    );

    testResults.failed++;
    return;
  }

  const axios =
    require('../functions/node_modules/axios');

  // ---------------------------------------------------------------------------
  // Integration test 1: NewsAPI
  // ---------------------------------------------------------------------------

  try {
    const response =
      await axios.get(
        'https://newsapi.org/v2/top-headlines',
        {
          params: {
            category: 'technology',
            language: 'en',
            pageSize: 1
          },
          headers: {
            'X-Api-Key':
              process.env.NEWSAPI_KEY
          },
          timeout: 10000
        }
      );

    assert(
      response.data.status === 'ok',
      'NewsAPI status ok'
    );

    assert(
      Array.isArray(
        response.data.articles
      ),
      'NewsAPI articles array'
    );

    testResults.passed++;

    console.log(
      '  ✓ NewsAPI reachable — articles returned'
    );
  } catch (error) {
    testResults.failed++;

    testResults.errors.push({
      name: 'NewsAPI reachability',
      error: error.message
    });

    console.error(
      `  ✗ NewsAPI reachability: ${error.message}`
    );
  }

  // ---------------------------------------------------------------------------
  // Integration test 2: Azure AI Search
  // ---------------------------------------------------------------------------

  try {
    const {
      getDocumentCount
    } = require(
      '../functions/shared/searchClient'
    );

    const documentCount =
      await getDocumentCount();

    testResults.passed++;

    console.log(
      `  ✓ Azure AI Search reachable — ` +
      `${documentCount} documents in index`
    );
  } catch (error) {
    testResults.failed++;

    testResults.errors.push({
      name:
        'Azure AI Search reachability',
      error: error.message
    });

    console.error(
      `  ✗ Azure AI Search: ${error.message}`
    );
  }
}

// -----------------------------------------------------------------------------
// Final results
// -----------------------------------------------------------------------------

async function main() {
  console.log(
    `\nNLP Pipeline Smoke Test — ` +
    `${integrationMode ? 'INTEGRATION' : 'UNIT'} mode`
  );

  console.log(
    '='.repeat(60)
  );

  if (integrationMode) {
    await runIntegrationTests();
  }

  console.log(
    '\n' + '='.repeat(60)
  );

  console.log(
    `Results: ${testResults.passed} passed, ` +
    `${testResults.failed} failed`
  );

  if (testResults.errors.length > 0) {
    console.error('\nFailures:');

    testResults.errors.forEach(
      failure => {
        console.error(
          `  ✗ ${failure.name}: ${failure.error}`
        );
      }
    );
  }

  process.exit(
    testResults.failed > 0 ? 1 : 0
  );
}

main().catch(error => {
  console.error(
    'FATAL:',
    error.message
  );

  process.exit(1);
});