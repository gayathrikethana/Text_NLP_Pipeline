'use strict';

/**
 * scripts/backfill-silver.js
 *
 * Finds bronze articles that do not yet have a corresponding silver document
 * and places them on the article enrichment queue.
 *
 * The normal fn-enrich flow handles the actual NLP processing, retries,
 * error handling, and audit logging.
 */

require('dotenv').config({
  path: `${__dirname}/../functions/.env`
});

const {
  listBlobs,
  exists,
  buildBlobPath
} = require('../functions/shared/blobClient');

const {
  enqueueArticles
} = require('../functions/shared/queueClient');

const {
  INGEST_CATEGORIES,
  CONTAINERS
} = require('../functions/shared/config');

const BRONZE_CONTAINER = CONTAINERS.BRONZE;
const SILVER_CONTAINER = CONTAINERS.SILVER;

// -----------------------------------------------------------------------------
// Command-line options
// -----------------------------------------------------------------------------

const cliArgs = process.argv.slice(2);

function getOption(name, defaultValue = null) {
  const position = cliArgs.indexOf(name);
  return position >= 0
    ? cliArgs[position + 1]
    : defaultValue;
}

function hasOption(name) {
  return cliArgs.includes(name);
}

const singleDate = getOption('--date');

const startDate = getOption('--from', singleDate);
const endDate = getOption('--to', singleDate);

const selectedCategory = getOption('--category');

const isDryRun = hasOption('--dry-run');
const forceReprocess = hasOption('--force');

const batchSize = Number.parseInt(
  getOption('--batch-size', '10'),
  10
);

const batchDelayMs = Number.parseInt(
  getOption('--delay-ms', '500'),
  10
);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// -----------------------------------------------------------------------------
// Validate command-line input
// -----------------------------------------------------------------------------

if (!startDate || !endDate) {
  console.error(
    'Usage: node backfill-silver.js --date YYYY-MM-DD'
  );
  console.error(
    '       node backfill-silver.js --from YYYY-MM-DD --to YYYY-MM-DD'
  );
  process.exit(1);
}

if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
  console.error('Dates must be in YYYY-MM-DD format');
  process.exit(1);
}

if (startDate > endDate) {
  console.error('--from must be on or before --to');
  process.exit(1);
}

const categories = selectedCategory
  ? [selectedCategory]
  : INGEST_CATEGORIES;

// -----------------------------------------------------------------------------
// Utility functions
// -----------------------------------------------------------------------------

function* getDatesInRange(from, to) {
  const currentDate = new Date(`${from}T00:00:00Z`);
  const finalDate = new Date(`${to}T00:00:00Z`);

  while (currentDate <= finalDate) {
    yield currentDate.toISOString().split('T')[0];
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }
}

function wait(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function extractUrlHash(blobPath) {
  const pathParts = blobPath.split('/');

  return pathParts[2]?.replace('.json', '');
}

// -----------------------------------------------------------------------------
// Main backfill process
// -----------------------------------------------------------------------------

async function main() {
  console.log('NLP Pipeline — Silver Backfill');
  console.log('='.repeat(50));
  console.log(`Date range  : ${startDate} → ${endDate}`);
  console.log(`Categories  : ${categories.join(', ')}`);
  console.log(`Dry run     : ${isDryRun}`);
  console.log(
    `Force       : ${forceReprocess} (re-enrich even if silver exists)`
  );
  console.log(`Batch size  : ${batchSize}`);
  console.log(`Delay       : ${batchDelayMs}ms between batches`);
  console.log('');

  const statistics = {
    total: 0,
    alreadyEnriched: 0,
    queued: 0,
    failed: 0
  };

  const pendingArticles = [];

  // ---------------------------------------------------------------------------
  // Step 1: Find bronze articles without silver documents
  // ---------------------------------------------------------------------------

  console.log('Step 1: Scanning bronze layer...');

  for (const category of categories) {
    for (const date of getDatesInRange(startDate, endDate)) {
      const blobPrefix = `${category}/${date}/`;

      let bronzeBlobs;

      try {
        bronzeBlobs = await listBlobs(
          BRONZE_CONTAINER,
          blobPrefix
        );
      } catch (error) {
        console.error(
          `  ✗ Failed to list ${blobPrefix}: ${error.message}`
        );

        statistics.failed++;
        continue;
      }

      if (bronzeBlobs.length === 0) {
        continue;
      }

      for (const bronzePath of bronzeBlobs) {
        statistics.total++;

        const urlHash = extractUrlHash(bronzePath);

        if (!urlHash) {
          statistics.failed++;
          continue;
        }

        const silverPath = buildBlobPath(
          category,
          date,
          urlHash
        );

        // Normally, an existing silver document means the article
        // does not need to be placed on the queue again.
        if (!forceReprocess) {
          try {
            const silverDocumentExists = await exists(
              SILVER_CONTAINER,
              silverPath
            );

            if (silverDocumentExists) {
              statistics.alreadyEnriched++;
              continue;
            }
          } catch (error) {
            console.warn(
              `  ⚠ Could not check silver for ${urlHash}: ` +
              `${error.message} — will re-enqueue`
            );
          }
        }

        pendingArticles.push({
          blobPath: bronzePath,
          urlHash,
          category,
          ingestedAt: new Date().toISOString()
        });
      }
    }
  }

  console.log(`  Bronze blobs found  : ${statistics.total}`);
  console.log(`  Already enriched    : ${statistics.alreadyEnriched}`);
  console.log(`  To enqueue          : ${pendingArticles.length}`);
  console.log('');

  // ---------------------------------------------------------------------------
  // Nothing to process
  // ---------------------------------------------------------------------------

  if (pendingArticles.length === 0) {
    console.log(
      'Nothing to backfill — all bronze articles already have silver counterparts.'
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // Dry-run mode
  // ---------------------------------------------------------------------------

  if (isDryRun) {
    console.log(
      `[DRY RUN] Would enqueue ${pendingArticles.length} articles. Sample:`
    );

    pendingArticles
      .slice(0, 5)
      .forEach(article => {
        console.log(`  ${article.blobPath}`);
      });

    if (pendingArticles.length > 5) {
      console.log(
        `  ... and ${pendingArticles.length - 5} more`
      );
    }

    return;
  }

  // ---------------------------------------------------------------------------
  // Step 2: Enqueue articles in batches
  // ---------------------------------------------------------------------------

  console.log(
    `Step 2: Enqueueing ${pendingArticles.length} articles ` +
    `in batches of ${batchSize}...`
  );

  const totalBatches = Math.ceil(
    pendingArticles.length / batchSize
  );

  for (
    let offset = 0;
    offset < pendingArticles.length;
    offset += batchSize
  ) {
    const currentBatch = pendingArticles.slice(
      offset,
      offset + batchSize
    );

    const batchNumber =
      Math.floor(offset / batchSize) + 1;

    try {
      const result = await enqueueArticles(currentBatch);

      statistics.queued += result.enqueued;
      statistics.failed += result.failed;

      console.log(
        `  Batch ${batchNumber}/${totalBatches}: ` +
        `${result.enqueued} queued, ` +
        `${result.failed} failed`
      );
    } catch (error) {
      console.error(
        `  Batch ${batchNumber}/${totalBatches}: ` +
        `FAILED — ${error.message}`
      );

      statistics.failed += currentBatch.length;
    }

    const hasMoreBatches =
      offset + batchSize < pendingArticles.length;

    if (hasMoreBatches) {
      await wait(batchDelayMs);
    }
  }

  // ---------------------------------------------------------------------------
  // Final summary
  // ---------------------------------------------------------------------------

  console.log('');
  console.log('='.repeat(50));
  console.log(`Total bronze blobs   : ${statistics.total}`);
  console.log(`Already enriched     : ${statistics.alreadyEnriched}`);
  console.log(`Queued for enrichment: ${statistics.queued}`);
  console.log(`Failed               : ${statistics.failed}`);
  console.log('');

  if (statistics.queued > 0) {
    console.log(
      `✓ ${statistics.queued} articles enqueued. ` +
      'fn-enrich will process them from article-enrich-queue.'
    );

    console.log(
      '  Monitor progress in Azure portal → Storage → Queues → article-enrich-queue'
    );

    console.log(
      '  Or check Application Insights for fn-enrich enrichment traces.'
    );
  }

  if (statistics.failed > 0) {
    console.error(
      `✗ ${statistics.failed} failures. ` +
      'Check the messages above and re-run the affected date range.'
    );

    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Application entry point
// -----------------------------------------------------------------------------

main().catch(error => {
  console.error('FATAL:', error.message);
  process.exit(1);
});