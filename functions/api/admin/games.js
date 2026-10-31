import {
  ensureDbSchema,
  getAuthenticatedUser,
  invalidateGamesMemoryCache,
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

    const { results } = await db
      .prepare("SELECT id, title, payload_json, updated_at, updated_by FROM games ORDER BY LOWER(title) ASC")
      .all();

    const games = (results || [])
      .map((r) => {
        try {
          return {
            ...JSON.parse(r.payload_json),
            _updated_at: r.updated_at,
            _updated_by: r.updated_by,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return jsonResponse({ games });
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
    const action = body.action || "upsert";

    if (action === "delete") {
      const gameId = String(body.id || "").trim();
      if (!gameId) return jsonResponse({ error: "Missing game id" }, 400);
      await db.prepare("DELETE FROM games WHERE id = ?1").bind(gameId).run();
      invalidateGamesMemoryCache();
      return jsonResponse({ message: `Deleted game profile '${gameId}'.` });
    }

    const game = body.game;
    if (!game || !game.id || !game.title) {
      return jsonResponse({ error: "Game profile requires 'id' and 'title'." }, 400);
    }

    const cleanId = String(game.id)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-");
    const entry = {
      id: cleanId,
      title: String(game.title).trim(),
      steam_app_ids: Array.isArray(game.steam_app_ids) ? game.steam_app_ids : [],
      match_names: Array.isArray(game.match_names)
        ? game.match_names
        : [String(game.title).toLowerCase()],
      match_executables: Array.isArray(game.match_executables) ? game.match_executables : [],
      anticheat_status: ["safe", "signed_only", "driver_override_only", "blocked"].includes(
        game.anticheat_status
      )
        ? game.anticheat_status
        : "safe",
      supported_techs: Array.isArray(game.supported_techs) ? game.supported_techs : ["DLSS"],
      unsupported_techs: Array.isArray(game.unsupported_techs) ? game.unsupported_techs : [],
      warning_banner: game.warning_banner ? String(game.warning_banner).trim() : null,
      recommended_sr_preset: game.recommended_sr_preset || null,
      recommended_rr_preset: game.recommended_rr_preset || null,
      recommended_fg_preset: game.recommended_fg_preset || null,
      recommended_settings: Array.isArray(game.recommended_settings)
        ? game.recommended_settings
        : [],
    };

    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT OR REPLACE INTO games (id, title, payload_json, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      .bind(entry.id, entry.title, JSON.stringify(entry), now, admin.username)
      .run();

    invalidateGamesMemoryCache();

    return jsonResponse({
      message: `Saved game profile '${entry.title}' (${entry.id}).`,
      game: entry,
    });
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}
