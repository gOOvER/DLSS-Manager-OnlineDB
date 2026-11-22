# ☁️ DLSS-Manager-OnlineDB (`dlssdb.goover.dev`)

Official **Online Game Compatibility, Anti-Cheat Policy & Recommended Settings Database** with **User Management, Personal API Keys, SteamDB/Reference Links & Admin Review Center** for [**DLSS Manager**](https://github.com/gOOvER/DLSS-Manager) — architected **100% for the Cloudflare Free Tier (`$0 / month`)** using **Cloudflare Pages + Pages Functions + Cloudflare D1 (Edge SQLite)**.

---

## 🌐 Endpoints (`dlssdb.goover.dev`)

| Environment | URL | Description |
| :--- | :--- | :--- |
| **Web Portal & Admin UI** | `https://dlssdb.goover.dev/` | Modern Game Explorer (`Safe` / `Signed Only` / `Driver Override` / `Unverified` / `Blocked`), User Registration, Personal API Key Generator & Admin Review Panel |
| **Protected Games Feed** | `https://dlssdb.goover.dev/api/v1/games.json` | Requires personal `X-API-Key: dlss_live_...` or `Authorization: Bearer dlss_live_...` |
| **Game Submission Endpoint** | `https://dlssdb.goover.dev/api/v1/games/report` | Accepts manual user reports (`works` / `broken`) and unverified `auto_scan` discovery entries with SteamDB / PCGamingWiki reference links |
| **GitHub Raw (Offline Fallback)** | `https://raw.githubusercontent.com/gOOvER/DLSS-Manager-OnlineDB/main/api/v1/games.json` | Static curated fallback mirror |

---

## 🛡️ Verification & Auto-Discovery Workflow

- **Curated Official Seed (`api/v1/games.json`):** Contains verified profiles (e.g., *Star Citizen*, *Overwatch 2*, *Diablo IV*, *Cyberpunk 2077*, *EVERSPACE 2*, *Longvinter*, *Forza Horizon 5*, *Microsoft Flight Simulator 2024*, *Call of Duty / Warzone*).
- **Automatic Library Scans (`source: "auto_scan"`):** Scanned games submitted automatically by DLSS Manager are stored as **`unverified`** (`works_status: "unverified"`, `anticheat_status: "unverified"`) with an automatic **SteamDB** (`https://steamdb.info/app/<id>/`) or **PCGamingWiki** reference link — they are **never** falsely marked as `safe` / working until reviewed.
- **Manual User Reports (`source: "manual"`):** Explicit user reports require a `works` or `broken` status and enter the Admin moderation queue for approval.

---

## 🆓 100% Cloudflare Free Tier Setup (`$0 / month`)

This project only uses features included permanently in the **Cloudflare Free Plan**:
1. **Cloudflare Pages** (Free: Unlimited static requests)
2. **Cloudflare Pages Functions** (Free: `100,000` invocations/day)
3. **Cloudflare D1 Edge SQLite** (Free: `5 GB` storage, `5,000,000` rows read/day, `100,000` rows written/day)
   - *Free-Tier Optimization:* Schema initialization (`ensureDbSchema`) is cached in isolate memory (`globalThis.__DLSS_DB_SCHEMA_READY`), `games` queries are cached in memory for 60s (`getCachedGamesPayload`), and API Key validation uses an indexed 1-row lookup (`idx_users_api_key`).

### Step-by-Step Deployment in Cloudflare Dashboard

1. **Create D1 Database (Free):**
   - Go to **Cloudflare Dashboard** → **Storage & Databases** → **D1 SQL Database** → **Create Database**.
   - Name it **`dlss-manager-db`**.
   - *(No manual SQL import needed: the Pages Functions automatically create the tables and seed the initial curated games on the very first request!)*
2. **Create Cloudflare Pages Project:**
   - Go to **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select **`gOOvER/DLSS-Manager-OnlineDB`**.
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
3. **Bind D1 Database to Pages:**
   - In your Pages project → **Settings** → **Bindings** → **Add** → **D1 database**:
     - **Variable name:** `DB`
     - **D1 database:** `dlss-manager-db`
   - Trigger a redeploy (or push a commit).
4. **Custom Domain (`dlssdb.goover.dev`):**
   - In your Pages project → **Custom domains** → **Set up a custom domain** → enter **`dlssdb.goover.dev`**.
5. **Create Your Admin Account:**
   - Open `https://dlssdb.goover.dev` → **🔑 My API Key / Account** → **Register**.
   - **The very first registered user is automatically granted the `ADMIN` role** and unlocks the **🛡️ Admin Area** tab!
