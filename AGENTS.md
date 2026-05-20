# FPContentManager Agent Notes

## Architecture Rules

- `fpcontent-loader.js` is the only loader source of truth.
- `fpcontent-manager.js` is the payload only. Do not embed a second copy of the loader inside it.
- Loader and payload must remain separate scripts.
- The landing page bookmarklet must be generated from `fpcontent-loader.js`, not from inline loader code duplicated elsewhere.

## Release Rules

- Bump `Config.VERSION` in `fpcontent-manager.js` and `package.json` for every behavior change.
- After each production deploy, run Facebook Sharing Debugger scrape for:
  - `https://fpcontent.pages.dev/fpcontent/latest/manifest.html`
  - every `https://fpcontent.pages.dev/fpcontent/latest/og/chunk-*.html`
- Perform release scrape through a Dolphin Anty profile logged into Facebook Ads Manager.

## Hygiene

- If loader behavior changes, verify there is only one implementation in the repo.
- If payload behavior changes, do not touch bookmarklet generation unless loader behavior truly changed.
