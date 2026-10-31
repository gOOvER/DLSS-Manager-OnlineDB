// Unified Cloudflare Worker Entrypoint for dlssdb.goover.dev (100% Cloudflare Free Tier)
// Routes /api/* requests to our D1 database handlers and serves static assets (index.html) for everything else.

import { optionsResponse, jsonResponse } from "../functions/_shared/db.js";
import * as registerHandler from "../functions/api/auth/register.js";
import * as loginHandler from "../functions/api/auth/login.js";
import * as meHandler from "../functions/api/auth/me.js";
import * as adminUsersHandler from "../functions/api/admin/users.js";
import * as adminGamesHandler from "../functions/api/admin/games.js";
import * as gamesJsonHandler from "../functions/api/v1/games.json.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    if (method === "OPTIONS" && path.startsWith("/api/")) {
      return optionsResponse();
    }

    const context = {
      request,
      env,
      waitUntil: (promise) => ctx.waitUntil(promise),
    };

    try {
      if (path === "/api/v1/games.json" || path === "/api/v1/games") {
        if (method === "GET") return await gamesJsonHandler.onRequestGet(context);
      }

      if (path === "/api/auth/register" && method === "POST") {
        return await registerHandler.onRequestPost(context);
      }

      if (path === "/api/auth/login" && method === "POST") {
        return await loginHandler.onRequestPost(context);
      }

      if (path === "/api/auth/me") {
        if (method === "GET") return await meHandler.onRequestGet(context);
        if (method === "POST") return await meHandler.onRequestPost(context);
      }

      if (path === "/api/admin/users") {
        if (method === "GET") return await adminUsersHandler.onRequestGet(context);
        if (method === "POST") return await adminUsersHandler.onRequestPost(context);
      }

      if (path === "/api/admin/games") {
        if (method === "GET") return await adminGamesHandler.onRequestGet(context);
        if (method === "POST") return await adminGamesHandler.onRequestPost(context);
      }

      if (path.startsWith("/api/")) {
        return jsonResponse({ error: `API route not found: ${method} ${path}` }, 404);
      }

      // Serve static frontend assets (index.html, etc.) via Cloudflare Workers Static Assets binding
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return new Response("DLSS-Manager-OnlineDB Worker is running.", { status: 200 });
    } catch (err) {
      return jsonResponse({ error: err.message || String(err) }, 500);
    }
  },
};
