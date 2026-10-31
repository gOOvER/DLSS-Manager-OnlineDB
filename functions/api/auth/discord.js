import {
  ensureDbSchema,
  generateApiKey,
  hashPassword,
  optionsResponse,
  randomHex,
} from "../../_shared/db.js";

export async function onRequestOptions() {
  return optionsResponse();
}

function getRedirectUri(requestUrl, env) {
  if (env.DISCORD_REDIRECT_URI) {
    return env.DISCORD_REDIRECT_URI.trim();
  }
  const u = new URL(requestUrl);
  return `${u.origin}/api/auth/discord/callback`;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

// GET /api/auth/discord -> Redirects to Discord OAuth2 authorize URL
// Supports optional ?link_token=sess_... to explicitly link an already logged-in Admin/User account
export async function onRequestStart(context) {
  const url = new URL(context.request.url);
  const clientId = (context.env.DISCORD_CLIENT_ID || "").trim();
  const clientSecret = (context.env.DISCORD_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    return Response.redirect(
      `${url.origin}/?auth_error=${encodeURIComponent(
        "DISCORD_NOT_CONFIGURED"
      )}#account`,
      302
    );
  }

  const redirectUri = getRedirectUri(context.request.url, context.env);
  const state = randomHex(16);
  const linkToken = (url.searchParams.get("link_token") || "").trim();

  const discordAuthUrl = new URL("https://discord.com/oauth2/authorize");
  discordAuthUrl.searchParams.set("client_id", clientId);
  discordAuthUrl.searchParams.set("response_type", "code");
  discordAuthUrl.searchParams.set("redirect_uri", redirectUri);
  discordAuthUrl.searchParams.set("scope", "identify email");
  discordAuthUrl.searchParams.set("state", state);
  discordAuthUrl.searchParams.set("prompt", "none");

  const headers = new Headers();
  headers.set("Location", discordAuthUrl.toString());
  headers.append(
    "Set-Cookie",
    `dlssdb_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );
  if (linkToken) {
    headers.append(
      "Set-Cookie",
      `dlssdb_link_token=${encodeURIComponent(linkToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    );
  }

  return new Response(null, {
    status: 302,
    headers,
  });
}

// GET /api/auth/discord/callback -> Exchanges code, links existing Admin/user or creates new user
export async function onRequestCallback(context) {
  const url = new URL(context.request.url);
  const origin = url.origin;

  try {
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      return Response.redirect(
        `${origin}/?auth_error=${encodeURIComponent(
          `Discord OAuth abgebrochen: ${errorParam}`
        )}#account`,
        302
      );
    }

    const code = url.searchParams.get("code");
    if (!code) {
      return Response.redirect(
        `${origin}/?auth_error=${encodeURIComponent("Kein OAuth-Code von Discord erhalten.")}#account`,
        302
      );
    }

    const clientId = (context.env.DISCORD_CLIENT_ID || "").trim();
    const clientSecret = (context.env.DISCORD_CLIENT_SECRET || "").trim();
    if (!clientId || !clientSecret) {
      return Response.redirect(
        `${origin}/?auth_error=DISCORD_NOT_CONFIGURED#account`,
        302
      );
    }

    const redirectUri = getRedirectUri(context.request.url, context.env);

    // 1. Exchange authorization code for access token
    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errTxt = await tokenRes.text();
      return Response.redirect(
        `${origin}/?auth_error=${encodeURIComponent(
          `Discord Token-Austausch fehlgeschlagen (${tokenRes.status}): ${errTxt.slice(0, 120)}`
        )}#account`,
        302
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. Fetch Discord user profile (@me)
    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userRes.ok) {
      return Response.redirect(
        `${origin}/?auth_error=${encodeURIComponent(
          "Discord Benutzerprofil konnte nicht geladen werden."
        )}#account`,
        302
      );
    }

    const discordUser = await userRes.json();
    const discordId = String(discordUser.id || "").trim();
    if (!discordId) {
      return Response.redirect(
        `${origin}/?auth_error=${encodeURIComponent("Ungültige Discord User ID.")}#account`,
        302
      );
    }

    const rawUsername = String(
      discordUser.username || discordUser.global_name || `discord_${discordId}`
    ).trim();
    const email = String(
      discordUser.email || `${discordId}@users.discord.com`
    )
      .trim()
      .toLowerCase();
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discordId) >> 22n) % 6}.png`;

    const db = context.env.DB;
    await ensureDbSchema(db);
    const now = new Date().toISOString();

    // Check if an already logged-in user initiated explicit account linking via ?link_token=...
    const cookies = parseCookies(context.request.headers.get("Cookie") || "");
    const linkToken = cookies.dlssdb_link_token || "";
    let user = null;

    if (linkToken) {
      user = await db
        .prepare(
          `SELECT u.id, u.username, u.email, u.discord_id, u.discord_avatar, u.role, u.api_key, u.api_key_created_at,
                  u.api_requests_count, u.last_api_access, u.is_active, u.created_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token = ?1 AND s.expires_at > ?2`
        )
        .bind(linkToken, now)
        .first();
    }

    // 3. Otherwise find existing user by discord_id, email, or username
    if (!user) {
      user = await db
        .prepare(
          `SELECT id, username, email, discord_id, discord_avatar, role, api_key, api_key_created_at,
                  api_requests_count, last_api_access, is_active, created_at
           FROM users
           WHERE discord_id = ?1 OR LOWER(email) = LOWER(?2) OR LOWER(username) = LOWER(?3)
           ORDER BY CASE WHEN discord_id = ?1 THEN 0 WHEN LOWER(email) = LOWER(?2) THEN 1 ELSE 2 END
           LIMIT 1`
        )
        .bind(discordId, email, rawUsername)
        .first();
    }

    // 4. Fallback for pre-existing Admin account (#1) that has no discord_id linked yet
    //    (e.g., if Admin's Discord email/username differs from the initially created Admin account)
    if (!user) {
      const unlinkedAdmin = await db
        .prepare(
          `SELECT id, username, email, discord_id, discord_avatar, role, api_key, api_key_created_at,
                  api_requests_count, last_api_access, is_active, created_at
           FROM users
           WHERE role = 'admin' AND (discord_id IS NULL OR discord_id = '')
           ORDER BY id ASC
           LIMIT 1`
        )
        .first();
      const totalUsersRow = await db.prepare("SELECT COUNT(*) as cnt FROM users").first();
      if (unlinkedAdmin && Number(totalUsersRow?.cnt || 0) === 1) {
        user = unlinkedAdmin;
      }
    }

    if (user) {
      if (Number(user.is_active) === 0) {
        return Response.redirect(
          `${origin}/?auth_error=${encodeURIComponent(
            "Dein Benutzerkonto wurde von einem Administrator gesperrt."
          )}#account`,
          302
        );
      }

      const updatedApiKey = user.api_key || generateApiKey();
      const updatedApiKeyCreated = user.api_key ? user.api_key_created_at : now;

      await db
        .prepare(
          `UPDATE users
           SET discord_id = ?1, discord_avatar = ?2, api_key = ?3, api_key_created_at = ?4
           WHERE id = ?5`
        )
        .bind(discordId, avatarUrl, updatedApiKey, updatedApiKeyCreated, user.id)
        .run();
    } else {
      // First registered user automatically becomes Admin
      const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM users").first();
      const isFirstUser = !countRow || Number(countRow.cnt) === 0;
      const role = isFirstUser ? "admin" : "user";

      // Ensure unique username
      let finalUsername = rawUsername;
      const nameTaken = await db
        .prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?1)")
        .bind(finalUsername)
        .first();
      if (nameTaken) {
        finalUsername = `${rawUsername}_${discordId.slice(-4)}`;
      }

      const apiKey = generateApiKey();
      const placeholderHash = await hashPassword(randomHex(24));

      const insertRes = await db
        .prepare(
          `INSERT INTO users (username, email, password_hash, discord_id, discord_avatar, role, api_key, api_key_created_at, api_requests_count, is_active, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 1, ?9)`
        )
        .bind(
          finalUsername,
          email,
          placeholderHash,
          discordId,
          avatarUrl,
          role,
          apiKey,
          now,
          now
        )
        .run();

      user = {
        id: insertRes.meta?.last_row_id,
      };
    }

    // 5. Create 30-day session token
    const sessionToken = `sess_${randomHex(28)}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db
      .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)")
      .bind(sessionToken, user.id, expiresAt)
      .run();

    const headers = new Headers();
    headers.set("Location", `${origin}/?discord_token=${encodeURIComponent(sessionToken)}#account`);
    headers.append(
      "Set-Cookie",
      "dlssdb_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    );
    headers.append(
      "Set-Cookie",
      "dlssdb_link_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    );

    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (err) {
    return Response.redirect(
      `${origin}/?auth_error=${encodeURIComponent(err.message || String(err))}#account`,
      302
    );
  }
}
