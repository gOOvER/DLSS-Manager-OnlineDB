import { jsonResponse, optionsResponse } from "../../_shared/db.js";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost() {
  return jsonResponse(
    {
      error:
        "Die Anmeldung ist ausschließlich über Discord OAuth2 möglich (/api/auth/discord).",
    },
    403
  );
}
