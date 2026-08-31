# Blueprint — setup

## 1. Put this on GitHub Pages (free hosting)

1. Go to github.com and create a **new repository** (e.g. `blueprint-calendar`). Keep it Public or Private — either works with Pages.
2. Upload every file in this folder to that repo, keeping the folder structure (`js/` and `icons/` as subfolders). Easiest way: on the repo page, click **Add file → Upload files**, drag in everything, then **Commit changes**.
3. In the repo, go to **Settings → Pages**.
4. Under "Build and deployment", set **Source** to `Deploy from a branch`, **Branch** to `main` and folder `/ (root)`, then **Save**.
5. Wait ~1 minute, refresh the page — it'll show your live URL (something like `https://yourusername.github.io/blueprint-calendar/`). Open it.

## 2. Create a second repo to hold your schedule data

This keeps your task data separate from the app code, so you can update the app later without touching your data.

1. Create **another** new repo — e.g. `blueprint-data`. Keep it **Private** (your schedule shouldn't be public).
2. That's it for this step — no files needed, the app creates the data file itself.

## 3. Create a GitHub personal access token

1. In GitHub, click your profile photo (top right) → **Settings**.
2. Scroll to **Developer settings** (bottom of left sidebar).
3. Click **Personal access tokens → Fine-grained tokens → Generate new token**.
4. Give it a name (e.g. "Blueprint calendar"), set an expiry (or "No expiration").
5. Under **Repository access**, choose **Only select repositories** and pick `blueprint-data` (the repo from step 2).
6. Under **Permissions → Repository permissions**, find **Contents** and set it to **Read and write**.
7. Click **Generate token**, then **copy the token immediately** — GitHub only shows it once.

## 4. Connect the app to your data repo

1. Open your live Blueprint URL from step 1.
2. Click the **⚙ Settings** icon (top right).
3. Fill in:
   - **Repo owner**: your GitHub username
   - **Repo name**: `blueprint-data`
   - **File path**: leave as `calendar-data.json`
   - **Branch**: `main`
   - **Access token**: paste the token from step 3
4. Click **Save & sync**. The status badge next to the view selector should turn to "Synced".

From now on, your tasks are committed to `blueprint-data` automatically a few seconds after each change, and pulled fresh each time you open the app.

## 5. Install it like an app (optional)

- **Desktop (Chrome/Edge)**: open the site, click the install icon (⊕) in the address bar, or the browser menu → "Install Blueprint…". It opens in its own window from then on.
- **Phone**: open the site, use the browser's "Add to Home Screen" option.

## Notes on notifications

Desktop notifications fire while the app is open (foreground or backgrounded/installed window). A fully static, free-hosted site has no server to push notifications from when the browser is completely closed — that would need a paid push service. Keep the installed app running in the background (minimized is fine) for reminders to fire.

## Notes on the reschedule engine

- A task with a **deadline** always outranks a task without one, regardless of manual priority.
- Among tasks with deadlines, the nearer deadline wins.
- Among tasks without deadlines: Urgent > Immediate > Not urgent > Long-term goal.
- Dropping/resizing a task reflows same-day neighbors around it in that order; anything that can't fit in the day's working-hours window rolls to the next day and is placed there the same way.
- Working hours default to 9:00 AM–9:00 PM. Set a one-off window for a specific date in Settings → "Working hours for a date" — it becomes that date's hard boundary.
- Ticking the checkbox on a task marks it missed and immediately re-slots it into the schedule instead of leaving it stranded.
