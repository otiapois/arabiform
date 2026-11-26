# Cloudflare Pages release and seven-day validation

Record the release commit and the preview and production origins when they are available. This checklist starts with the synthetic sample and uses manual feedback to assess whether people can finish a batch.

## Before deployment

- [ ] From the ArabiForm repository root, use Node 24 and Python 3.13. Install with `npm ci --ignore-scripts` and `python -m pip install PyMuPDF==1.26.7`. On the release commit, run `npm run typecheck`, `npm test`, `npm run test:fuzz` (at least 4,000 seeded cases), `npm run verify:pixels`, `npm run build`, and `npm run test:e2e` with Microsoft Edge installed. Confirm the 4× pixel check covers the Arabic dropdown, radio states and editable-versus-flattened ZIP output for the M4 fixture. [Local verification commands](../../README.md#run-and-verify-locally)
- [ ] Set `SITE_URL` to the intended public HTTPS origin for the release build, with no path, query string or fragment. Verify that `dist/` has exactly the five HTML documents below. Check unique titles and descriptions, canonical URLs, JSON-LD, `dist/sitemap.xml`, `dist/robots.txt`, and the absence of named form elements. The Arabic page must have `lang="ar" dir="rtl"`; the English pages must have `lang="en"`. Confirm the `.example` fallback is absent from release metadata.
- [ ] Check the `/*` rule in `dist/_headers` for `Content-Security-Policy` with `connect-src 'none'`, `worker-src 'self'` and `form-action 'none'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Confirm local font assets, the PDF.js worker, the batch worker, synthetic assets and license notices are in the build. [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)

## Cloudflare Pages settings

Use an approved Git integration for the ArabiForm repository. Confirm the intended production target and deployment controls before saving configuration because changes on the selected production branch can trigger a deployment. For an existing project, use a preview deployment to verify the candidate first. Preview deployments are public by default. Use synthetic or public blank fixtures for all hosted checks. [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/) · [Preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | Repository root, left blank in Pages for the standalone ArabiForm repository |
| Framework preset | React (Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | `24.22.1`, the Node version used in the local baseline verification |
| `SITE_URL` | Stable public HTTPS origin, such as an assigned `*.pages.dev` hostname or the chosen custom domain. Set it explicitly in the Production build environment and use the same canonical origin in Preview. |

Keep the site as static Pages assets. `_headers` applies to static responses, so route HTML and assets through Pages' static delivery. Leave Web Analytics and third-party script injection disabled. Review the deployment log and check that the deployed commit matches the release commit. [Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Build image and Node selection](https://developers.cloudflare.com/pages/configuration/build-image/) · [Static header scope](https://developers.cloudflare.com/pages/configuration/headers/)

## Hosted acceptance

1. Fetch all five routes by their direct URLs on the preview and again on the production origin after an authorized release. Follow any redirect and check that the final `200` response has the correct page title and expected CSP. Check the final path and canonical separately. Pages can serve the root page for a missing route, so status alone is insufficient. Check the headers on worker scripts as well. [Cloudflare Pages route matching](https://developers.cloudflare.com/pages/configuration/serving-pages/)

   ```sh
   origin='https://forms.example.org' # Replace with the deployed origin.
   for route in / /arabic-pdf-form-filler /ar/pdf-mail-merge /preserve-leading-zeros-pdf /privacy-and-proof
   do
     curl -fsSL -D - -o /dev/null -w 'Final URL: %{url_effective}\n' "$origin$route" || exit 1
   done
   curl -fsS "$origin/sitemap.xml"
   curl -fsS "$origin/robots.txt"
   ```

2. Confirm sitemap entries and the `robots.txt` sitemap link point to `SITE_URL` and that the sitemap lists only those routes. For Preview, check `X-Robots-Tag: noindex`; for public Production, check that this preview directive is absent. [Preview indexing behavior](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
3. In a clean desktop Edge session and on a phone, open DevTools or a remote network inspector before loading the English and Arabic workbenches. Any requests for scripts, fonts, workers and bundled samples should go to the same origin. With the network log open, select local files, preview rows and exercise all export options. Confirm no external requests, no transmission of selected file contents, no console errors and no horizontal scrolling at mobile width. Try a same-origin `fetch` from the console separately and confirm CSP blocks it. Native Arabic review should cover connected letters, diacritics, dropdown labels and the visual position of `.pdf` in a mixed-script filename.
4. Use the two-page M4 synthetic form and a fictitious roster. Map text, checkbox, dropdown and radio fields. Try the exact Arabic dropdown label and an export value where it differs. Enter an invalid dropdown value on a second-page field, select the flagged row, and confirm the preview opens that page and highlights the field. Use the **Page N** button and choose a valid alternative in the inline editor. Confirm the row is Ready and the selected value appears in the preview.
5. Export the corrected batch three ways. The default ZIP should contain one editable PDF per ready row, with mapped selections and the original values and appearances of unmapped controls. Switch on **Flatten individual PDFs in ZIP (lock fields for print/mobile sharing)** to check that the separate files preserve the visible selections and contain zero interactive form widgets. Check page order in the merged printable PDF. Export and import a local JSON preset with flattening enabled, then import a legacy version 1 preset and confirm that ZIP is editable again. [Export and preset instructions](../../README.md)
6. Test one custom font that covers the sample and one that lacks required glyphs. Open the flattened copy in the viewer or sharing app recipients will use and print one test page on the intended print path. Record device, app, version and result for any iOS, macOS Preview, WhatsApp or print check. `Print-locked` describes the removal of interactive form controls. The resulting file remains an ordinary PDF that can be modified with PDF-editing tools. Report results only for combinations tested. If a required check fails, hold the release or roll back to the previous accepted production deployment if available. Retest before releasing the fix. [Cloudflare Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)

## Seven days of direct validation

Start when an approved URL is available. The suggested target is three completed first-use sessions across at least two workflows. Use volunteers or a channel where trying the demo is permitted. Keep only anonymous notes outside the app, and ask participants to use the synthetic sample, public blank forms or redacted copies with fictitious rows. Record the commit, scenario, device, completion, assistance needed, first blocker, and whether the person would use it again for a specific batch. Use a denominator for every count and record missing evidence as pending.

| Day | Task and evidence |
| --- | --- |
| 1 | Run the hosted acceptance checks. Record the commit, URL, response headers, checked devices, and which scenarios passed or failed. Save a baseline screenshot using synthetic data. |
| 2 | After approval, share the synthetic demo with relevant people who prepare rosters, badges or forms. Ask each person to locate the demo, correct a flagged row, and export a PDF. Record actual replies and observed sessions. [Bilingual synthetic demo](demo-walkthrough.md) |
| 3 | Observe a first-use session in Arabic and one in English if volunteers are available. Note where participants stop, especially field mapping, warning text, filename reading and export. Record any step completed with help. |
| 4 | Try a second workflow using a public blank or synthetic mixed-field form. Check an unmapped control in the editable PDF, the flattened copy from the ZIP and the merged print copy. Record the font, PDF viewer and result for each sample. |
| 5 | Reproduce the most frequent blocker with a synthetic input. Prioritize wrong field values, lost text, unexpected outgoing requests or unusable print output. Record a reproduction and retest any fix on both locales. |
| 6 | Ask prior testers whether they have a specific upcoming batch and what they currently do to prepare it. Record concrete requests, a repeat attempt if observed, and any differences between intended and actual use. |
| 7 | Review attempted and completed sessions, workflow coverage, repeat intent, and open blockers. Continue a small trial once the hosted and correctness checks pass and the session target is met. Extend testing when evidence is thin. Pause on a reproducible privacy leak, wrong PDF value or incorrect print output until verified fixed. |

Use counts from observed sessions and descriptions of the tested configurations in any public updates. Keep validation outside the runtime and keep the existing five routes during the trial.
