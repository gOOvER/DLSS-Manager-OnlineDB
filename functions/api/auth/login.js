import {
  ensureDbSchema,
  jsonResponse,
  optionsResponse,
  randomHex,
  verifyPassword,
} from "../../_shared/db.js";

export async function onRequestOptions() {
  return optionsResponse();
}

// POST /api/auth/login -> Allowed for existing Admin accounts so Admin is never locked out
export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    await ensureDbSchema(db);

    const body = await context.request.json();
    const loginInput = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!loginInput || !password) {
      return jsonResponse({ error: "Bitte Benutzername/E-Mail und Passwort eingeben." }, 400);
    }

    const user = await db
      .prepare(
        `SELECT id, username, email, password_hash, discord_id, discord_avatar, role,
                api_key, api_key_created_at, api_requests_count, last_api_access, is_active, created_at
         FROM users
         WHERE LOWER(username) = LOWER(?1) OR LOWER(email) = LOWER(?1)`
      )
      .bind(loginInput)
      .first();

    if (!user) {
      return jsonResponse({ error: "Ungültige Zugangsdaten." }, 401);
    }

    // Password login is exclusively reserved for existing Admin accounts; regular users must use Discord OAuth2
    if (user.role !== "admin") {
      return jsonResponse(
        {
          error:
            "Standard-Nutzer müssen sich über Discord anmelden. Passwort-Login ist nur für bestehende Administratoren aktiviert.",
        },
        403
      );
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return jsonResponse({ error: "Ungültige Zugangsdaten." }, 401);
    }

    if (Number(user.is_active) === 0) {
      return jsonResponse({ error: "Dieser Account ist gesperrt." }, 403);
    }

    const sessionToken = `sess_${randomHex(28)}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db
      .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)")
      .bind(sessionToken, user.id, expiresAt)
      .run();

    delete user.password_hash;
    return jsonResponse({
      token: sessionToken,
      user,
    });
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}
