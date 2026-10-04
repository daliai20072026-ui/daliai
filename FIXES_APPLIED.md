# Dali AI bug fixes

- Fixed the over-escaped stored-file parser regex in `chat.js`.
- Restored the missing `modeBadge` element expected by the chat UI.
- Bumped the service-worker cache and frontend asset versions to invalidate stale client assets.
- Updated the Flask CSP to allow the Font Awesome assets used by `Features.html`.
- Allowed same-origin requests in the production origin check, preventing false 403 responses on Vercel-hosted origins.
- Removed duplicate `api/server.py` / `api/index.py` backend copies and the obsolete rewrite config so the project uses the root `server.py` Flask app recognized by Vercel.
- Pinned the Vercel Python runtime to 3.13 via `.python-version`.
- Corrected the homepage GitHub link to the Dali AI repository.

## Verification

- `node --check chat.js` — passed
- `node --check sw.js` — passed
- `python -m py_compile server.py` — passed
- HTML duplicate-ID check — passed
- JS-to-HTML ID check — passed
- Local asset existence check — passed

## Environment limitation

`pip install -r requirements.txt` could not reach the package index in the execution environment because outbound DNS/network access is unavailable. The Python dependency imports therefore could not be executed here.
- Fixed the Vercel HTTP 405 API deployment issue by adding a root `app.py` WSGI/Flask entrypoint. The frontend continues to POST to `/api/chat`, which is handled directly by the Flask app instead of the removed `/api/server.py` rewrite.
- Added `.python-version` with Python 3.13 for a consistent Vercel runtime.

## Additional fixes for the `daliai` repository

- Added `logo.png` as a browser-friendly 256x256 logo while keeping `logo.ico` as the favicon.
- Added CDN-served copies of the image assets under `public/` for Vercel.
- Updated all page/chat image references to `/logo.png` and `/sed.png`.
- Allowed HTTPS image sources in the Content-Security-Policy so remote AI/Markdown images can render.
- Fixed an image preview edge case by using `about:blank` instead of an empty `img src`.
- Added a preview-image error handler for unreadable browser image data.
- Fixed duplicate insertion of each history item in `chat.js`.
- Updated the service-worker cache version so older broken assets are invalidated.
- Updated the homepage GitHub link to `https://github.com/daliai20072026-ui/daliai`.
