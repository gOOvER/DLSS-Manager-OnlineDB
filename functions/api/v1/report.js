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

function slugifyGameId(rawId, rawTitle) {
  const base = String(rawId || rawTitle || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `game-${Date.now()}`;
}

function extractApiKey(request) {
  const headerKey = (request.headers.get("X-API-Key") || "").trim();
  if (headerKey) return headerKey;
  const auth = (request.headers.get("Authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token.startsWith("dlss_live_")) return token;
  }
  return "";
}

// POST /api/v1/games/report
// Allows any user with a valid personal API key (or active session) to report/submit scanned or manual games to D1.
export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    await ensureDbSchema(db);

    // Authenticate via X-API-Key or Bearer session token
    let user = null;
    const apiKey = extractApiKey(context.request);
    if (apiKey) {
      user = await db
        .prepare(
          "SELECT id, username, role, is_active FROM users WHERE api_key = ?1 LIMIT 1"
        )
        .bind(apiKey)
        .first();
      if (!user || Number(user.is_active) === 0) {
        return jsonResponse(
          { error: "Ungültiger oder gesperrter API Key." },
          401
        );
      }
    } else {
      user = await getAuthenticatedUser(context.request, db);
      if (!user) {
        return jsonResponse(
          {
            error:
              "Authentifizierung erforderlich. Bitte hinterlege deinen persönlichen API Key (dlss_live_...).",
          },
          401
        );
      }
    }

    const body = await context.request.json();
    const rawGames = Array.isArray(body.games)
      ? body.games
      : body.game
      ? [body.game]
      : [];

    if (rawGames.length === 0) {
      return jsonResponse({ error: "Keine Spieledaten zum Melden übergeben." }, 400);
    }

    const source = String(body.source || "manual").slice(0, 32);
    const now = new Date().toISOString();

    // Load existing official game IDs & match names to avoid duplicates
    const { results: officialRows } = await db
      .prepare("SELECT id, title, payload_json FROM games")
      .all();

    const officialMap = new Map();
    for (const r of officialRows || []) {
      try {
        const parsed = JSON.parse(r.payload_json);
        officialMap.set(r.id.toLowerCase(), parsed);
        officialMap.set(r.title.toLowerCase(), parsed);
        for (const mn of parsed.match_names || []) {
          officialMap.set(String(mn).toLowerCase(), parsed);
        }
        for (const aid of parsed.steam_app_ids || []) {
          officialMap.set(`appid:${String(aid).toLowerCase()}`, parsed);
        }
      } catch {
        // ignore
      }
    }

    let addedReports = 0;
    let updatedExisting = 0;
    let autoPublished = 0;

    for (const item of rawGames.slice(0, 100)) {
      const title = String(item.title || item.name || "").trim();
      if (!title || title.length < 2) continue;

      const id = slugifyGameId(item.id, title);
      const appIds = Array.isArray(item.steam_app_ids)
        ? item.steam_app_ids.map(String).filter(Boolean)
        : item.app_id
        ? [String(item.app_id)]
        : [];
      const exes = Array.isArray(item.match_executables)
        ? item.match_executables.map((x) => String(x).toLowerCase()).filter(Boolean)
        : item.executable
        ? [String(item.executable).toLowerCase()]
        : [];
      const techs = Array.isArray(item.supported_techs)
        ? item.supported_techs.map(String).filter(Boolean)
        : [];
      const launcher = String(item.launcher || "").trim();
      const notes = String(item.notes || "").trim();
      const anticheatStatus = [
        "safe",
        "signed_only",
        "driver_override_only",
        "blocked",
      ].includes(item.anticheat_status)
        ? item.anticheat_status
        : "safe";

      // Check if already in official games DB
      const existingOfficial =
        officialMap.get(id) ||
        officialMap.get(title.toLowerCase()) ||
        (appIds[0] ? officialMap.get(`appid:${appIds[0].toLowerCase()}`) : null);

      if (existingOfficial) {
        // Merge newly discovered techs or steam_app_ids into existing official game if missing
        let changed = false;
        const mergedTechs = new Set(existingOfficial.supported_techs || []);
        for (const t of techs) {
          if (t && !mergedTechs.has(t) && existingOfficial.anticheat_status !== "blocked") {
            mergedTechs.add(t);
            changed = true;
          }
        }
        const mergedAppIds = new Set(existingOfficial.steam_app_ids || []);
        for (const a of appIds) {
          if (a && !mergedAppIds.has(a)) {
            mergedAppIds.add(a);
            changed = true;
          }
        }
        if (changed) {
          existingOfficial.supported_techs = Array.from(mergedTechs);
          existingOfficial.steam_app_ids = Array.from(mergedAppIds);
          await db
            .prepare("UPDATE games SET payload_json = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(JSON.stringify(existingOfficial), now, existingOfficial.id)
            .run();
          updatedExisting++;
        }
        continue;
      }

      const candidateProfile = {
        id,
        title,
        steam_app_ids: appIds,
        match_names: [title.toLowerCase()],
        match_executables: exes,
        anticheat_status: anticheatStatus,
        supported_techs: techs.length > 0 ? techs : ["DLSS"],
        unsupported_techs: [],
        warning_banner: notes || null,
        recommended_sr_preset: techs.includes("DLSS") ? "Preset K" : null,
        recommended_rr_preset: techs.includes("DLSS-RR") ? "Preset F" : null,
        recommended_fg_preset: techs.includes("DLSS-G") ? "Latest" : null,
        recommended_settings: [
          ...(techs.includes("DLSS")
            ? ["Upscaling: NVIDIA DLSS Quality (Preset K)"]
            : []),
        ],
        launcher,
        source,
      };

      // Upsert into game_submissions table so Admin can review, or auto-publish if submitted by Admin
      const existingSub = await db
        .prepare("SELECT id, reports_count, payload_json FROM game_submissions WHERE id = ?1")
        .bind(id)
        .first();

      if (existingSub) {
        let mergedPayload = candidateProfile;
        try {
          const prev = JSON.parse(existingSub.payload_json);
          mergedPayload.supported_techs = Array.from(
            new Set([...(prev.supported_techs || []), ...techs])
          );
          mergedPayload.steam_app_ids = Array.from(
            new Set([...(prev.steam_app_ids || []), ...appIds])
          );
          mergedPayload.match_executables = Array.from(
            new Set([...(prev.match_executables || []), ...exes])
          );
        } catch {}

        await db
          .prepare(
            `UPDATE game_submissions
             SET reports_count = reports_count + 1,
                 detected_techs = ?1,
                 payload_json = ?2,
                 updated_at = ?3
             WHERE id = ?4`
          )
          .bind(
            mergedPayload.supported_techs.join(", "),
            JSON.stringify(mergedPayload),
            now,
            id
          )
          .run();
        addedReports++;
      } else {
        await db
          .prepare(
            `INSERT INTO game_submissions (
               id, title, steam_app_id, executable, detected_techs, launcher,
               notes, submitted_by_user_id, submitted_by_username, reports_count,
               status, payload_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 'pending', ?10, ?11, ?12)`
          )
          .bind(
            id,
            title,
            appIds.join(", "),
            exes.join(", "),
            candidateProfile.supported_techs.join(", "),
            launcher,
            notes,
            user.id,
            user.username,
            JSON.stringify(candidateProfile),
            now,
            now
          )
          .run();
        addedReports++;
      }
    }

    if (updatedExisting > 0 || autoPublished > 0) {
      invalidateGamesMemoryCache();
    }

    return jsonResponse({
      message: `${addedReports} neue(s) Spiel(e) gemeldet, ${updatedExisting} bestehende(s) Profil(e) ergänzt.`,
      reported_count: addedReports,
      updated_existing_count: updatedExisting,
      submitted_by: user.username,
    });
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}
