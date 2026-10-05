'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { hashUrl } = require('../shared/urlHash');
const hashUrlFunction = require('../fn-hash-url');


test(
  'hashUrl returns the first 16 characters of the SHA-256 URL hash',
  () => {

    const articleUrl =
      'https://www.theverge.com/2024/01/15/article';

    const expectedHash =
      crypto
        .createHash('sha256')
        .update(articleUrl)
        .digest('hex')
        .slice(0, 16);


    assert.equal(
      hashUrl(articleUrl),
      expectedHash
    );

    assert.equal(
      hashUrl(`  ${articleUrl}  `),
      expectedHash
    );
  }
);


test(
  'fn-hash-url returns a 200 response with the hash and trimmed URL',
  async () => {

    const context = {};

    await hashUrlFunction(
      context,
      {
        body: {
          url: ' https://example.com/a '
        }
      }
    );


    assert.equal(
      context.res.status,
      200
    );

    assert.equal(
      context.res.body.url,
      'https://example.com/a'
    );

    assert.equal(
      context.res.body.urlHash,
      hashUrl(
        'https://example.com/a'
      )
    );
  }
);


test(
  'fn-hash-url returns 400 when the URL is missing or invalid',
  async () => {

    const invalidBodies = [
      undefined,
      {},
      { url: '   ' },
      { url: 42 }
    ];


    for (const body of invalidBodies) {

      const context = {};

      await hashUrlFunction(
        context,
        { body }
      );

      assert.equal(
        context.res.status,
        400
      );
    }
  }
);