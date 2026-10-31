import {
  ensureDbSchema,
  getCachedGamesPayload,
  jsonResponse,
  optionsResponse,
  SEED_GAMES,
} from "../../_shared/db.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  try {
    const req = context.request;
    const url = new URL(req.url);
    const db = context.env.DB;

    // Extract API Key from X-API-Key, Authorization: Bearer, or ?api_key=
    const authHeader = req.headers.get("Authorization") || "";
    const bearerKey = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const headerKey = (req.headers.get("X-API-Key") || "").trim();
    const queryKey = (url.searchParams.get("api_key") || "").trim();
    const apiKey = headerKey || bearerKey || queryKey;

    const isWebPreview = url.searchParams.get("web_preview") === "1";

    if (!db) {
      if (!isWebPreview && !apiKey) {
        return jsonResponse(
          {
            error:
              "API Key required. Register and create your personal API Key at https://dlssdb.goover.dev",
          },
          401
        );
      }
      return jsonResponse({
        schema_version: 1,
        updated_at: new Date().toISOString(),
        games: SEED_GAMES,
      });
    }

    await ensureDbSchema(db);

    if (!isWebPreview) {
      if (!apiKey || !apiKey.startsWith("dlss_")) {
        return jsonResponse(
          {
            error:
              "Missing or invalid DLSS-DB API Key. Create your personal API Key at https://dlssdb.goover.dev",
          },
          401
        );
      }

      // Indexed 1-row lookup on idx_users_api_key (Cloudflare D1 Free Tier friendly)
      const keyOwner = await db
        .prepare("SELECT id, is_active FROM users WHERE api_key = ?1")
        .bind(apiKey)
        .first();

      if (!keyOwner) {
        return jsonResponse(
          {
            error:
              "Invalid or revoked API Key. Please generate a new API Key at https://dlssdb.goover.dev",
          },
          401
        );
      }

      if (Number(keyOwner.is_active) === 0) {
        return jsonResponse(
          { error: "This account and API Key have been suspended." },
          403
        );
      }

      const now = new Date().toISOString();
      context.waitUntil(
        db
          .prepare(
            "UPDATE users SET api_requests_count = api_requests_count + 1, last_api_access = ?1 WHERE id = ?2"
          )
          .bind(now, keyOwner.id)
          .run()
      );
    }

    const payload = await getCachedGamesPayload(db);
    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}
