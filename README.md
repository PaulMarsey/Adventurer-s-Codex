# The Adventurer’s Codex

A private tabletop workspace for players. Switch campaigns and characters, open the session at the table, capture private notes, keep a character journal, and file text and link handouts already received from the GM.

## Run locally

Use Node 22.13 or newer. Run the locked dependency install and build before applying the first local D1 migration.

~~~sh
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_broad_vertigo.sql
npm run dev
~~~

Open the local URL printed by Vite and use its local sign-in. Apply the migration once per local database. Load the fictional Lantern Coast example from Campaigns to try a complete session.

~~~sh
node tests/player.cjs
~~~

## Hosting and data

The hosted instance uses owner-only Site access and the existing server-validated sign-in identity. Campaign and journal records live in D1, scoped to that identity. The repo contains source and a fictional example. Real campaign records are stored by the private deployment.

The player endpoint uses an explicit projection for campaigns, characters, sessions, notes, journal entries and received handouts. Session preparation and unreleased handouts are excluded from that endpoint. Entries can link to sessions and characters within their own campaign. Future GM delivery and display clients can build on these identifiers and a dedicated visibility-checked projection.

Deployment uses a verified GitHub source snapshot. Host identity and any instance-specific companion routes are configured at the private host.
