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

function parseSettingsList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/\r?\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// POST /api/v1/games/report
// Allows any user with a valid personal API key (or active session) to report/submit scanned or manual games to D1.
// Manual reports require `works_status` ("works" = Geht, "broken" = Geht nicht); all other fields are optional.
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
    const isManualReport = source === "manual" || source === "user_report";
    const now = new Date().toISOString();

    // Load existing official game IDs & match names to avoid duplicates on auto_scan
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

    // Load existing submissions into a Map in 1 query (saves D1 reads & writes on Free Tier!)
    const { results: subRows } = await db
      .prepare("SELECT id, reports_count, payload_json FROM game_submissions")
      .all();
    const existingSubMap = new Map();
    for (const s of subRows || []) {
      existingSubMap.set(String(s.id).toLowerCase(), s);
    }

    let addedReports = 0;
    let updatedExisting = 0;

    for (const item of rawGames.slice(0, 100)) {
      const title = String(item.title || item.name || "").trim();
      if (!title || title.length < 2) continue;

      // Mandatory field for manual user reports: works_status ("works" or "broken")
      const rawStatus = String(item.works_status || "").trim().toLowerCase();
      if (isManualReport && !["works", "broken"].includes(rawStatus)) {
        return jsonResponse(
          {
            error:
              "Pflichtfeld fehlt: Bitte gib an, ob das Spiel geht (✅ Geht) oder nicht geht (❌ Geht nicht).",
          },
          400
        );
      }
      const worksStatus = rawStatus === "broken" ? "broken" : "works";

      const baseId = slugifyGameId(item.id, title);
      const appIds = Array.isArray(item.steam_app_ids)
        ? item.steam_app_ids.map(String).filter(Boolean)
        : item.app_id
        ? [String(item.app_id).trim()].filter(Boolean)
        : [];
      const exes = Array.isArray(item.match_executables)
        ? item.match_executables.map((x) => String(x).toLowerCase().trim()).filter(Boolean)
        : item.executable
        ? [String(item.executable).toLowerCase().trim()].filter(Boolean)
        : [];
      const techs = Array.isArray(item.supported_techs)
        ? item.supported_techs.map(String).filter(Boolean)
        : [];
      const launcher = String(item.launcher || "").trim();
      const notes = String(item.notes || "").trim();
      const userSettings = parseSettingsList(item.recommended_settings);
      const srPreset = item.recommended_sr_preset ? String(item.recommended_sr_preset).trim() : null;
      const rrPreset = item.recommended_rr_preset ? String(item.recommended_rr_preset).trim() : null;
      const fgPreset = item.recommended_fg_preset ? String(item.recommended_fg_preset).trim() : null;

      const existingOfficial =
        officialMap.get(baseId) ||
        officialMap.get(title.toLowerCase()) ||
        (appIds[0] ? officialMap.get(`appid:${appIds[0].toLowerCase()}`) : null);

      const defaultAnticheat =
        worksStatus === "broken"
          ? "blocked"
          : [
              "safe",
              "signed_only",
              "driver_override_only",
              "blocked",
            ].includes(item.anticheat_status)
          ? item.anticheat_status
          : existingOfficial?.anticheat_status || "safe";

      // If this is an automatic background scan ("auto_scan"), only report truly new games or missing techs
      // so we never waste Cloudflare D1 Free Tier writes!
      if (!isManualReport && existingOfficial) {
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

      // Skip auto_scan if already in game_submissions (zero D1 write cost for repeated scans!)
      if (!isManualReport && existingSubMap.has(baseId)) {
        continue;
      }

      const targetGameId = existingOfficial ? existingOfficial.id : baseId;
      const resolvedTechs =
        techs.length > 0
          ? techs
          : existingOfficial?.supported_techs?.length
          ? existingOfficial.supported_techs
          : ["DLSS"];
      const resolvedSettings =
        userSettings.length > 0
          ? userSettings
          : existingOfficial?.recommended_settings?.length
          ? existingOfficial.recommended_settings
          : resolvedTechs.includes("DLSS") && worksStatus === "works"
          ? ["Upscaling: NVIDIA DLSS Quality (Preset K)"]
          : [];

      const candidateProfile = {
        id: targetGameId,
        title: existingOfficial?.title || title,
        steam_app_ids:
          appIds.length > 0 ? appIds : existingOfficial?.steam_app_ids || [],
        match_names: Array.from(
          new Set([
            ...(existingOfficial?.match_names || []),
            title.toLowerCase(),
          ])
        ),
        match_executables:
          exes.length > 0 ? exes : existingOfficial?.match_executables || [],
        anticheat_status: defaultAnticheat,
        works_status: worksStatus,
        supported_techs: resolvedTechs,
        unsupported_techs: existingOfficial?.unsupported_techs || [],
        warning_banner:
          notes ||
          (worksStatus === "broken"
            ? `Community-Meldung (${user.username}): Funktioniert aktuell nicht / Probleme beim DLL-Tausch.`
            : existingOfficial?.warning_banner || null),
        recommended_sr_preset:
          srPreset ||
          existingOfficial?.recommended_sr_preset ||
          (resolvedTechs.includes("DLSS") && worksStatus === "works" ? "Preset K" : null),
        recommended_rr_preset:
          rrPreset ||
          existingOfficial?.recommended_rr_preset ||
          (resolvedTechs.includes("DLSS-RR") && worksStatus === "works" ? "Preset F" : null),
        recommended_fg_preset:
          fgPreset ||
          existingOfficial?.recommended_fg_preset ||
          (resolvedTechs.includes("DLSS-G") && worksStatus === "works" ? "Latest" : null),
        recommended_settings: resolvedSettings,
        launcher,
        source,
      };

      const settingsText = userSettings.join(" | ");
      const existingSub = existingSubMap.get(targetGameId);

      if (existingSub) {
        let mergedPayload = candidateProfile;
        try {
          const prev = JSON.parse(existingSub.payload_json);
          mergedPayload.supported_techs = Array.from(
            new Set([...(prev.supported_techs || []), ...resolvedTechs])
          );
          mergedPayload.steam_app_ids = Array.from(
            new Set([...(prev.steam_app_ids || []), ...candidateProfile.steam_app_ids])
          );
          mergedPayload.match_executables = Array.from(
            new Set([...(prev.match_executables || []), ...candidateProfile.match_executables])
          );
        } catch {}

        await db
          .prepare(
            `UPDATE game_submissions
             SET reports_count = reports_count + 1,
                 detected_techs = ?1,
                 works_status = ?2,
                 recommended_settings_text = COALESCE(NULLIF(?3, ''), recommended_settings_text),
                 notes = COALESCE(NULLIF(?4, ''), notes),
                 submitted_by_user_id = ?5,
                 submitted_by_username = ?6,
                 payload_json = ?7,
                 updated_at = ?8
             WHERE id = ?9`
          )
          .bind(
            mergedPayload.supported_techs.join(", "),
            worksStatus,
            settingsText,
            notes,
            user.id,
            user.username,
            JSON.stringify(mergedPayload),
            now,
            targetGameId
          )
          .run();
        addedReports++;
      } else {
        await db
          .prepare(
            `INSERT INTO game_submissions (
               id, title, steam_app_id, executable, detected_techs, launcher,
               works_status, recommended_settings_text, notes,
               submitted_by_user_id, submitted_by_username, reports_count,
               status, payload_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, 'pending', ?12, ?13, ?14)`
          )
          .bind(
            targetGameId,
            candidateProfile.title,
            candidateProfile.steam_app_ids.join(", "),
            candidateProfile.match_executables.join(", "),
            candidateProfile.supported_techs.join(", "),
            launcher,
            worksStatus,
            settingsText,
            notes,
            user.id,
            user.username,
            JSON.stringify(candidateProfile),
            now,
            now
          )
          .run();
        existingSubMap.set(targetGameId, {
          id: targetGameId,
          reports_count: 1,
          payload_json: JSON.stringify(candidateProfile),
        });
        addedReports++;
      }
    }

    if (updatedExisting > 0) {
      invalidateGamesMemoryCache();
    }

    return jsonResponse({
      message: isManualReport
        ? `✓ Deine Meldung wurde erfolgreich an die Datenbank gesendet!`
        : `${addedReports} neue(s) Spiel(e) gemeldet, ${updatedExisting} bestehende(s) Profil(e) ergänzt.`,
      reported_count: addedReports,
      updated_existing_count: updatedExisting,
      submitted_by: user.username,
    });
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}
