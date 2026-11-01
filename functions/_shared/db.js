// Shared Cloudflare Pages D1 Database, Auth & Crypto Utilities for dlssdb.goover.dev
// Strictly optimized for Cloudflare Free Tier (Workers Free + D1 Free Tier: 5M reads/day, 100k writes/day, 5 GB storage).

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function randomHex(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateApiKey() {
  return `dlss_live_${randomHex(20)}`;
}

export async function hashPassword(password, providedSalt = null) {
  const salt = providedSalt || randomHex(16);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  // Web Crypto API on Cloudflare Workers Free Tier supports up to 100,000 PBKDF2 iterations within the 10ms CPU limit
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 50000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return `${salt}:${hashHex}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt] = storedHash.split(":");
  const computed = await hashPassword(password, salt);
  return computed === storedHash;
}

export const SEED_GAMES = [
  {
    id: "starcitizen",
    title: "Star Citizen",
    steam_app_ids: [
      "starcitizen_live",
      "starcitizen_ptu",
      "starcitizen_eptu",
      "starcitizen_tech-preview",
      "starcitizen_hotfix",
    ],
    match_names: [
      "star citizen",
      "star citizen (live)",
      "star citizen (ptu)",
      "star citizen (eptu)",
      "star citizen (tech-preview)",
      "star citizen (hotfix)",
    ],
    match_executables: ["starcitizen.exe"],
    anticheat_status: "signed_only",
    supported_techs: ["DLSS"],
    unsupported_techs: [
      {
        tech: "FSR 3/4 & TSR",
        reason:
          "AMD FSR 2 and CIG TSR are compiled directly into StarCitizen.exe & Data.p4k shaders (no external FSR DLL in Bin64).",
      },
      {
        tech: "DLSS-G (Frame Gen)",
        reason:
          "DLSS Frame Generation (nvngx_dlssg.dll) is not natively supported by StarEngine yet.",
      },
      {
        tech: "DLSS-RR & XeSS",
        reason:
          "Ray Reconstruction (nvngx_dlssd.dll) and Intel XeSS (libxess.dll) are not natively integrated in Star Citizen.",
      },
    ],
    warning_banner:
      "EasyAntiCheat monitors Bin64: Official NVIDIA-signed nvngx_dlss.dll updates and NVIDIA Driver DRS Presets (Preset J/K/L) work safely. Do not inject unsigned third-party wrapper DLLs.",
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: null,
    recommended_settings: [
      "Upscaling: DLSS (Quality or Balanced at 1440p/4K)",
      "NVIDIA DLSS Preset: Preset K (Transformer Gen 2 — sharper distant ship hulls & HUD MFD text)",
      "Graphics Renderer: DirectX 11 or Vulkan (Beta)",
    ],
  },
  {
    id: "overwatch-2",
    title: "Overwatch 2",
    steam_app_ids: ["2357570"],
    match_names: ["overwatch 2", "overwatch"],
    match_executables: ["overwatch.exe"],
    anticheat_status: "signed_only",
    supported_techs: ["DLSS"],
    unsupported_techs: [
      {
        tech: "DLSS-G (Frame Gen)",
        reason:
          "Overwatch 2 supports DLSS Super Resolution & NVIDIA Reflex, but does not ship with DLSS Frame Generation (nvngx_dlssg.dll).",
      },
    ],
    warning_banner:
      "Blizzard Defense Matrix: Official NVIDIA-signed nvngx_dlss.dll updates and NVIDIA Driver DRS Presets are supported. Battle.net patches may reset nvngx_dlss.dll after seasonal updates.",
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: null,
    recommended_settings: [
      "High Quality Upsampling: NVIDIA DLSS Super Resolution (Quality)",
      "NVIDIA Reflex: Enabled + Boost",
      "Dynamic Render Scale: Off (for consistent crosshair & outline sharpness)",
    ],
  },
  {
    id: "diablo-iv",
    title: "Diablo IV",
    steam_app_ids: ["2344520"],
    match_names: ["diablo iv", "diablo 4"],
    match_executables: ["diablo iv.exe"],
    anticheat_status: "signed_only",
    supported_techs: ["DLSS", "DLSS-G", "DLSS-RR", "Streamline", "DStorage", "XeSS"],
    unsupported_techs: [],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: "Preset F",
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "Resolution Scaling: NVIDIA DLSS Super Resolution (Quality / DLAA)",
      "DLSS Frame Generation: Enabled (RTX 40/50 Series)",
      "NVIDIA Reflex Low Latency: Enabled + Boost",
    ],
  },
  {
    id: "cyberpunk-2077",
    title: "Cyberpunk 2077",
    steam_app_ids: ["1091500"],
    match_names: ["cyberpunk 2077"],
    match_executables: ["cyberpunk2077.exe"],
    anticheat_status: "safe",
    supported_techs: ["DLSS", "DLSS-G", "DLSS-RR", "Streamline", "FSR 3/4", "XeSS"],
    unsupported_techs: [],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: "Preset F",
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "DLSS Transformer Model: Enabled (Preset K / Preset M)",
      "DLSS Ray Reconstruction: Enabled (Preset F) when Path Tracing / Ray Tracing is active",
      "DLSS Frame Generation: Enabled (Multi Frame Gen on RTX 50 Series)",
    ],
  },
  {
    id: "everspace-2",
    title: "EVERSPACE 2",
    steam_app_ids: ["1128920"],
    match_names: ["everspace 2"],
    match_executables: ["es2-win64-shipping.exe"],
    anticheat_status: "safe",
    supported_techs: ["DLSS", "DLSS-G", "DLSS-RR", "Streamline", "FSR 3/4", "XeSS"],
    unsupported_techs: [],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: "Preset F",
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "Upscaler: NVIDIA DLSS Quality + Frame Generation",
      "DirectX 12 required for DLSS Frame Generation & Lumen GI",
    ],
  },
  {
    id: "longvinter",
    title: "Longvinter",
    steam_app_ids: ["1635450"],
    match_names: ["longvinter"],
    match_executables: ["longvinter-win64-shipping.exe"],
    anticheat_status: "signed_only",
    supported_techs: ["DLSS", "DLSS-G", "DLSS-RR", "Streamline"],
    unsupported_techs: [],
    warning_banner:
      "EasyAntiCheat protected: Only official NVIDIA-signed DLSS & Streamline binaries should be used.",
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: "Latest",
    recommended_settings: ["NVIDIA DLSS: Quality", "DLSS Preset: Preset K"],
  },
  {
    id: "forza-horizon-5",
    title: "Forza Horizon 5",
    steam_app_ids: ["1551360"],
    match_names: ["forza horizon 5", "forzahorizon5"],
    match_executables: ["forzahorizon5.exe"],
    anticheat_status: "signed_only",
    supported_techs: ["DLSS", "DLSS-G", "Streamline", "DStorage", "XeSS"],
    unsupported_techs: [],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "NVIDIA DLSS: Quality or DLAA (eliminates power-line & foliage shimmering with Preset K)",
      "DLSS Frame Generation: Enabled",
    ],
  },
  {
    id: "msfs-2024",
    title: "Microsoft Flight Simulator 2024",
    steam_app_ids: ["2537590"],
    match_names: ["microsoft flight simulator 2024", "msfs2024"],
    match_executables: ["flightsimulator2024.exe"],
    anticheat_status: "safe",
    supported_techs: ["DLSS", "DLSS-G", "Streamline", "FSR 3/4"],
    unsupported_techs: [],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "Anti-Aliasing: NVIDIA DLSS Super Resolution (Quality or DLAA)",
      "DLSS Preset K significantly reduces glass cockpit speed/altitude tape ghosting",
      "Frame Generation: NVIDIA DLSS G",
    ],
  },
  {
    id: "call-of-duty-hq",
    title: "Call of Duty / Warzone",
    steam_app_ids: ["1938090"],
    match_names: ["call of duty", "call of duty hq", "warzone", "black ops 6"],
    match_executables: ["cod.exe"],
    anticheat_status: "driver_override_only",
    supported_techs: ["DLSS", "DLSS-G", "DLSS-RR", "FSR 3/4", "XeSS"],
    unsupported_techs: [
      {
        tech: "Manual DLL Swap",
        reason:
          "Ricochet Anti-Cheat verifies game file hashes on launch. Use NVIDIA Driver DRS Presets (Preset K) instead of replacing files on disk.",
      },
    ],
    warning_banner:
      "Ricochet Anti-Cheat Warning: Prefer NVIDIA Driver-Level DRS Presets (🎛️ DLSS Preset Settings) instead of modifying DLL files in the installation directory.",
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: "Preset F",
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "Use NVIDIA Driver DRS Override (Preset K) via DLSS Preset Settings",
      "Upscaling: NVIDIA DLSS Quality or FidelityFX CAS",
    ],
  },
  {
    id: "alan-wake-2",
    title: "Alan Wake 2",
    steam_app_ids: ["alanwake2"],
    match_names: ["alan wake 2", "alanwake2"],
    match_executables: ["alanwake2.exe"],
    anticheat_status: "safe",
    supported_techs: ["DLSS", "DLSS-G", "DLSS-RR", "Streamline", "DStorage"],
    unsupported_techs: [
      {
        tech: "External FSR / XeSS DLL",
        reason:
          "Northlight Engine integrates FSR 2 natively without external FidelityFX or XeSS DLLs.",
      },
    ],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: "Preset F",
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "DLSS Ray Reconstruction: Enabled with Preset F (Transformer Gen 2 reduces wire & fence ghosting)",
      "Resolution Upscaling: DLSS Quality or Balanced",
      "DLSS Frame Generation: Enabled",
    ],
  },
  {
    id: "black-myth-wukong",
    title: "Black Myth: Wukong",
    steam_app_ids: ["2358720"],
    match_names: ["black myth wukong", "black myth: wukong", "b1"],
    match_executables: ["b1-win64-shipping.exe"],
    anticheat_status: "safe",
    supported_techs: ["DLSS", "DLSS-G", "DLSS-RR", "Streamline", "FSR 3/4", "XeSS"],
    unsupported_techs: [],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: "Preset F",
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "Super Resolution: DLSS (67% Quality or 75% DLAA) with Preset K",
      "Full Ray Tracing: Enable DLSS Ray Reconstruction (Preset F) to eliminate water & foliage shimmer",
      "Frame Generation: Enabled",
    ],
  },
  {
    id: "stalker-2",
    title: "S.T.A.L.K.E.R. 2: Heart of Chornobyl",
    steam_app_ids: ["1643320"],
    match_names: [
      "stalker 2",
      "s.t.a.l.k.e.r. 2",
      "s.t.a.l.k.e.r. 2 heart of chornobyl",
      "stalker2",
    ],
    match_executables: ["stalker2-win64-shipping.exe"],
    anticheat_status: "safe",
    supported_techs: ["DLSS", "DLSS-G", "Streamline", "FSR 3/4", "XeSS"],
    unsupported_techs: [],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "Upscaling Quality: DLSS Quality with Preset K (vastly improves foliage stability in the Zone)",
      "DLSS Frame Generation: Enabled",
    ],
  },
  {
    id: "marvel-rivals",
    title: "Marvel Rivals",
    steam_app_ids: ["2767030"],
    match_names: ["marvel rivals", "marvelrivals"],
    match_executables: ["marvel-win64-shipping.exe"],
    anticheat_status: "signed_only",
    supported_techs: ["DLSS", "DLSS-G", "DLSS-RR", "Streamline", "FSR 3/4", "XeSS"],
    unsupported_techs: [],
    warning_banner:
      "Anti-Cheat Protected: Official NVIDIA-signed DLSS & Streamline updates and Driver DRS Presets (Preset K) are safe.",
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "Anti-Aliasing and Super Resolution: NVIDIA DLSS Quality (Preset K)",
      "NVIDIA Reflex Low Latency: Enabled + Boost",
    ],
  },
  {
    id: "monster-hunter-wilds",
    title: "Monster Hunter Wilds",
    steam_app_ids: ["2246340"],
    match_names: ["monster hunter wilds", "monsterhunterwilds"],
    match_executables: ["monsterhunterwilds.exe"],
    anticheat_status: "safe",
    supported_techs: ["DLSS", "DLSS-G", "Streamline", "DStorage", "FSR 3/4", "XeSS"],
    unsupported_techs: [],
    warning_banner: null,
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: "Latest",
    recommended_settings: [
      "Upscaling: NVIDIA DLSS Quality or Balanced with Preset K (eliminates RE Engine hair/fur dithering)",
      "Frame Generation: Enabled",
      "DirectStorage: Keep updated to latest 1.2+ for faster texture streaming",
    ],
  },
  {
    id: "red-dead-redemption-2",
    title: "Red Dead Redemption 2",
    steam_app_ids: ["1174180"],
    match_names: ["red dead redemption 2", "rdr2"],
    match_executables: ["rdr2.exe"],
    anticheat_status: "safe",
    supported_techs: ["DLSS", "FSR 2"],
    unsupported_techs: [
      {
        tech: "DLSS-G (Frame Gen)",
        reason:
          "RAGE Engine in Red Dead Redemption 2 only ships with DLSS 2 Super Resolution and FSR 2 (no native Frame Generation).",
      },
    ],
    warning_banner:
      "Rockstar Games Launcher may revert nvngx_dlss.dll if 'Verify Integrity' is run. Avoid Red Dead Online when using modified files; Driver DRS Preset K works globally.",
    recommended_sr_preset: "Preset K",
    recommended_rr_preset: null,
    recommended_fg_preset: null,
    recommended_settings: [
      "NVIDIA DLSS: Quality with Preset K (completely fixes RDR2's infamous horse-mane & tree-leaf sharpening artifacts)",
      "DLSS Sharpening: 0 (Preset K handles edge clarity natively)",
    ],
  },
  {
    id: "helldivers-2",
    title: "HELLDIVERS 2",
    steam_app_ids: ["553850"],
    match_names: ["helldivers 2"],
    match_executables: ["helldivers2.exe"],
    anticheat_status: "blocked",
    supported_techs: [],
    unsupported_techs: [
      {
        tech: "DLSS / FSR / XeSS DLLs",
        reason:
          "HELLDIVERS 2 uses its own built-in Stingray temporal upscaler and nProtect GameGuard blocks external DLL injection.",
      },
    ],
    warning_banner:
      "nProtect GameGuard blocks external DLL modifications in bin/. Automatic DLL updates are disabled for safety.",
    recommended_sr_preset: null,
    recommended_rr_preset: null,
    recommended_fg_preset: null,
    recommended_settings: ["Render Scale: Native or Ultra Quality (built-in upscaler)"],
  },
];

// Isolate-level cache to avoid redundant D1 reads on Cloudflare Free Tier
export function invalidateGamesMemoryCache() {
  globalThis.__DLSS_GAMES_CACHE = null;
}

export async function getCachedGamesPayload(db) {
  const nowMs = Date.now();
  if (
    globalThis.__DLSS_GAMES_CACHE &&
    nowMs - globalThis.__DLSS_GAMES_CACHE.ts < 60000
  ) {
    return globalThis.__DLSS_GAMES_CACHE.payload;
  }

  const { results } = await db
    .prepare("SELECT payload_json, updated_at FROM games ORDER BY LOWER(title) ASC")
    .all();

  const games = [];
  let latestUpdate = "2026-10-31T06:35:00Z";
  for (const r of results || []) {
    try {
      games.push(JSON.parse(r.payload_json));
      if (r.updated_at && r.updated_at > latestUpdate) {
        latestUpdate = r.updated_at;
      }
    } catch {
      // skip invalid JSON
    }
  }

  const payload = {
    schema_version: 1,
    updated_at: latestUpdate,
    games,
  };
  globalThis.__DLSS_GAMES_CACHE = { ts: nowMs, payload };
  return payload;
}

export async function ensureDbSchema(db) {
  if (!db) {
    throw new Error(
      "Cloudflare D1 database binding 'DB' is not configured yet. Please bind a D1 database named 'DB' in Cloudflare Pages -> Settings -> Bindings."
    );
  }
  if (globalThis.__DLSS_DB_SCHEMA_READY) {
    return;
  }

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      discord_id TEXT UNIQUE,
      discord_avatar TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      api_key TEXT UNIQUE,
      api_key_created_at TEXT,
      api_requests_count INTEGER NOT NULL DEFAULT 0,
      last_api_access TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`),
  ]);

  // Auto-migrate existing users table if discord_id / discord_avatar columns do not exist yet
  try {
    await db.prepare("ALTER TABLE users ADD COLUMN discord_id TEXT").run();
  } catch {
    // column already exists
  }
  try {
    await db.prepare("ALTER TABLE users ADD COLUMN discord_avatar TEXT").run();
  } catch {
    // column already exists
  }
  try {
    await db
      .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id)")
      .run();
  } catch {
    // index already exists
  }

  const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM games").first();
  if (!countRow || Number(countRow.cnt) === 0) {
    const now = new Date().toISOString();
    const stmts = SEED_GAMES.map((g) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO games (id, title, payload_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5)"
        )
        .bind(g.id, g.title, JSON.stringify(g), now, "system")
    );
    await db.batch(stmts);
  }

  globalThis.__DLSS_DB_SCHEMA_READY = true;
}

export async function getAuthenticatedUser(request, db) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.email, u.discord_id, u.discord_avatar, u.role, u.api_key, u.api_key_created_at,
              u.api_requests_count, u.last_api_access, u.is_active, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?1 AND s.expires_at > ?2`
    )
    .bind(token, now)
    .first();

  if (!row || Number(row.is_active) === 0) return null;
  return row;
}

export async function getDiscordCredentials(env, db) {
  let clientId = (env.DISCORD_CLIENT_ID || "").trim();
  let clientSecret = (env.DISCORD_CLIENT_SECRET || "").trim();

  if ((!clientId || !clientSecret) && db) {
    try {
      await ensureDbSchema(db);
      const { results } = await db
        .prepare(
          "SELECT key, value FROM app_settings WHERE key IN ('discord_client_id', 'discord_client_secret')"
        )
        .all();
      for (const r of results || []) {
        if (r.key === "discord_client_id" && !clientId) clientId = String(r.value || "").trim();
        if (r.key === "discord_client_secret" && !clientSecret)
          clientSecret = String(r.value || "").trim();
      }
    } catch {
      // ignore
    }
  }

  return { clientId, clientSecret };
}
