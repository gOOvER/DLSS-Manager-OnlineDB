import {
  ensureDbSchema,
  generateApiKey,
  hashPassword,
  jsonResponse,
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

// GET /api/auth/discord -> Redirects to Discord OAuth2 authorize URL
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

  const discordAuthUrl = new URL("https://discord.com/oauth2/authorize");
  discordAuthUrl.searchParams.set("client_id", clientId);
  discordAuthUrl.searchParams.set("response_type", "code");
  discordAuthUrl.searchParams.set("redirect_uri", redirectUri);
  discordAuthUrl.searchParams.set("scope", "identify email");
  discordAuthUrl.searchParams.set("state", state);
  discordAuthUrl.searchParams.set("prompt", "none");

  return new Response(null, {
    status: 302,
    headers: {
      Location: discordAuthUrl.toString(),
      "Set-Cookie": `dlssdb_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

// GET /api/auth/discord/callback -> Exchanges code, creates/updates user & API key, redirects with session token
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

    // 3. Find existing user by discord_id, email, or username (so existing Admin account links seamlessly)
    let user = await db
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

    const now = new Date().toISOString();

    if (user) {
      if (Number(user.is_active) === 0) {
        return Response.redirect(
          `${origin}/?auth_error=${encodeURIComponent(
            "Dein Benutzerkonto wurde von einem Administrator gesperrt."
          )}#account`,
          302
        );
      }

      // Ensure discord_id, discord_avatar, and api_key are populated
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

    // 4. Create 30-day session token
    const sessionToken = `sess_${randomHex(28)}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db
      .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)")
      .bind(sessionToken, user.id, expiresAt)
      .run();

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${origin}/?discord_token=${encodeURIComponent(sessionToken)}#account`,
        "Set-Cookie": "dlssdb_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      },
    });
  } catch (err) {
    return Response.redirect(
      `${origin}/?auth_error=${encodeURIComponent(err.message || String(err))}#account`,
      302
    );
  }
}
