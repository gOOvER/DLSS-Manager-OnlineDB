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

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    await ensureDbSchema(db);

    const body = await context.request.json();
    const login = String(body.username || body.email || "").trim();
    const password = String(body.password || "");

    if (!login || !password) {
      return jsonResponse({ error: "Username/Email and password are required." }, 400);
    }

    const user = await db
      .prepare(
        `SELECT id, username, email, password_hash, role, api_key, api_key_created_at,
                api_requests_count, last_api_access, is_active, created_at
         FROM users
         WHERE username = ?1 OR email = ?1`
      )
      .bind(login)
      .first();

    if (!user) {
      return jsonResponse({ error: "Invalid credentials." }, 401);
    }
    if (Number(user.is_active) === 0) {
      return jsonResponse({ error: "This account has been suspended by an administrator." }, 403);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return jsonResponse({ error: "Invalid credentials." }, 401);
    }

    const sessionToken = `sess_${randomHex(28)}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

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

