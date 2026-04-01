# AVS AUTH Production Runbook

This document is the end-to-end checklist for taking this repository from local development to a real production launch.

It covers:

- Cloudflare Workers backend deployment
- Convex production deployment
- Vercel frontend deployment
- Google OAuth setup
- npm package publishing
- release readiness, security, and compliance steps

This runbook is written for the current repo layout:

- `services/edge-gateway` = Cloudflare Worker backend
- `services/convex` = Convex data layer
- `apps/website` = public website
- `apps/docs` = docs site
- `packages/auth`
- `packages/react`
- `packages/types`
- `packages/oidc-core`

## 1. Target Production Architecture

Recommended production topology:

- `auth.adityavs.tech` -> Cloudflare Worker in `services/edge-gateway`
- `adityavs.tech` or `www.adityavs.tech` -> Vercel project for `apps/website`
- `docs.auth.adityavs.tech` or `docs.adityavs.tech` -> Vercel project for `apps/docs`
- Convex production deployment -> database, durable sessions, consents, codes, pairwise subjects, signing keys

Recommended DNS ownership model:

- Keep DNS in Cloudflare.
- Point the Worker hostname directly through Cloudflare Workers Custom Domain.
- Point website and docs hostnames to Vercel using the exact DNS records Vercel asks for.

## 2. Accounts You Need

Create and secure these accounts first:

- GitHub organization or personal account for the repo
- Cloudflare account with the domain zone added
- Convex account and project
- Vercel account/team
- Google Cloud project for OAuth
- npm account and, if needed, npm organization

Enable strong security on all of them:

- Turn on 2FA everywhere
- Use a password manager
- Limit production access to the smallest team possible

## 3. Domain Plan

Choose the final public URLs before launch. Do not improvise these later.

Recommended values:

- Marketing website: `https://adityavs.tech`
- Broker backend: `https://auth.adityavs.tech`
- Docs: `https://docs.auth.adityavs.tech`

If you change these, update all of the following:

- Cloudflare Worker `ISSUER`
- Worker `DOCS_BASE_URL`
- Google OAuth homepage/privacy/redirect configuration
- website links
- docs links
- any npm README examples

## 4. Repo Cleanup Before Launch

Do this before deployment:

1. Clean the worktree.
2. Commit the production-ready state.
3. Tag a release candidate.
4. Make sure no local-only files or secrets are tracked.

Required checks:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Current repo note:

- The codebase currently builds and tests successfully.
- Before launch, you should still make a clean release commit and deploy from that commit.

## 5. Cloudflare Worker Backend Setup

The Worker config lives in:

- `services/edge-gateway/wrangler.toml`

### 5.1 Install Wrangler

Cloudflare recommends using Wrangler locally in the project.

From the repo root or inside `services/edge-gateway`:

```bash
pnpm add -D wrangler@latest
```

Then authenticate:

```bash
npx wrangler login
```

### 5.2 Production values to set

`services/edge-gateway/wrangler.toml` is already converted into a production-safe template.

You only need to replace the remaining non-secret placeholders.

Set these non-secret vars:

- `ISSUER=https://auth.adityavs.tech`
- `ENVIRONMENT=production`
- `DOCS_BASE_URL=https://docs.auth.adityavs.tech`
- `CONVEX_URL=<your convex deployment url>`
- `GOOGLE_CLIENT_ID=<your google client id>`
- `GOOGLE_REDIRECT_URI=https://auth.adityavs.tech/auth/google/callback`

Set these as secrets, not committed config:

- `CONVEX_ADMIN_KEY`
- `GOOGLE_CLIENT_SECRET`
- `PAIRWISE_SECRET`
- `ADMIN_SECRET`

By default, the repo template keeps `GOOGLE_CLIENT_ID` in `[vars]`. If you prefer, you can also move it to a Cloudflare secret.

### 5.3 Set secrets

From `services/edge-gateway`:

```bash
pnpm dlx wrangler@latest secret put CONVEX_ADMIN_KEY
pnpm dlx wrangler@latest secret put GOOGLE_CLIENT_SECRET
pnpm dlx wrangler@latest secret put PAIRWISE_SECRET
pnpm dlx wrangler@latest secret put ADMIN_SECRET
```

If you also want `GOOGLE_CLIENT_ID` as a secret:

```bash
pnpm dlx wrangler@latest secret put GOOGLE_CLIENT_ID
```

### 5.4 Deploy the Worker

From `services/edge-gateway`:

```bash
pnpm dlx wrangler@latest deploy
```

### 5.5 Attach the Custom Domain

In Cloudflare:

1. Open Workers & Pages.
2. Select the deployed Worker.
3. Go to Settings -> Domains & Routes.
4. Add Custom Domain.
5. Enter `auth.adityavs.tech`.

Cloudflare will provision DNS and certificates for the Worker custom domain.

### 5.6 Post-deploy backend smoke tests

Verify:

- `https://auth.adityavs.tech/`
- `https://auth.adityavs.tech/sign-in`
- `https://auth.adityavs.tech/me`
- `https://auth.adityavs.tech/.well-known/openid-configuration`
- `https://auth.adityavs.tech/.well-known/jwks.json`
- `https://auth.adityavs.tech/avs-auth.js`

## 6. Convex Production Setup

Convex is your durable production data layer.

### 6.1 Create the Convex project

From `services/convex`:

```bash
npx convex dev
```

This creates or links a Convex project and a development deployment.

### 6.2 Create the production deployment

In Convex dashboard:

1. Open the project.
2. Create or confirm the production deployment exists.
3. Copy the production deployment URL.
4. Generate a production deploy key.

You need both:

- production deployment URL
- production deploy key

### 6.3 Set Convex environment variables

Set production deployment variables in Convex dashboard or CLI.

Useful commands:

```bash
npx convex env list --prod
npx convex env set NAME value --prod
npx convex env get NAME --prod
```

Only add variables your Convex functions actually need.

### 6.4 Deploy Convex to production

Manual production deploy:

```bash
npx convex deploy
```

CI-friendly deploy:

```bash
CONVEX_DEPLOY_KEY=your_key npx convex deploy
```

### 6.5 Backups and operations

In Convex dashboard, configure:

- backup/restore
- production deployment settings
- access control for team members

Do not skip backups before going live.

## 7. Google OAuth Setup

The code already implements the server-side Google OAuth code exchange in the Worker.

Current code path:

- `/auth/google/start`
- `/auth/google/callback`

Current scopes requested by the code:

- `openid`
- `email`
- `profile`

Inference:

- For the current implementation, you are using the standard web server OAuth flow for basic identity.
- Do not add extra Google API scopes unless you actually need them.
- If you later request sensitive or restricted scopes, Google verification requirements increase significantly.

### 7.1 Create the Google Cloud project

In Google Cloud:

1. Create a new project.
2. Enable the APIs required for your auth setup.
3. Go to Google Auth Platform / OAuth configuration.

### 7.2 Configure the OAuth consent screen

Use consistent production identity:

- App name: `AVS AUTH`
- Support email: your production support email
- App homepage: use a public page that accurately describes the app
- Privacy policy: public URL
- Terms of service: public URL if you have one

Important:

- All domains used in homepage, privacy policy, terms, redirect URIs, or JS origins should be domains you own.
- The safest choice is to keep the OAuth app homepage and legal URLs on the same production domain family.

Practical recommendation for this repo:

- Homepage for Google consent: `https://auth.adityavs.tech/`
- Privacy policy: `https://auth.adityavs.tech/privacy`
- Terms: `https://auth.adityavs.tech/terms`

This aligns the consent screen with the actual auth broker domain.

### 7.3 Configure test users

Before public launch:

1. Keep the app in Testing mode.
2. Add your own Google account and any teammates as test users.
3. Test the entire login flow end to end.

### 7.4 Verify domain ownership

Google requires domain ownership verification for OAuth-related domains.

Recommended approach:

- Add a Search Console Domain Property for `adityavs.tech`

That covers subdomains such as:

- `auth.adityavs.tech`
- `docs.auth.adityavs.tech`

### 7.5 Create the OAuth client

Create a client of type:

- `Web application`

Add this exact Authorized redirect URI:

```text
https://auth.adityavs.tech/auth/google/callback
```

Use exact matching. Any mismatch causes `redirect_uri_mismatch`.

### 7.6 Save the credentials

You will receive:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Important:

- Store the client secret securely.
- Google only shows the client secret at creation time.

### 7.7 Put Google values into production

Worker values:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://auth.adityavs.tech/auth/google/callback`

### 7.8 Do you need to manually get Google tokens?

For the current AVS AUTH product, no manual token handling is required for launch.

Your Worker already does the normal OAuth server-side flow:

1. redirect user to Google
2. receive authorization code
3. exchange code server-side
4. read user profile data
5. create AVS broker session

You do not need to manually fetch or copy a Google access token for the current broker product.

You only need long-lived Google refresh tokens if you later want background access to Google APIs on a user's behalf. That is a different product scope and should not be added casually.

### 7.9 Google verification and compliance notes

For the current `openid email profile` usage:

- keep branding correct
- keep homepage/privacy URLs public and accurate
- request only the scopes you actually need

If you later add sensitive or restricted scopes:

- expect Google verification
- expect scope justification
- expect domain ownership checks
- expect video demo and policy review

## 8. Vercel Frontend Setup

You asked for frontend hosting on Vercel.

Recommended split:

- Project 1: `apps/website`
- Project 2: `apps/docs`

### 8.1 Website project

`apps/website` is an Astro static site.

Build settings:

- Framework preset: Astro
- Root directory: `apps/website`
- Build command: default Astro build is fine
- Output directory: handled automatically by Vercel for Astro static builds

You can import via Vercel UI or CLI.

CLI flow:

```bash
cd apps/website
vercel
```

For production:

```bash
vercel --prod
```

### 8.2 Docs project

`apps/docs` is a separate static app built by `node build.js`.

Suggested Vercel settings:

- Root directory: `apps/docs`
- Build command: `node build.js`
- Output directory: `dist`

### 8.3 Custom domains on Vercel

Recommended:

- website -> `adityavs.tech` or `www.adityavs.tech`
- docs -> `docs.auth.adityavs.tech`

If you keep DNS in Cloudflare:

1. Add the domain to the Vercel project.
2. Run or inspect the exact DNS records Vercel requires.
3. Add those DNS records in Cloudflare DNS.
4. Wait for Vercel verification and TLS issuance.

### 8.4 Vercel environment variables

Set any required environment variables in Vercel project settings.

Changes require redeploy.

Current repo note:

- `apps/website` currently builds.
- `apps/website` typecheck asks for `@astrojs/check`.

Recommended fix:

```bash
cd apps/website
pnpm add -D @astrojs/check typescript
```

## 9. Cloudflare DNS Plan

If Cloudflare is your DNS provider:

- `auth.adityavs.tech` -> Cloudflare Worker Custom Domain
- `adityavs.tech` -> Vercel A/CNAME record as instructed by Vercel
- `www.adityavs.tech` -> Vercel CNAME
- `docs.auth.adityavs.tech` -> Vercel CNAME

Do not create conflicting DNS for the Worker hostname. Cloudflare Worker Custom Domains manage their own DNS path.

## 10. npm Package Publishing

Packages in this repo:

- `@avs-auth/auth`
- `@avs-auth/react`
- `@avs-auth/types`
- `@avs-auth/oidc-core`

Decide explicitly which packages are public.

Recommended public packages:

- `@avs-auth/auth`
- `@avs-auth/react`
- `@avs-auth/types`

Optional public package:

- `@avs-auth/oidc-core` only if you want to support it as a real public API

### 10.1 Before first publish

Each public package should have:

- stable name
- `version`
- `description`
- `license`
- `repository`
- `homepage`
- `bugs`
- `files` or a clean publish surface
- README

Recommended `publishConfig` for public packages:

```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

### 10.2 Pre-publish safety checks

For each package:

```bash
pnpm --filter @avs-auth/types build
pnpm --filter @avs-auth/types test
pnpm --filter @avs-auth/types pack --dry-run
```

Repeat for:

- `@avs-auth/auth`
- `@avs-auth/react`
- `@avs-auth/oidc-core` if publishing it

Also inspect the package tarball contents:

```bash
npm pack --dry-run
```

Make sure you are not publishing:

- secrets
- local config files
- screenshots
- private internal notes
- unnecessary test fixtures

### 10.3 npm account security

Before publishing:

- enable npm 2FA
- use an npm organization if publishing under an org scope
- decide whether to publish manually or via CI

### 10.4 First manual publish

From each package directory:

```bash
npm login
npm publish --access public
```

Scoped public packages require `--access public` on first publish.

### 10.5 Recommended publish model: trusted publishing

Recommended production model:

- publish from GitHub Actions using npm trusted publishing
- enable provenance
- disallow long-lived publish tokens once working

Benefits:

- better supply-chain security
- provenance on published packages
- fewer token management problems

### 10.6 Suggested release order

Recommended dependency order:

1. `@avs-auth/types`
2. `@avs-auth/oidc-core` if public
3. `@avs-auth/auth`
4. `@avs-auth/react`

Then update docs examples to the published versions.

## 11. Environment Variable Matrix

### 11.1 Cloudflare Worker production

Non-secret:

- `ISSUER=https://auth.adityavs.tech`
- `ENVIRONMENT=production`
- `DOCS_BASE_URL=https://docs.auth.adityavs.tech`
- `CONVEX_URL=<production convex url>`
- `GOOGLE_REDIRECT_URI=https://auth.adityavs.tech/auth/google/callback`
- `GOOGLE_CLIENT_ID=<client id>`

Secret:

- `GOOGLE_CLIENT_SECRET`
- `CONVEX_ADMIN_KEY`
- `PAIRWISE_SECRET`
- `ADMIN_SECRET`

### 11.2 Convex production

Only set the variables your Convex code truly needs.

Keep production and development values separate.

### 11.3 Vercel website and docs

Set only what those apps actually read.

If you add environment variables later:

- set them in Vercel
- redeploy

## 12. Security and Compliance Checklist

Before launch, confirm all of this:

- HTTPS everywhere
- production secrets not committed to git
- Cloudflare Worker secrets stored via secrets, not plain vars where sensitive
- Pairwise secret rotated from the dev placeholder
- Google OAuth client restricted to owned domains and exact redirect URI
- public homepage and privacy policy are live
- npm 2FA enabled
- package publish access reviewed
- admin secret configured
- backups enabled in Convex
- production team access reviewed in Cloudflare, Convex, Vercel, npm, Google Cloud
- no sensitive data published in npm tarballs
- release branch and rollback strategy documented

## 13. Launch Checklist

Run this in order.

### Phase A: Identity and domains

1. Finalize production hostnames.
2. Add the domain to Cloudflare.
3. Verify `adityavs.tech` in Google Search Console.
4. Configure Google consent screen branding.
5. Create the Google OAuth web client.

### Phase B: Database and backend

1. Create Convex production deployment.
2. Generate Convex production deploy key.
3. Set Convex production env vars.
4. Configure Worker production vars and secrets.
5. Deploy the Worker.
6. Attach `auth.adityavs.tech` as a Cloudflare Worker custom domain.

### Phase C: Frontend

1. Create Vercel project for `apps/website`.
2. Create Vercel project for `apps/docs`.
3. Attach the production domains.
4. Add required DNS records in Cloudflare.
5. Confirm TLS is active and sites load correctly.

### Phase D: npm

1. Add package metadata fields.
2. Confirm package names are final.
3. Run `pack --dry-run`.
4. Publish public packages.
5. Verify install from a clean test project.

### Phase E: Production smoke test

1. Open `https://auth.adityavs.tech/`
2. Click sign-in
3. Complete Google auth
4. Confirm `/me` works
5. Confirm authorized sites page works
6. Confirm a relying-party app can sign in
7. Confirm fast repeat auth works
8. Confirm revoke site works
9. Confirm logout works
10. Confirm delete account works

## 14. Post-launch Operations

After launch:

- monitor Cloudflare Worker errors
- monitor Convex deployment health
- watch Google OAuth errors
- watch npm package install issues
- keep a rollback commit/tag ready
- rotate secrets if anything was ever exposed during setup

Recommended recurring tasks:

- monthly access review
- quarterly secret rotation
- periodic backup restore drill
- versioned release notes for npm packages

## 15. Exact Repo-Specific Ordered Launch Procedure

This is the exact order to take this repo live.

### 15.1 One-time repo fixes before production

1. Install the Astro checker so `apps/website` typecheck is real instead of prompting.
2. Add package metadata before publishing public npm packages.
3. Make a clean release commit before you deploy anything.

Commands:

```bash
cd D:\AVS_AUTH
pnpm --filter @avs-auth/website add -D @astrojs/check
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Before npm publish, add these fields to each public package:

- `packages/types/package.json`
- `packages/oidc-core/package.json`
- `packages/auth/package.json`
- `packages/react/package.json`

Add at minimum:

- `license`
- `repository`
- `homepage`
- `bugs`
- `keywords`
- `files`
- `publishConfig`

Recommended shape:

```json
{
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/<your-org>/<your-repo>.git"
  },
  "homepage": "https://adityavs.tech",
  "bugs": {
    "url": "https://github.com/<your-org>/<your-repo>/issues"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "publishConfig": {
    "access": "public"
  }
}
```

Also add a real `LICENSE` file at repo root before publishing anything.

### 15.2 Lock the production URLs

Use these final URLs everywhere:

- website: `https://adityavs.tech`
- broker: `https://auth.adityavs.tech`
- docs: `https://docs.auth.adityavs.tech`

These values must stay consistent across Cloudflare, Convex, Google, Vercel, README examples, and package docs.

### 15.3 Create the Convex production deployment first

This repo expects the Worker to talk to Convex through:

- `CONVEX_URL`
- `CONVEX_ADMIN_KEY`

Commands:

```bash
cd D:\AVS_AUTH\services\convex
pnpm exec convex dev
pnpm exec convex deploy
pnpm exec convex env list --prod
```

What to do in the Convex dashboard:

1. Open the linked project.
2. Confirm the production deployment exists.
3. Copy the production deployment URL.
4. Generate a production deploy key.
5. Generate or copy the production admin key if you are using Convex admin calls from the Worker.

Save these values:

- `CONVEX_URL=<your production convex url>`
- `CONVEX_ADMIN_KEY=<your production convex admin key>`
- `CONVEX_DEPLOY_KEY=<your production convex deploy key>`

### 15.4 Create the Google OAuth app

This repo already performs the OAuth code exchange server-side inside the Worker. You do not manually generate user tokens.

In Google Cloud, create a Web application OAuth client with these exact values:

- App name: `AVS AUTH`
- Home page: `https://adityavs.tech`
- Privacy policy: `https://auth.adityavs.tech/privacy`
- Terms of service: `https://auth.adityavs.tech/terms`
- Authorized redirect URI: `https://auth.adityavs.tech/auth/google/callback`

Save these values:

- `GOOGLE_CLIENT_ID=<google oauth client id>`
- `GOOGLE_CLIENT_SECRET=<google oauth client secret>`
- `GOOGLE_REDIRECT_URI=https://auth.adityavs.tech/auth/google/callback`

If the app is still in Google testing mode, add your own Google account as a test user before first production sign-in.

### 15.5 Update `wrangler.toml` with the real non-secret production values

`services/edge-gateway/wrangler.toml` is already in the correct production-safe shape.

You do not need to restructure the file anymore.

You only need to replace the placeholder values in:

- `CONVEX_URL`
- `GOOGLE_CLIENT_ID`

The `[vars]` block should end up like this:

```toml
[vars]
ISSUER = "https://auth.adityavs.tech"
ENVIRONMENT = "production"
DOCS_BASE_URL = "https://docs.auth.adityavs.tech"
CONVEX_URL = "https://<your-production-convex-deployment>.convex.cloud"
GOOGLE_CLIENT_ID = "<your-google-client-id>"
GOOGLE_REDIRECT_URI = "https://auth.adityavs.tech/auth/google/callback"
```

Do not keep production secrets in `[vars]`.

These values should stay out of `wrangler.toml` and be set as Cloudflare secrets:

- `CONVEX_ADMIN_KEY`
- `GOOGLE_CLIENT_SECRET`
- `PAIRWISE_SECRET`
- `ADMIN_SECRET`

Generate the two app secrets like this:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use one generated value for `PAIRWISE_SECRET` and the other for `ADMIN_SECRET`.

Current repo status:

- `ENVIRONMENT` is already set to `production`
- the secret placeholders have already been removed from `wrangler.toml`
- the only remaining file edits are the real `CONVEX_URL` and `GOOGLE_CLIENT_ID`

### 15.6 Log into Cloudflare and set the Worker secrets

Commands:

```bash
cd D:\AVS_AUTH\services\edge-gateway
pnpm dlx wrangler@latest login
pnpm dlx wrangler@latest secret put CONVEX_ADMIN_KEY
pnpm dlx wrangler@latest secret put GOOGLE_CLIENT_SECRET
pnpm dlx wrangler@latest secret put PAIRWISE_SECRET
pnpm dlx wrangler@latest secret put ADMIN_SECRET
```

If you prefer to keep `GOOGLE_CLIENT_ID` out of git too, also run:

```bash
pnpm dlx wrangler@latest secret put GOOGLE_CLIENT_ID
```

### 15.7 Deploy Convex production, then deploy the Worker

Deploy Convex first:

```bash
cd D:\AVS_AUTH\services\convex
$env:CONVEX_DEPLOY_KEY="<your-convex-deploy-key>"
pnpm exec convex deploy
```

Then deploy the Worker:

```bash
cd D:\AVS_AUTH\services\edge-gateway
pnpm dlx wrangler@latest deploy
```

After the deploy finishes in Cloudflare:

1. Open the deployed Worker in Cloudflare Dashboard.
2. Go to `Settings -> Domains & Routes`.
3. Add the custom domain `auth.adityavs.tech`.

### 15.8 Create the Vercel website project

Use `apps/website` as its own Vercel project.

Vercel project settings:

- Root Directory: `apps/website`
- Framework Preset: `Astro`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: `dist`
- Production Branch: your main release branch

Commands:

```bash
cd D:\AVS_AUTH\apps\website
pnpm dlx vercel@latest link
pnpm dlx vercel@latest --prod
```

Then attach:

- `adityavs.tech`
- `www.adityavs.tech` if you want a `www` redirect

### 15.9 Create the Vercel docs project

Use `apps/docs` as a separate Vercel project.

Vercel project settings:

- Root Directory: `apps/docs`
- Framework Preset: `Other`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: `dist`
- Production Branch: your main release branch

Commands:

```bash
cd D:\AVS_AUTH\apps\docs
pnpm dlx vercel@latest link
pnpm dlx vercel@latest --prod
```

Then attach:

- `docs.auth.adityavs.tech`

### 15.10 Update DNS in Cloudflare

Final DNS shape:

- `auth.adityavs.tech` -> Cloudflare Worker Custom Domain
- `adityavs.tech` -> Vercel project records shown in the Vercel dashboard
- `www.adityavs.tech` -> Vercel or redirect target for website
- `docs.auth.adityavs.tech` -> Vercel project records shown in the Vercel dashboard

Do not guess the Vercel records. Use exactly what Vercel shows for each project.

### 15.11 Run the full production validation pass

Commands:

```bash
cd D:\AVS_AUTH
pnpm test
pnpm typecheck
pnpm build
```

Then manually verify all of these in a browser:

1. `https://adityavs.tech`
2. `https://adityavs.tech/docs`
3. `https://auth.adityavs.tech`
4. `https://auth.adityavs.tech/sign-in`
5. Sign in with Google.
6. Confirm you land on `https://auth.adityavs.tech/me`.
7. Confirm profile data loads.
8. Confirm `Refresh Profile` works.
9. Confirm `Sign Out` works.
10. Confirm `Delete My Data` works on a non-critical test account.
11. Confirm `https://auth.adityavs.tech/.well-known/openid-configuration` returns JSON.
12. Confirm `https://auth.adityavs.tech/.well-known/jwks.json` returns JSON.
13. Confirm `https://auth.adityavs.tech/avs-auth.js` loads successfully.

### 15.12 Publish the npm packages last

Do not publish packages before the hosted broker is live.

Packages that should be public:

1. `@avs-auth/types`
2. `@avs-auth/oidc-core`
3. `@avs-auth/auth`
4. `@avs-auth/react`

Packages that should stay private:

- `edge-gateway`
- `@avs-auth/convex`
- `@avs-auth/website`
- `docs`

Login and secure npm first:

```bash
npm login
npm whoami
```

Recommended:

- enable npm 2FA for auth-and-writes
- use trusted publishing later for CI releases

Build and dry-run all public packages:

```bash
cd D:\AVS_AUTH
pnpm --filter @avs-auth/types build
pnpm --filter @avs-auth/oidc-core build
pnpm --filter @avs-auth/auth build
pnpm --filter @avs-auth/react build

cd packages\types
npm pack --dry-run

cd ..\oidc-core
npm pack --dry-run

cd ..\auth
npm pack --dry-run

cd ..\react
npm pack --dry-run
```

First publish commands:

```bash
cd D:\AVS_AUTH\packages\types
npm publish --access public

cd D:\AVS_AUTH\packages\oidc-core
npm publish --access public

cd D:\AVS_AUTH\packages\auth
npm publish --access public

cd D:\AVS_AUTH\packages\react
npm publish --access public
```

For every later release:

1. bump versions first
2. rebuild
3. run `npm pack --dry-run`
4. publish in dependency order again

## 16. Copy-Paste Command Sequence

Use this as the shortest end-to-end command list.

### 16.1 Local validation

```bash
cd D:\AVS_AUTH
pnpm --filter @avs-auth/website add -D @astrojs/check
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

### 16.2 Convex

```bash
cd D:\AVS_AUTH\services\convex
pnpm exec convex dev
pnpm exec convex deploy
pnpm exec convex env list --prod
```

### 16.3 Cloudflare Worker secrets and deploy

```bash
cd D:\AVS_AUTH\services\edge-gateway
pnpm dlx wrangler@latest login
pnpm dlx wrangler@latest secret put CONVEX_ADMIN_KEY
pnpm dlx wrangler@latest secret put GOOGLE_CLIENT_SECRET
pnpm dlx wrangler@latest secret put PAIRWISE_SECRET
pnpm dlx wrangler@latest secret put ADMIN_SECRET
pnpm dlx wrangler@latest deploy
```

### 16.4 Vercel website

```bash
cd D:\AVS_AUTH\apps\website
pnpm dlx vercel@latest link
pnpm dlx vercel@latest --prod
```

### 16.5 Vercel docs

```bash
cd D:\AVS_AUTH\apps\docs
pnpm dlx vercel@latest link
pnpm dlx vercel@latest --prod
```

### 16.6 npm publish

```bash
cd D:\AVS_AUTH
pnpm --filter @avs-auth/types build
pnpm --filter @avs-auth/oidc-core build
pnpm --filter @avs-auth/auth build
pnpm --filter @avs-auth/react build

cd packages\types
npm pack --dry-run
npm publish --access public

cd ..\oidc-core
npm pack --dry-run
npm publish --access public

cd ..\auth
npm pack --dry-run
npm publish --access public

cd ..\react
npm pack --dry-run
npm publish --access public
```

## 17. Official References

Cloudflare:

- Wrangler install/update: https://developers.cloudflare.com/workers/wrangler/install-and-update/
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/
- Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Custom Domains for Workers: https://developers.cloudflare.com/workers/configuration/routing/custom-domains

Convex:

- Production overview: https://docs.convex.dev/production
- Project configuration: https://docs.convex.dev/production/project-configuration
- CLI: https://docs.convex.dev/cli
- Deploy keys: https://docs.convex.dev/cli/deploy-key-types
- Deployment settings: https://docs.convex.dev/dashboard/deployments/deployment-settings
- Vercel hosting guide: https://docs.convex.dev/production/hosting/vercel

Google:

- OAuth web server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- OAuth policies: https://developers.google.com/identity/protocols/oauth2/policies
- Production readiness and compliance: https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- Brand verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- Sensitive scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- OAuth scopes reference: https://developers.google.com/identity/protocols/oauth2/scopes
- OAuth best practices: https://developers.google.com/identity/protocols/oauth2/resources/best-practices

Vercel:

- Deploy Astro to Vercel: https://docs.astro.build/en/guides/deploy/vercel/
- Environment variables: https://vercel.com/docs/environment-variables
- Managing environment variables: https://vercel.com/docs/environment-variables/managing-environment-variables
- Add/configure domain: https://vercel.com/docs/concepts/projects/domains/add-a-domain
- Custom domain quick reference: https://vercel.com/docs/domains/set-up-custom-domain

npm:

- Scoped public packages: https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- npm 2FA: https://docs.npmjs.com/about-two-factor-authentication/
- Trusted publishing: https://docs.npmjs.com/trusted-publishers
- Provenance: https://docs.npmjs.com/generating-provenance-statements
- Require 2FA on package publishing: https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification
