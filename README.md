# ☁️ DLSS-Manager-OnlineDB (`dlssdb.goover.dev`)

Official **Online Game Compatibility, Anti-Cheat Policy & Recommended Settings Database** with **User Management, Personal API Keys & Admin Control Center** for [**DLSS Manager**](https://github.com/gOOvER/DLSS-Manager) — architected **100% for the Cloudflare Free Tier (`0 €`)** using **Cloudflare Pages + Pages Functions + Cloudflare D1 (Edge SQLite)**.

---

## 🌐 Endpoints (`dlssdb.goover.dev`)

| Environment | URL | Description |
| :--- | :--- | :--- |
| **Web Portal & Admin UI** | `https://dlssdb.goover.dev/` | Game Explorer, User Registration, Personal API Key Generator & Admin Area |
| **Protected API Endpoint** | `https://dlssdb.goover.dev/api/v1/games.json` | Requires personal `X-API-Key: dlss_live_...` or `Authorization: Bearer dlss_live_...` |
| **GitHub Raw (Offline Fallback)** | `https://raw.githubusercontent.com/gOOvER/DLSS-Manager-OnlineDB/main/api/v1/games.json` | Static fallback mirror |

---

## 🆓 100% Cloudflare Free Tier Setup (`0 € / Monat`)

This project only uses features included permanently in the **Cloudflare Free Plan**:
1. **Cloudflare Pages** (Free: Unlimited static requests)
2. **Cloudflare Pages Functions** (Free: `100,000` invocations/day)
3. **Cloudflare D1 Edge SQLite** (Free: `5 GB` storage, `5,000,000` rows read/day, `100,000` rows written/day)
   - *Free-Tier Optimization:* Schema initialization (`ensureDbSchema`) is cached in isolate memory (`globalThis.__DLSS_DB_SCHEMA_READY`), `games` queries are cached in memory for 60s (`getCachedGamesPayload`), and API Key validation uses an indexed 1-row lookup (`idx_users_api_key`).

### Step-by-Step Deployment in Cloudflare Dashboard

1. **Create D1 Database (Free):**
   - Go to **Cloudflare Dashboard** -> **Storage & Databases** -> **D1 SQL Database** -> **Create Database**.
   - Name it **`dlss-manager-db`**.
   - *(No manual SQL import needed: the Pages Functions automatically create the tables and seed all 16 initial games on the very first request!)*
2. **Create Cloudflare Pages Project:**
   - Go to **Workers & Pages** -> **Create** -> **Pages** -> **Connect to Git** -> select **`gOOvER/DLSS-Manager-OnlineDB`**.
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
3. **Bind D1 Database to Pages:**
   - In your Pages project -> **Settings** -> **Bindings** -> **Add** -> **D1 database**:
     - **Variable name:** `DB`
     - **D1 database:** `dlss-manager-db`
   - Trigger a redeploy (or push a commit).
4. **Custom Domain (`dlssdb.goover.dev`):**
   - In your Pages project -> **Custom domains** -> **Set up a custom domain** -> enter **`dlssdb.goover.dev`**.
5. **Create Your Admin Account:**
   - Open `https://dlssdb.goover.dev` -> **🔑 My API Key / Account** -> **Registrieren**.
   - **The very first registered user is automatically granted the `ADMIN` role** and unlocks the **🛡️ Admin Bereich** tab!
