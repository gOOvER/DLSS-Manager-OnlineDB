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

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    await ensureDbSchema(db);

    const body = await context.request.json();
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (username.length < 3 || username.length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return jsonResponse(
        { error: "Username must be 3–32 characters (letters, numbers, _, ., -)." },
        400
      );
    }
    if (!email.includes("@") || email.length < 5) {
      return jsonResponse({ error: "Please provide a valid email address." }, 400);
    }
    if (password.length < 6) {
      return jsonResponse({ error: "Password must be at least 6 characters long." }, 400);
    }

    const existing = await db
      .prepare("SELECT id FROM users WHERE username = ?1 OR email = ?2")
      .bind(username, email)
      .first();
    if (existing) {
      return jsonResponse({ error: "Username or email is already registered." }, 409);
    }

    // First registered user automatically becomes Admin!
    const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM users").first();
    const isFirstUser = !countRow || Number(countRow.cnt) === 0;
    const role = isFirstUser ? "admin" : "user";

    const passwordHash = await hashPassword(password);
    const apiKey = generateApiKey();
    const now = new Date().toISOString();

    const insertRes = await db
      .prepare(
        `INSERT INTO users (username, email, password_hash, role, api_key, api_key_created_at, api_requests_count, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7)`
      )
      .bind(username, email, passwordHash, role, apiKey, now, now)
      .run();

    const userId = insertRes.meta?.last_row_id;
    const sessionToken = `sess_${randomHex(28)}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    await db
      .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)")
      .bind(sessionToken, userId, expiresAt)
      .run();

    return jsonResponse({
      token: sessionToken,
      user: {
        id: userId,
        username,
        email,
        role,
        api_key: apiKey,
        api_key_created_at: now,
        api_requests_count: 0,
        last_api_access: null,
        is_active: 1,
        created_at: now,
      },
    });
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}

