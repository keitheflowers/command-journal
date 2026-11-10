// The Family Save: Vector AI proxy (Supabase Edge Function, Deno).
// Phones send their Claude request here with the signed-in user's token.
// This function checks they belong to a family, applies a daily limit, and
// forwards the request to Anthropic with the server's API key, so no key
// lives on anyone's phone.
//
// Deploy:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          supabase functions deploy claude-proxy
// Optional secrets: AI_DAILY_LIMIT (default 200 requests per user per day),
//                   ALLOWED_ORIGIN (e.g. https://you.github.io; default *).
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16000;
const LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "200");
const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": req.headers.get("access-control-request-headers") ??
      "authorization, apikey, content-type, anthropic-version, anthropic-beta, x-api-key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// Errors use Anthropic's error shape so the app's SDK explains them.
function fail(req: Request, status: number, type: string, message: string) {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: { ...cors(req), "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "invalid_request_error", "Use POST.");

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return fail(req, 500, "api_error", "The server has no ANTHROPIC_API_KEY set.");

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return fail(req, 401, "authentication_error", "Sign in to use Vector AI.");

  const { count } = await sb.from("members").select("user_id", { count: "exact", head: true }).eq("user_id", user.id);
  if (!count) return fail(req, 403, "permission_error", "Create or join a family to use Vector AI.");

  const { data: used, error: usageErr } = await sb.rpc("bump_ai_usage");
  if (usageErr) return fail(req, 500, "api_error", "Could not check today's AI usage.");
  if (Number(used) > LIMIT) return fail(req, 429, "rate_limit_error", `Daily Vector AI limit reached (${LIMIT}). Try again tomorrow.`);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(req, 400, "invalid_request_error", "Request body must be JSON.");
  }
  // Only the app's model, and a bounded response size.
  body.model = MODEL;
  body.max_tokens = Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS);
  delete body.stream;

  const headers: Record<string, string> = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  const beta = req.headers.get("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors(req), "content-type": "application/json" },
  });
});
