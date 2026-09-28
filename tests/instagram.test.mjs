import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizePosts,
  syncInstagram,
  trustedUrl,
} from '../scripts/sync-instagram.mjs';

const photo = {
  id: '123',
  media_type: 'IMAGE',
  caption: 'A new post',
  media_url: 'https://scontent.cdninstagram.com/photo.jpg',
  permalink: 'https://www.instagram.com/p/example/',
};

test('videos use their thumbnail and captions may be absent', () => {
  const [post] = normalizePosts([
    {
      ...photo,
      media_type: 'VIDEO',
      caption: undefined,
      media_url: 'https://scontent.cdninstagram.com/video.mp4',
      thumbnail_url: photo.media_url,
    },
  ]);
  assert.equal(post.source, photo.media_url);
  assert.equal(post.caption, '');
  assert.equal(post.type, 'video');
});

test('post types are normalized for grid icons', () => {
  const types = normalizePosts([
    photo,
    { ...photo, media_type: 'CAROUSEL_ALBUM' },
  ]).map((post) => post.type);
  assert.deepEqual(types, ['image', 'carousel']);
});

test('untrusted media, unsafe IDs and invalid response structures are rejected', () => {
  for (const url of [
    'http://cdninstagram.com/a',
    'https://cdninstagram.com.evil.test/a',
    'https://localhost/a',
    'https://user:pass@cdninstagram.com/a',
  ]) {
    assert.throws(() => trustedUrl(url, 'image'));
  }
  assert.throws(() => normalizePosts([{ ...photo, id: '../escape' }]));
  assert.throws(() => normalizePosts(undefined));
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'autumn-lane-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src/content'), { recursive: true });
  await mkdir(join(root, 'public/images/instagram'), { recursive: true });
  const existing = JSON.stringify({
    posts: [{ image: '/images/instagram/old.jpg' }],
  });
  await writeFile(join(root, 'src/content/instagram.json'), existing);
  await writeFile(join(root, 'public/images/instagram/old.jpg'), 'old-image');
  return {
    root,
    existing,
    token: 'test-only-secret',
    accountId: '12345',
    kind: 'instagram',
  };
}

test('successful sync writes local paths only and removes obsolete images', async (t) => {
  const options = await fixture(t);
  const count = await syncInstagram({
    ...options,
    fetchPosts: async () => ({ data: [photo] }),
    fetchImage: async () =>
      new Response('image-bytes', {
        headers: { 'content-type': 'image/jpeg' },
      }),
  });
  assert.equal(count, 1);
  const raw = await readFile(
    join(options.root, 'src/content/instagram.json'),
    'utf8',
  );
  const feed = JSON.parse(raw);
  assert.equal(feed.posts[0].image, '/images/instagram/123.jpg');
  assert.ok(!raw.includes(options.token));
  assert.ok(!raw.includes('cdninstagram'));
  assert.equal(
    await readFile(
      join(options.root, 'public/images/instagram/123.jpg'),
      'utf8',
    ),
    'image-bytes',
  );
  await assert.rejects(
    access(join(options.root, 'public/images/instagram/old.jpg')),
  );
});

test('partial download failure leaves the previous feed and images intact', async (t) => {
  const options = await fixture(t);
  let calls = 0;
  await assert.rejects(
    syncInstagram({
      ...options,
      fetchPosts: async () => ({ data: [photo, { ...photo, id: '456' }] }),
      fetchImage: async () =>
        ++calls === 1
          ? new Response('new-image', {
              headers: { 'content-type': 'image/jpeg' },
            })
          : new Response('', { status: 503 }),
    }),
  );
  assert.equal(
    await readFile(join(options.root, 'src/content/instagram.json'), 'utf8'),
    options.existing,
  );
  assert.equal(
    await readFile(
      join(options.root, 'public/images/instagram/old.jpg'),
      'utf8',
    ),
    'old-image',
  );
  await assert.rejects(
    access(join(options.root, 'public/images/instagram/123.jpg')),
  );
  await assert.rejects(access(join(options.root, '.instagram-stage')));
});

test('a successful empty feed removes posts that are no longer available', async (t) => {
  const options = await fixture(t);
  await syncInstagram({ ...options, fetchPosts: async () => ({ data: [] }) });
  const feed = JSON.parse(
    await readFile(join(options.root, 'src/content/instagram.json'), 'utf8'),
  );
  assert.deepEqual(feed.posts, []);
  await assert.rejects(
    access(join(options.root, 'public/images/instagram/old.jpg')),
  );
});

test('missing credentials fail without modifying the existing feed', async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    syncInstagram({ ...options, token: undefined }),
    /INSTAGRAM_ACCESS_TOKEN/,
  );
  assert.equal(
    await readFile(join(options.root, 'src/content/instagram.json'), 'utf8'),
    options.existing,
  );
});
