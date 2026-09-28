import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function trustedUrl(value, kind) {
  const url = new URL(value);
  const hosts =
    kind === 'post' ? ['instagram.com'] : ['cdninstagram.com', 'fbcdn.net'];
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new Error(`Unexpected Instagram ${kind} URL`);
  }
  return url.href;
}

export function normalizePosts(data) {
  if (!Array.isArray(data))
    throw new Error('Instagram response has no post list');
  return data.slice(0, 20).map((post) => {
    if (!/^\d+$/.test(post.id)) throw new Error('Invalid Instagram post ID');
    const media =
      post.media_type === 'VIDEO' ? post.thumbnail_url : post.media_url;
    return {
      id: post.id,
      caption: typeof post.caption === 'string' ? post.caption : '',
      permalink: trustedUrl(post.permalink, 'post'),
      source: trustedUrl(media, 'image'),
    };
  });
}

async function api(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  // Never log Meta's raw error body: it may contain request/credential details.
  if (!response.ok)
    throw new Error(
      `Instagram API failed (HTTP ${response.status}); check token, permissions and API kind.`,
    );
  const body = await response.json();
  if (body.error)
    throw new Error(
      'Instagram API returned an error; check the account connection.',
    );
  return body;
}

export async function syncInstagram({
  root = process.cwd(),
  token,
  accountId,
  kind,
  version = 'v25.0',
  fetchPosts,
  fetchImage,
} = {}) {
  if (!token)
    throw new Error('Set the INSTAGRAM_ACCESS_TOKEN repository secret.');
  if (!/^\d+$/.test(accountId || ''))
    throw new Error(
      'Set the numeric INSTAGRAM_ACCOUNT_ID repository variable.',
    );
  if (!['instagram', 'facebook'].includes(kind))
    throw new Error(
      'Set INSTAGRAM_API_KIND to instagram or facebook after checking the existing token.',
    );
  if (!/^v\d+\.\d+$/.test(version))
    throw new Error('Invalid INSTAGRAM_API_VERSION.');
  const host =
    kind === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  const url = new URL(`https://${host}/${version}/${accountId}/media`);
  url.searchParams.set(
    'fields',
    'id,caption,media_type,media_url,thumbnail_url,permalink',
  );
  url.searchParams.set('limit', '20');
  const body = fetchPosts ? await fetchPosts() : await api(url, token);
  const posts = normalizePosts(body.data);
  const stage = resolve(root, '.instagram-stage');
  const imageDir = resolve(root, 'public/images/instagram');
  const feedFile = resolve(root, 'src/content/instagram.json');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    const output = [];
    for (const post of posts) {
      const response = fetchImage
        ? await fetchImage(post.source)
        : await fetch(post.source, {
            signal: AbortSignal.timeout(30_000),
            redirect: 'error',
          });
      if (!response.ok)
        throw new Error(
          `Instagram image download failed (HTTP ${response.status}).`,
        );
      const type = response.headers.get('content-type')?.split(';')[0];
      const extension = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      }[type];
      if (!extension) throw new Error('Unexpected Instagram image format.');
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES)
          throw new Error('Instagram image exceeds size limit.');
        chunks.push(chunk);
      }
      if (!size) throw new Error('Instagram image is empty.');
      const filename = `${post.id}.${extension}`;
      await writeFile(resolve(stage, filename), Buffer.concat(chunks));
      output.push({
        id: post.id,
        caption: post.caption,
        permalink: post.permalink,
        image: `/images/instagram/${filename}`,
      });
    }
    // All requests succeed before replacing any cached feed content.
    await mkdir(imageDir, { recursive: true });
    for (const post of output) {
      const filename = post.image.split('/').at(-1);
      await rename(resolve(stage, filename), resolve(imageDir, filename));
    }
    let previous = { posts: [] };
    try {
      previous = JSON.parse(await readFile(feedFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const feed = {
      updatedAt: new Date().toISOString(),
      source: 'instagram-api',
      posts: output,
    };
    await writeFile(
      resolve(stage, 'feed.json'),
      JSON.stringify(feed, null, 2) + '\n',
    );
    await mkdir(resolve(root, 'src/content'), { recursive: true });
    await rename(resolve(stage, 'feed.json'), feedFile);
    // Drop cached images for removed posts; never accumulate an indefinite archive.
    const current = new Set(output.map((post) => post.image));
    for (const post of previous.posts) {
      if (
        !current.has(post.image) &&
        /^\/images\/instagram\/[\w-]+\.(jpg|png|webp)$/.test(post.image)
      ) {
        await rm(resolve(root, 'public' + post.image), { force: true });
      }
    }
    return output.length;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function refreshToken(token) {
  // Opt-in: the token must be a supported Instagram Login long-lived token.
  // GitHub's default GITHUB_TOKEN cannot write repository secrets.
  if (!process.env.INSTAGRAM_SECRETS_TOKEN) return token;
  if (process.env.INSTAGRAM_API_KIND !== 'instagram')
    throw new Error('Automatic refresh only supports Instagram Login tokens.');
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  const result = await api(url, token);
  if (typeof result.access_token !== 'string' || !result.access_token)
    throw new Error('Token refresh returned no token.');
  const saved = spawnSync(
    'gh',
    [
      'secret',
      'set',
      'INSTAGRAM_ACCESS_TOKEN',
      '--repo',
      process.env.GITHUB_REPOSITORY,
    ],
    {
      input: result.access_token,
      env: { ...process.env, GH_TOKEN: process.env.INSTAGRAM_SECRETS_TOKEN },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  if (saved.status !== 0)
    throw new Error('Could not persist refreshed token to GitHub secrets.');
  return result.access_token;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    let token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token)
      throw new Error('Set the INSTAGRAM_ACCESS_TOKEN repository secret.');
    // Weekly refresh avoids attempting to refresh a token younger than 24 hours.
    if (process.env.REFRESH_INSTAGRAM_TOKEN === 'true')
      token = await refreshToken(token);
    const count = await syncInstagram({
      token,
      accountId: process.env.INSTAGRAM_ACCOUNT_ID,
      kind: process.env.INSTAGRAM_API_KIND,
      version: process.env.INSTAGRAM_API_VERSION || 'v25.0',
    });
    console.log(`Updated Instagram feed: ${count} posts.`);
  } catch (error) {
    // Only our own sanitized messages; network errors can include sensitive URLs.
    const safe =
      /^(Set |Invalid |Unexpected |Instagram |Token refresh |Could not |Automatic refresh )/.test(
        error.message,
      );
    console.error(
      safe
        ? error.message
        : 'Instagram sync failed; cached feed was retained. Check connection and filesystem access.',
    );
    process.exitCode = 1;
  }
}
