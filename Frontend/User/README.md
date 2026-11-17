# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Ads (AdSense)

Ads are **off by default** and are build-time settings (Vite inlines `VITE_*`). To enable them on the VPS:

1. Add these to the root `.env`:
   ```dotenv
   VITE_ADS_ENABLED=true
   VITE_ADSENSE_CLIENT=ca-pub-8501048347195882
   VITE_ADSENSE_SLOT_HOME=<home slot id>
   VITE_ADSENSE_SLOT_MATCH=<match slot id>
   VITE_ADSENSE_SLOT_TEAM=<team slot id>
   VITE_ADSENSE_SLOT_LIST=<list slot id>
   VITE_ADSENSE_TEST=false
   ```
2. Rebuild/recreate the user frontend: `docker compose up -d --build user-frontend`.
   The values are declared as `ARG`/`ENV` in `Dockerfile`, passed as build args in
   `docker-compose.yml`, and listed in both `.env.example` files. A running
   container does not re-read them.
3. For test ads without real impressions, set `VITE_ADSENSE_TEST=true` before the
   same rebuild. This adds `data-adtest="on"` to the ad unit. **Never click your
   own ads** — clicks from the publisher are invalid and can get the account
   banned.

Placements are centralised in `src/components/ads/placements.js` (allowlist,
denylist and slot mapping). Render `<AdSlot />` only at the safe positions
described there; the shared route-level slot lives in `src/App.jsx`. Unfilled or
blocked units collapse to nothing, and a unit is pushed only once per mount.

### Consent and privacy

We do **not** render a custom cookie banner. Google's AdSense "Privacy &
messaging" CMP is enabled from the AdSense dashboard and is free to render.
The ad script is injected with the standard `async` tag only after `window.load`
during browser idle time, so it never blocks the consent message or first paint.
The Privacy Policy at `/privacy` explains cookies/AdSense, links to
https://adssettings.google.com, and covers account/match data.

### AdSense site verification

`public/ads.txt` contains the real publisher line and the built `index.html`
contains a static `<meta name="google-adsense-account" content="ca-pub-...">`
whenever `VITE_ADSENSE_CLIENT` is set, even if ads are disabled. The meta tag
loads no script and has no performance cost. In AdSense, choose **Verify** using
the meta tag. `public/serve.json` serves both `ads.txt` and `robots.txt` as
`text/plain` with `max-age=3600` (robots allows `Mediapartners-Google`).

### Security headers

The User app/Nginx config has **no CSP** today. If you add one on the VPS, allow
these hosts or ads and the consent message will be blocked:

- `script-src`: `https://pagead2.googlesyndication.com https://fundingchoicesmessages.google.com`
- `connect-src`: `https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://tpc.googlesyndication.com`
- `img-src`: `https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://tpc.googlesyndication.com`
- `frame-src`: `https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://fundingchoicesmessages.google.com`
- `style-src`: `'unsafe-inline'` (AdSense injects inline styles)

`src/sw.js` treats those ad hosts as `NetworkOnly` and never precaches them;
the offline page renders no ads.
