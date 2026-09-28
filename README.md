# Autumn Lane

Static Astro website for **www.autumnlane.cz**, hosted on GitHub Pages. No CMS,
database, paid feed widget, or WordPress runtime is required.

## Local development

Use Node.js 24 LTS (the version used by CI).

```sh
npm ci
npm run dev
```

`npm run build` creates `dist/`. `npm run preview` serves the production build.
`npm test` checks Instagram normalization, URL validation, cache updates, and
failure recovery without contacting Instagram.

### Formatting and pre-commit hooks

`npm ci` / `npm install` installs the Husky hooks through the `prepare` script.
Before each commit, lint-staged runs Prettier on all supported staged files and
includes formatting changes in that commit. Astro, JavaScript, JSON, CSS, YAML,
Markdown are supported. Binary assets, generated output and secrets are
excluded; Python and shell files have no built-in Prettier parser and are skipped.
Partially staged files are handled by lint-staged so unrelated unstaged edits stay
out of the commit.

```sh
npm run format        # Format the entire project
npm run format:check  # Verify formatting without changes (also runs in CI)
```

GitHub browser edits do not run local hooks; CI checks their formatting. No commit
is created by the formatter or hook itself.

## Edit the website

Edit `src/content/site.json` locally or with GitHub's file editor:

- `release`: title, listening link, and button label.
- `videos`: titles and YouTube IDs (the part after `watch?v=`). Array order is display order.
- `streaming` and `socials`: labels and HTTPS URLs.
- `description`: search/social description.

Replace `src/assets/eaten-by-mind.png` to change the release artwork and
`src/assets/band.jpg` to change the hero photo. Astro creates responsive WebP images
at build time. The logo is `public/images/logo.png`. Layout and styling live in
`src/pages/index.astro` and `src/styles/global.css`.

Commit changes to `main` to publish after Pages is configured. Videos load their
player on interaction; without JavaScript they link directly to YouTube.

## Enable GitHub Pages

1. Push this project to `Mark12870/autumn-lane` on branch `main`.
2. In **Settings → Pages**, set **Source → GitHub Actions**.
3. Run **Actions → Deploy website → Run workflow** (leave Instagram sync unchecked
   for the initial deployment).
4. Test `https://mark12870.github.io/autumn-lane/` before changing DNS.

The deployment workflow reads the Pages origin/base path automatically, so both
the project URL and the custom domain work. Pull requests run tests and builds
without Instagram secrets. Ordinary pushes build using the latest committed feed
snapshot; scheduled or explicitly requested syncs retrieve new posts.

### Custom domain

After verifying the preview:

1. Verify domain ownership in GitHub and set **Settings → Pages → Custom domain**
   to `www.autumnlane.cz`.
2. Set the DNS `www` CNAME to `mark12870.github.io` (no repository path).
3. Configure apex `autumnlane.cz` for GitHub Pages using its documented A/ALIAS
   records so it redirects to `www`.
4. Enable HTTPS and rerun deployment to update canonical URLs and the base path.

Keep existing email/MX records. With Actions deployment, GitHub's custom-domain
setting is authoritative; a `CNAME` file is not required.

## Instagram: reuse the existing Smash Balloon credentials

The initial 19-post snapshot was imported from the existing public WordPress page.
It is a fallback, **not evidence of a working API connection**. Automatic updates
require completing this setup. Do not paste credentials into source files or chat.

### Identify the existing connection

In WordPress, inspect **Instagram Feed → Settings → Manage Sources** for
`autumnlaneband`. Confirm the token type, numeric account ID, permissions, and expiry.
A Smash Balloon license key is not an Instagram token. Tokens issued through the
plugin's app may depend on that app's permissions or renewal service; reuse outside
the plugin must be verified before retiring WordPress. Do not revoke the old app
while testing the same authorization.

This implementation supports two explicit connection types; it does not guess from
token prefixes:

| Setting                          | Value                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| Secret `INSTAGRAM_ACCESS_TOKEN`  | Existing valid access token                                               |
| Variable `INSTAGRAM_ACCOUNT_ID`  | Numeric Instagram account ID for that API connection                      |
| Variable `INSTAGRAM_API_KIND`    | `instagram` for Instagram Login; `facebook` for Facebook Login/Graph      |
| Variable `INSTAGRAM_API_VERSION` | Optional, defaults to `v25.0`; use a version supported by the issuing app |

Set these under **Settings → Secrets and variables → Actions**. A Creator account
is supported by the professional-account APIs, but the token must have the relevant
read permissions for that account. A Facebook user/Page ID is not a substitute for
the Instagram account ID.

Then run **Deploy website** with **sync_instagram** checked. A successful run should
create local images and feed data, commit the snapshot, build, and deploy. If Meta
rejects the token, the workflow fails with a sanitized status message and the
previously deployed site remains available. Do not remove WordPress until this test
and the renewal mechanism have been verified.

### Daily updates and caching

The workflow runs at **07:23 UTC daily** (09:23 Czech summer time, 08:23 winter time).
It fetches up to 20 recent posts. Photos/carousel covers and Reel thumbnails link
to the original Instagram posts. It downloads images locally because Meta media
URLs expire. No access token or original media URL is written into published data.

Failed API/image requests preserve the previous feed. Successful refreshes remove
images for posts no longer in the returned set, including an empty account feed.
The job records a successful-check timestamp, creating one daily snapshot commit
even when the account has no new posts. These commits also keep repository activity
current; still monitor Actions because schedules can be delayed or disabled.

The workflow needs permission to push those cache commits to `main`. If branch
protection blocks bot pushes, configure an allowed automation identity or adapt the
cache-persistence workflow before relying on scheduled updates. The build proceeds
within the same run: pushes made by `GITHUB_TOKEN` do not trigger another workflow.

### Token renewal

**Storing a token as a secret does not renew it.** Without optional renewal setup,
replace `INSTAGRAM_ACCESS_TOKEN` when required by the issuing connection. Enable
GitHub notifications for failed Actions runs.

For a confirmed **Instagram Login long-lived token** supporting Meta's refresh
endpoint, this project can refresh it on Mondays and securely persist the returned
token using GitHub CLI (preinstalled on GitHub's Ubuntu runner):

1. First verify the existing token supports refresh outside Smash Balloon. Newly
   issued tokens must be at least 24 hours old before refreshing.
2. Create a fine-grained GitHub personal access token restricted to this repository,
   with **Secrets: read and write** repository permission.
3. Store it as the additional Actions secret `INSTAGRAM_SECRETS_TOKEN`.
4. Keep track of this GitHub credential's own expiry. It is used solely to update
   `INSTAGRAM_ACCESS_TOKEN`; its value is never passed on the command line or logged.

If no `INSTAGRAM_SECRETS_TOKEN` is configured, scheduled syncs simply use the stored
Instagram token. Facebook Login tokens have different renewal rules; automatic
refresh in this project deliberately does not attempt to exchange them. Supplying
the optional renewal secret with `INSTAGRAM_API_KIND=facebook` fails with an
explanation. If external renewal is unsupported, use a separately authorized app
or manually reconnect and replace the token.

## Maintenance

- Review failed scheduled runs and credential expiry.
- Keep dependencies current; the lockfile makes builds reproducible.
- GitHub Pages and standard GitHub-hosted Actions can be free for a public repo
  within GitHub's service limits; domain registration remains separate.
- Daily cached-image updates add Git history. Keep the feed small; revisit storage
  if posting volume grows significantly.
- `scripts/import-wordpress.py` is a one-time migration utility. Rerunning it
  overwrites the imported branding assets and feed snapshot. It is not part of builds.

The original photographs, artwork and font are carried over from the band's site;
their existing ownership/licensing continues to apply.
