'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractText,
  textSource,
  isContentTruncated,
  dateFromBlobPath
} = require('../shared/articleText');


test(
  'extractText removes the NewsAPI truncation marker',
  () => {
    assert.equal(
      extractText({
        content: 'Hello world [+1234 chars]'
      }),
      'Hello world'
    );
  }
);


test(
  'extractText removes HTML tags and preserves word spacing',
  () => {
    assert.equal(
      extractText({
        content: '<p>Hello</p><b>world</b>'
      }),
      'Hello world'
    );
  }
);


test(
  'extractText uses content, then description, then title',
  () => {

    assert.equal(
      extractText({
        content: '  ',
        description: ' Desc ',
        title: 'T'
      }),
      'Desc'
    );

    assert.equal(
      extractText({
        content: null,
        description: '',
        title: ' Title '
      }),
      'Title'
    );

    assert.equal(
      extractText({}),
      ''
    );
  }
);


test(
  'textSource identifies the field used for extraction',
  () => {

    assert.equal(
      textSource({ content: 'x' }),
      'content'
    );

    assert.equal(
      textSource({ description: 'x' }),
      'description'
    );

    assert.equal(
      textSource({ title: 'x' }),
      'title'
    );
  }
);


test(
  'isContentTruncated detects the NewsAPI marker',
  () => {

    assert.equal(
      isContentTruncated({
        content: 'abc [+50 chars]'
      }),
      true
    );

    assert.equal(
      isContentTruncated({
        content: 'abc'
      }),
      false
    );

    assert.equal(
      isContentTruncated({}),
      false
    );
  }
);


test(
  'dateFromBlobPath extracts the date segment',
  () => {

    assert.equal(
      dateFromBlobPath(
        'technology/2024-01-15/abc.json'
      ),
      '2024-01-15'
    );

    assert.match(
      dateFromBlobPath(
        'only-one-segment'
      ),
      /^\d{4}-\d{2}-\d{2}$/
    );
  }
);