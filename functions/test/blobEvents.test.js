'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  containerFromSubject,
  blobPathFromSubject,
  parseBronzePath
} = require('../shared/blobEvents');


const EVENT_SUBJECT =
  '/blobServices/default/containers/articles-bronze/blobs/' +
  'technology/2024-01-15/abc123.json';


test(
  'containerFromSubject extracts the container name',
  () => {

    assert.equal(
      containerFromSubject(EVENT_SUBJECT),
      'articles-bronze'
    );

    assert.equal(
      containerFromSubject('nonsense'),
      null
    );

    assert.equal(
      containerFromSubject(undefined),
      null
    );
  }
);


test(
  'blobPathFromSubject returns the path after /blobs/',
  () => {

    assert.equal(
      blobPathFromSubject(EVENT_SUBJECT),
      'technology/2024-01-15/abc123.json'
    );

    assert.equal(
      blobPathFromSubject('/no/blob/marker'),
      null
    );
  }
);


test(
  'parseBronzePath accepts a valid category/date/hash path',
  () => {

    assert.deepEqual(
      parseBronzePath(
        'technology/2024-01-15/abc123.json'
      ),
      {
        category: 'technology',
        dateStr: '2024-01-15',
        urlHash: 'abc123'
      }
    );
  }
);


test(
  'parseBronzePath rejects malformed paths',
  () => {

    assert.equal(
      parseBronzePath(
        'technology/abc123.json'
      ),
      null
    );

    assert.equal(
      parseBronzePath(
        'a/b/c/d.json'
      ),
      null
    );

    assert.equal(
      parseBronzePath(
        'technology/2024-01-15/abc123.txt'
      ),
      null
    );

    assert.equal(
      parseBronzePath(null),
      null
    );
  }
);