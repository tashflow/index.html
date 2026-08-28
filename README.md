# Stak Suite

**StockStak** (inventory & POS) + **SweetStak** (pastry orders) — one static website.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Full app (open this / host this) |
| `netlify.toml` | Netlify publish settings |
| `README.md` | This file |

## Option A — GitHub Pages
1. Push this folder to a GitHub repo.
2. **Settings → Pages → Deploy from branch** → `main` → `/ (root)`.
3. Open `https://YOUR_USERNAME.github.io/REPO_NAME/`

## Option B — Netlify (from GitHub)
1. Push this folder to GitHub.
2. [Netlify](https://app.netlify.com) → **Add new site → Import an existing project**.
3. Connect GitHub → select this repo.
4. Build settings: leave **build command empty**, publish directory `.` (or auto from `netlify.toml`).
5. Deploy — you get a URL like `https://something.netlify.app`.

## Updating the site
1. Replace `index.html` with the new version.
2. Commit & push to GitHub.
3. GitHub Pages / Netlify redeploy automatically.
4. **Data is safe**: localStorage (per browser) + Firebase (`stak-suite`) are not wiped by a deploy.

## Firebase
Config is embedded for project `stak-suite`. Enable **Firestore** in Firebase Console for cloud sync.
Use the **Cloud** button in StockStak / SweetStak.
