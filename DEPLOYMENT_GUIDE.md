# 🌐 SkyWings Airlines - Cloud Deployment Guide

This guide details how to deploy the **SkyWings Airlines** enterprise platform:
1. **GitHub Repository** (Source Control)
2. **TiDB Cloud Serverless** (Cloud MySQL Database)
3. **Render** (Node.js / Express Backend Web Service)
4. **Vercel** (Static Frontend Web Hosting with API Proxy)

---

## 📋 Architecture Overview

```
 ┌────────────────────────┐         ┌────────────────────────┐
 │   Frontend (Vercel)    │  /api   │    Backend (Render)    │
 │ https://app.vercel.app │ ──────> │ https://api.onrender   │
 └────────────────────────┘         └───────────┬────────────┘
                                                │ MySQL (TLS 1.2)
                                                ▼
                                    ┌────────────────────────┐
                                    │  Database (TiDB Cloud) │
                                    │   Serverless Cluster   │
                                    └────────────────────────┘
```

---

## 🛠️ Step 1: Push Code to GitHub Repository

1. Open your terminal in the project root:
```bash
git init
git add .
git commit -m "feat: initial commit of SkyWings Airlines enterprise application"
```

2. Create a new repository on [GitHub](https://github.com/new) named `skywings-airlines` (set it to **Public** or **Private**).

3. Link and push to GitHub:
```bash
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/skywings-airlines.git
git push -u origin main
```

---

## 🗄️ Step 2: Setup Database on TiDB Cloud (Free Serverless MySQL)

[TiDB Cloud](https://tidbcloud.com) provides free, production-grade, distributed Serverless MySQL instances with 5GB storage and 99.99% availability.

1. **Create Free Account**:
   - Go to [https://tidbcloud.com](https://tidbcloud.com) and sign up (Free, no credit card required).

2. **Create a Serverless Cluster**:
   - Click **Create Cluster**.
   - Select **Serverless** (Free).
   - Select a cloud region close to your users (e.g. `AWS / us-east-1`).
   - Click **Create**.

3. **Get Connection Parameters**:
   - In your cluster dashboard, click **Connect**.
   - Under **Connect with**, choose **Node.js (mysql2)** or **General**.
   - Note down the connection parameters:
     - **Host**: e.g. `gateway01.us-east-1.prod.aws.tidbcloud.com`
     - **Port**: `4000`
     - **User**: e.g. `3xxxxxx.root`
     - **Password**: Your generated cluster password
     - **Database**: `skywings_airlines`

4. **Initialize & Seed the TiDB Cloud Database**:
   - In your local project, update your `.env` file with your TiDB credentials:
     ```env
     DB_HOST=gateway01.us-east-1.prod.aws.tidbcloud.com
     DB_PORT=4000
     DB_USER=3xxxxxx.root
     DB_PASSWORD=your_tidb_password
     DB_NAME=skywings_airlines
     DB_SSL=true
     ```
   - Run the automated database initializer from your terminal:
     ```bash
     npm run db:reset
     ```
   - This executes `database/schema.sql` (creating all 17 tables, foreign keys, and indexes) and `scripts/seed_database.js` (seeding Admin + 20 Active Customer Accounts + Airports + Fleet + Flights).

---

## 🚀 Step 3: Deploy Backend on Render

1. **Create Render Account**:
   - Go to [https://render.com](https://render.com) and log in with GitHub.

2. **Create Web Service**:
   - Click **New +** > **Web Service**.
   - Select your GitHub repository: `skywings-airlines`.

3. **Configure Service Settings**:
   - **Name**: `skywings-backend` (or `skywings-api`)
   - **Region**: Choose same region as TiDB (e.g. `US East / Ohio` or `Oregon`)
   - **Branch**: `main`
   - **Root Directory**: *(leave blank)*
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

4. **Set Environment Variables in Render**:
   Under the **Environment Variables** tab, add:

   | Key | Value | Notes |
   |---|---|---|
   | `NODE_ENV` | `production` | Production mode |
   | `DB_HOST` | `gateway01.us-east-1.prod.aws.tidbcloud.com` | From TiDB Cloud |
   | `DB_PORT` | `4000` | TiDB default port |
   | `DB_USER` | `3xxxxxx.root` | TiDB user |
   | `DB_PASSWORD` | `your_tidb_password` | TiDB password |
   | `DB_NAME` | `skywings_airlines` | Database name |
   | `DB_SSL` | `true` | Enables TLS 1.2 required by TiDB |
   | `JWT_SECRET` | `skywings_super_secure_enterprise_key_2026` | Any strong secret |
   | `JWT_EXPIRES_IN` | `7d` | Token validity |
   | `FRONTEND_URL` | `https://your-app.vercel.app` | Exact Vercel production URL; required for browser login/registration |

5. **Deploy**:
   - Click **Create Web Service**.
   - Render will build and launch your backend service.
   - Copy your Render backend URL (e.g. `https://skywings-backend.onrender.com`).
   - Test health check in your browser: `https://skywings-backend.onrender.com/api/health` (should return `{"status":"ok"}`).

---

## ⚡ Step 4: Deploy Frontend on Vercel

1. **Configure Vercel Rewrite Proxy**:
   - In your local project, open `frontend/vercel.json` and add your Render backend URL:
     ```json
     {
       "version": 2,
       "cleanUrls": true,
       "trailingSlash": false,
       "rewrites": [
         {
           "source": "/api/:path*",
           "destination": "https://YOUR_RENDER_BACKEND_URL.onrender.com/api/:path*"
         }
       ]
     }
     ```
   - Commit and push this change to GitHub:
     ```bash
     git add frontend/vercel.json
     git commit -m "chore: configure Vercel API proxy to Render backend"
     git push origin main
     ```

2. **Import Project to Vercel**:
   - Go to [https://vercel.com](https://vercel.com) and log in with GitHub.
   - Click **Add New...** > **Project**.
   - Select your `skywings-airlines` repository.

3. **Configure Vercel Build Settings**:
   - **Framework Preset**: `Other`
   - **Root Directory**: Click **Edit** and select `frontend`
   - **Build Command**: *(leave empty - static app)*
   - **Output Directory**: *(leave empty)*

4. **Deploy**:
   - Click **Deploy**.
   - Vercel will deploy your frontend to a global edge CDN (e.g. `https://skywings-airlines.vercel.app`). Copy that exact URL into the Render service's `FRONTEND_URL` environment variable, then redeploy the Render service. If you also use a custom domain, add it to `CORS_ALLOWED_ORIGINS` as a comma-separated origin.

---

## 🧪 Step 5: Test & Verify Live Deployment

1. Open your live Vercel URL (e.g. `https://skywings-airlines.vercel.app`).
2. Log in with the pre-seeded credentials:
   - **Admin Access**: `admin@skywings.com` / `admin123`
   - **Customer Access**: `user@skywings.com` / `user123` (or any of the 20 pre-seeded accounts)
3. Test flight booking, interactive seat selection, payment, web check-in, and admin flight management.

---

## 🔒 Security Best Practices Checklist for Production

- [x] Passwords hashed with `bcryptjs` (salt rounds: 10).
- [x] HttpOnly `SameSite=Lax` cookies prevent XSS credential exfiltration.
- [x] TiDB Cloud TLS 1.2 encrypted connection string.
- [x] Centralized audit logging sanitizes passwords, card numbers, and tokens.
- [x] Transactional row-level database locking guarantees zero double-booking.
