import {
  ensureDbSchema,
  generateApiKey,
  getAuthenticatedUser,
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
    const user = await getAuthenticatedUser(context.request, db);
    if (!user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }
    return jsonResponse({ user });
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    await ensureDbSchema(db);
    const user = await getAuthenticatedUser(context.request, db);
    if (!user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const body = await context.request.json();
    const action = body.action;

    if (action === "generate_key") {
      const newKey = generateApiKey();
      const now = new Date().toISOString();
      await db
        .prepare("UPDATE users SET api_key = ?1, api_key_created_at = ?2 WHERE id = ?3")
        .bind(newKey, now, user.id)
        .run();
      user.api_key = newKey;
      user.api_key_created_at = now;
      return jsonResponse({
        message: "New personal API Key generated! Previous key has been invalidated.",
        user,
      });
    }

    if (action === "revoke_key") {
      await db
        .prepare("UPDATE users SET api_key = NULL, api_key_created_at = NULL WHERE id = ?1")
        .bind(user.id)
        .run();
      user.api_key = null;
      user.api_key_created_at = null;
      return jsonResponse({
        message: "API Key revoked.",
        user,
      });
    }

    if (action === "change_password") {
      const newPass = String(body.new_password || "");
      if (newPass.length < 6) {
        return jsonResponse({ error: "Password must be at least 6 characters." }, 400);
      }
      const newHash = await hashPassword(newPass);
      await db
        .prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2")
        .bind(newHash, user.id)
        .run();
      return jsonResponse({ message: "Password updated successfully." });
    }

    if (action === "logout") {
      const auth = context.request.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      await db.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
      return jsonResponse({ message: "Logged out." });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}

