import test from 'node:test';
import assert from 'node:assert/strict';
import { captionDownloadError } from '../server/captions.mjs';

test('YouTube 429 is explicit and never leaks downloader URLs or credentials', () => {
  const error = captionDownloadError({ stderr: 'URL https://example.invalid/?token=private\nERROR: HTTP Error 429: Too Many Requests' });
  assert.equal(error.status, 429);
  assert.equal(error.code, 'YOUTUBE_RATE_LIMITED');
  assert.match(error.message, /429/);
  assert.doesNotMatch(error.message, /token|private|https/);
});
