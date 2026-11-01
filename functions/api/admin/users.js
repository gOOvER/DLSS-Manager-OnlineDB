import {
  ensureDbSchema,
  generateApiKey,
  getAuthenticatedUser,
  getDiscordCredentials,
  hashPassword,
  jsonResponse,
  optionsResponse,
} from "../../_shared/db.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    await ensureDbSchema(db);
    const admin = await getAuthenticatedUser(context.request, db);
    if (!admin || admin.role !== "admin") {
      return jsonResponse({ error: "Admin privileges required." }, 403);
    }

    const { results: users } = await db
      .prepare(
        `SELECT id, username, email, discord_id, discord_avatar, role, api_key, api_key_created_at,
                api_requests_count, last_api_access, is_active, created_at
         FROM users
         ORDER BY id ASC`
      )
      .all();

    const gamesCountRow = await db.prepare("SELECT COUNT(*) as cnt FROM games").first();
    const totalRequests = (users || []).reduce(
      (sum, u) => sum + Number(u.api_requests_count || 0),
      0
    );
    const discordCreds = await getDiscordCredentials(context.env, db);

    return jsonResponse({
      stats: {
        total_users: (users || []).length,
        active_keys: (users || []).filter((u) => u.api_key && Number(u.is_active) === 1).length,
        total_api_requests: totalRequests,
        total_games: Number(gamesCountRow?.cnt || 0),
      },
      discord_config: {
        client_id: discordCreds.clientId || "",
        has_secret: Boolean(discordCreds.clientSecret),
      },
      users: users || [],
    });
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    await ensureDbSchema(db);
    const admin = await getAuthenticatedUser(context.request, db);
    if (!admin || admin.role !== "admin") {
      return jsonResponse({ error: "Admin privileges required." }, 403);
    }

    const body = await context.request.json();
    const action = body.action;
    const targetId = Number(body.user_id);

    if (action === "save_discord_config") {
      const clientId = String(body.client_id || "").trim();
      const clientSecret = String(body.client_secret || "").trim();
      if (!clientId) {
        return jsonResponse({ error: "Discord Client ID darf nicht leer sein." }, 400);
      }
      const now = new Date().toISOString();
      await db
        .prepare(
          "INSERT INTO app_settings (key, value, updated_at) VALUES ('discord_client_id', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        )
        .bind(clientId, now)
        .run();

      if (clientSecret) {
        await db
          .prepare(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('discord_client_secret', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
          )
          .bind(clientSecret, now)
          .run();
      }
      return jsonResponse({
        message: "Discord OAuth2 Konfiguration in D1 gespeichert! Sofort aktiv ohne Cloudflare-Redeploy.",
      });
    }

    if (action === "create_user") {
      const username = String(body.username || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = body.role === "admin" ? "admin" : "user";

      if (username.length < 3 || !email.includes("@") || password.length < 6) {
        return jsonResponse({ error: "Invalid username, email, or password (min 6 chars)." }, 400);
      }
      const passwordHash = await hashPassword(password);
      const apiKey = generateApiKey();
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT INTO users (username, email, password_hash, role, api_key, api_key_created_at, api_requests_count, is_active, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7)`
        )
        .bind(username, email, passwordHash, role, apiKey, now, now)
        .run();

      return jsonResponse({ message: `User ${username} created with API key.` });
    }

    if (!targetId) {
      return jsonResponse({ error: "Missing user_id" }, 400);
    }

    if (action === "toggle_active") {
      if (targetId === Number(admin.id)) {
        return jsonResponse({ error: "You cannot suspend your own admin account." }, 400);
      }
      const row = await db
        .prepare("SELECT is_active FROM users WHERE id = ?1")
        .bind(targetId)
        .first();
      const nextState = row && Number(row.is_active) === 1 ? 0 : 1;
      await db
        .prepare("UPDATE users SET is_active = ?1 WHERE id = ?2")
        .bind(nextState, targetId)
        .run();
      return jsonResponse({
        message: nextState ? "User account re-activated." : "User account suspended.",
      });
    }

    if (action === "set_role") {
      if (targetId === Number(admin.id)) {
        return jsonResponse({ error: "You cannot demote your own admin account." }, 400);
      }
      const newRole = body.role === "admin" ? "admin" : "user";
      await db
        .prepare("UPDATE users SET role = ?1 WHERE id = ?2")
        .bind(newRole, targetId)
        .run();
      return jsonResponse({ message: `Updated user role to ${newRole}.` });
    }

    if (action === "regenerate_key") {
      const newKey = generateApiKey();
      const now = new Date().toISOString();
      await db
        .prepare("UPDATE users SET api_key = ?1, api_key_created_at = ?2 WHERE id = ?3")
        .bind(newKey, now, targetId)
        .run();
      return jsonResponse({ message: "Generated new API key for user.", api_key: newKey });
    }

    if (action === "revoke_key") {
      await db
        .prepare("UPDATE users SET api_key = NULL, api_key_created_at = NULL WHERE id = ?1")
        .bind(targetId)
        .run();
      return jsonResponse({ message: "Revoked user's API key." });
    }

    if (action === "delete_user") {
      if (targetId === Number(admin.id)) {
        return jsonResponse({ error: "You cannot delete your own admin account." }, 400);
      }
      await db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(targetId).run();
      await db.prepare("DELETE FROM users WHERE id = ?1").bind(targetId).run();
      return jsonResponse({ message: "User deleted." });
    }

    return jsonResponse({ error: "Unknown admin action" }, 400);
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}
