# How to Put This Website Live

This guide assumes you have never deployed a website before. Follow every step in order.

---

## What We're Building

A task manager website where people can sign in with Google or GitHub, create projects, manage tasks, and invite team members. The data lives in a database (PostgreSQL) on the cloud.

---

## Part 1: Create a GitHub Account

If you don't already have one:

1. Go to https://github.com
2. Click "Sign up"
3. Enter your email, create a password, pick a username
4. Verify your email address

---

## Part 2: Push the Code to GitHub

This takes the code from your computer and uploads it to the internet.

**Step 2.1 — Create a new repository on GitHub**

1. Open your browser and go to https://github.com/new
2. For "Repository name" type: `project-manager`
3. Leave everything else as-is
4. Click "Create repository"
5. You'll see a page with commands. Look for the section titled **"...or push an existing repository from the command line"**. It shows three commands. **Do not copy them yet** — first follow the steps below.

**Step 2.2 — Open PowerShell**

1. Press the **Windows key** on your keyboard
2. Type `PowerShell`
3. Click "Windows PowerShell"
4. A black window with a blinking cursor appears

**Step 2.3 — Go to your project folder**

1. In PowerShell, type this exact line then press Enter:

```powershell
cd "C:\Users\Jayde\Downloads\Project Manager Website"
```

**Step 2.4 — Save your code as a first commit**

1. In PowerShell, type this line then press Enter:

```powershell
git add -A
```

2. Then type this line then press Enter:

```powershell
git commit -m "initial upload"
```

**Step 2.5 — Upload to GitHub**

1. Go back to your browser (the GitHub page from Step 2.1)
2. In the **"...or push an existing repository from the command line"** section, click the copy button (clipboard icon) next to the first command. The three lines should look like:

```
git remote add origin https://github.com/jaydenjakeman2010-web/project-manager.git
git branch -M main
git push -u origin main
```

3. Go back to PowerShell and **paste the three commands** (right-click in the black window to paste):

   The first command tells your computer where GitHub is.
   The second renames your main branch.
   The third uploads your code.

4. If this is your first time using git, a sign-in window might pop up. Sign in with your GitHub username and password OR it may ask for a "personal access token":

   **If it asks for a password, DO NOT type your normal password. Instead:**
   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Give it a name like "upload"
   - Check the box next to **repo** (top checkbox)
   - Scroll down and click "Generate token"
   - **Copy the token** (it starts with `ghp_`)
   - Go back to PowerShell and paste it when asked for password

5. If it worked, you'll see uploading progress bars and a success message. Your code is now on GitHub.

---

## Part 3: Deploy on Railway (The Hosting Service)

Railway runs your website on the internet 24/7.

**Step 3.1 — Create a Railway account**

1. Go to https://railway.app
2. Click "Start a New Project" or "Sign in with GitHub"
3. Click "Sign in with GitHub" — this connects Railway to your GitHub
4. Give permission when GitHub asks
5. Complete your Railway account setup

**Step 3.2 — Create the project**

1. Click "New Project"
2. Click "Deploy from GitHub repo"
3. Find and click your `project-manager` repo
4. Wait 30 seconds — Railway is building your code

**Step 3.3 — Add a database**

1. In Railway, click the **+** (plus) button
2. Click "Database"
3. Click "Add PostgreSQL"
4. Wait for it to finish adding (takes ~20 seconds)
5. Railway automatically connects the database to your app — you don't need to do anything

You now have a live website. It will have a URL like `https://project-manager.up.railway.app`. Click the URL to open it.

**BUT** sign-in won't work yet — you need to set up Google and/or GitHub login first (next step). The login buttons will only appear after you finish Part 4 and/or Part 5.

**You only need ONE provider.** If you only set up Google, only the Google button appears. If you only set up GitHub, only the GitHub button appears. If you set up both, both buttons appear.

---

## Part 3B (Alternative): Deploy on Vercel

Vercel runs the whole app as one serverless function. The front-end files live in the `public/` folder and are served by Vercel's CDN automatically.

**Step 3B.1 — Import the project**

1. Go to https://vercel.com/new
2. Sign in with GitHub
3. Pick your `project-manager` repo
4. Leave the framework settings on "Express" (auto-detected) and click "Deploy"

**Step 3B.2 — Add a database**

Vercel does not include PostgreSQL. Create a free one (e.g. https://neon.tech), copy its connection string, then in Vercel:

1. Click your project → Settings → Environment Variables
2. Add `DATABASE_URL` = your Postgres connection string
3. Add `JWT_SECRET` = the random string from Part 6
4. Add `NODE_ENV` = `production`
5. Add `CORS_ORIGIN` = `https://your-project.vercel.app` (use your real Vercel URL)
6. Add any OAuth/SMTP keys you set up in Parts 4-5
7. Go to Deployments → Redeploy

The database tables are created automatically the first time the site calls the API. If anything looks empty, run `npm run db:migrate` on your computer with `DATABASE_URL` set.

**Vercel notes**

- OAuth callback URLs must use your Vercel URL, e.g. `https://your-project.vercel.app/api/auth/google/callback`.
- The hourly recurring-task engine and live notifications keep running only on a persistent host (Railway). On Vercel, recurring tasks are not generated unless you add a Vercel Cron Job.

---

## Part 4: Set Up Google Login

**Step 4.1 — Go to Google Cloud Console**

1. Go to https://console.cloud.google.com
2. Sign in with your Google account
3. Accept the terms if asked
4. Click "Select a project" at the top → "New Project"
5. Name it `Project Manager` → Click "Create"
6. Make sure "Project Manager" is selected at the top

**Step 4.2 — Enable the API**

1. In the search bar at the top, type "OAuth" and click "OAuth consent screen"
2. Choose "External" → Click "Create"
3. For "App name" type: `Project Manager`
4. For "User support email" choose your email
5. For "Developer contact information" type your email
6. Click "Save and Continue"
7. Click "Add or Remove Scopes"
8. Check the boxes: `.../auth/userinfo.email` and `.../auth/userinfo.profile`
9. Click "Update" → "Save and Continue"
10. Click "Add Users" → type your email → "Add"
11. Click "Save and Continue"
12. You can ignore the "Summary" page — just click "Back to Dashboard"

**Step 4.3 — Create credentials**

1. On the left menu (hamburger icon top-left if hidden), click "Credentials"
2. Click "Create Credentials" at the top → "OAuth client ID"
3. For "Application type" choose "Web application"
4. For "Name" type: `Project Manager Web`
5. Under "Authorized redirect URIs", click "Add URI"
6. Type: `https://project-manager.up.railway.app/api/auth/google/callback`
   - **IMPORTANT:** Replace `project-manager.up.railway.app` with your actual Railway URL
7. Click "Create"
8. A popup will show your **Client ID** and **Client Secret**. These are your Google login keys. **Copy both** somewhere safe (a text file is fine for now).

**Step 4.4 — Add those keys to Railway**

1. Go back to Railway in your browser
2. Click your project
3. Click the "Variables" tab (or look for a key icon)
4. Click "New Variable"
5. For the key, type: `GOOGLE_CLIENT_ID`
6. For the value, paste your Client ID
7. Click "Add"
8. Repeat: add `GOOGLE_CLIENT_SECRET` with your Client Secret
9. Repeat: add `GOOGLE_CALLBACK_URL` with: `https://project-manager.up.railway.app/api/auth/google/callback`

---

## Part 5: Set Up GitHub Login

**Step 5.1 — Create a GitHub OAuth App**

1. Go to https://github.com/settings/developers
2. Click "OAuth Apps" on the left
3. Click "New OAuth App"
4. For "Application name" type: `Project Manager`
5. For "Homepage URL" type your Railway URL (like `https://project-manager.up.railway.app`)
6. For "Authorization callback URL" type: `https://project-manager.up.railway.app/api/auth/github/callback`
7. Click "Register application"
8. You'll see a "Client ID" — copy it
9. Click "Generate a new client secret" → copy the secret that appears

**Step 5.2 — Add these to Railway**

Back in Railway → Variables tab, add:
- `GITHUB_CLIENT_ID` = (the Client ID you just copied)
- `GITHUB_CLIENT_SECRET` = (the secret you just copied)
- `GITHUB_CALLBACK_URL` = `https://project-manager.up.railway.app/api/auth/github/callback`

---

## Part 6: Set a Secret Key (Security)

This is like a master password your server uses to create login tokens.

1. Open PowerShell on your computer
2. Type:
```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
3. A long random string will appear. Copy it.
4. In Railway → Variables tab, add:
   - `JWT_SECRET` = (the random string you just copied)
   - `NODE_ENV` = `production`
   - `CORS_ORIGIN` = your Railway URL (like `https://project-manager.up.railway.app`)

---

## Part 7: Restart and Test

1. In Railway, go to the "Deployments" tab
2. Click "Redeploy" (this makes it use the new settings)
3. Wait ~30 seconds for it to build and start
4. Click your URL to open the site
5. You should see a "Sign In" screen with Google and GitHub buttons
6. Click one to test — it should take you through the login flow and back to your app

---

## Common Problems

**"Something went wrong" when signing in**
- Check that your callback URLs exactly match. The most common mistake is `google` vs `google` (typo) or missing `/api/auth/` in the path.
- In Google Cloud Console → Credentials → click your OAuth client → check the redirect URI matches EXACTLY.

**"Application error" on first load**
- Go to Railway → Deployments tab → click the failed deployment → "View logs"
- Look for red error text. Common issues: missing `DATABASE_URL` (add Postgres plugin), missing `JWT_SECRET`.

**The page looks unstyled (no CSS)**
- Hard refresh: hold Ctrl and click the refresh button (or press Ctrl+F5)

**I changed the code on my computer — how do I update the live site?**
```powershell
cd "C:\Users\Jayde\Downloads\Project Manager Website"
git add -A
git commit -m "describe your change here"
git push
```
Railway will automatically rebuild and redeploy.

---

## Your Railway URL / Custom Domain

Your site is at `https://project-manager.up.railway.app`. To use a custom domain like `mytasks.com`:

1. In Railway, click your project
2. Go to "Settings" tab → "Domains"
3. Type your domain and follow Railway's instructions (you'll need to update DNS settings at your domain registrar)

---

## Cost

Railway has a free tier. The Postgres database and one service are free. The free tier sleeps after inactivity (takes ~10 seconds to wake up on first visit).
