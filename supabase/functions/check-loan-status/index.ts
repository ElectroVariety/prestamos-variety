import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://electrovariety.github.io",
]);

const baseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

function respond(body: Record<string, unknown>, status: number, origin: string) {
  const headers = new Headers(baseHeaders);
  if (allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

async function hashTrackingCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";

  if (request.method === "OPTIONS") {
    const headers = new Headers({
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    });
    if (allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") return respond({ success: false, error: "Método no permitido." }, 405, origin);
  if (!allowedOrigins.has(origin)) return respond({ success: false, error: "Origen no autorizado." }, 403, origin);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch {
    return respond({ success: false, error: "Ingresá un código válido." }, 400, origin);
  }

  const rawCode = typeof body.code === "string" ? body.code.trim().toUpperCase().replace(/[\s-]/g, "") : "";
  if (!/^PV[0-9A-F]{32}$/.test(rawCode)) {
    return respond({ success: false, error: "El código ingresado no es válido." }, 400, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("LOAN_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Faltan secretos de Supabase en la función de consulta.");
    return respond({ success: false, error: "El servicio no está disponible." }, 500, origin);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const trackingCodeHash = await hashTrackingCode(rawCode);
    const { data, error } = await admin.from("loan_applications")
      .select("status,created_at,decided_at")
      .eq("tracking_code_hash", trackingCodeHash)
      .maybeSingle();
    if (error) throw error;
    if (!data) return respond({ success: false, error: "No encontramos una solicitud con ese código. Revisalo e intentá nuevamente." }, 404, origin);

    return respond({
      success: true,
      status: data.status,
      created_at: data.created_at,
      decided_at: data.decided_at,
    }, 200, origin);
  } catch (error) {
    console.error("No se pudo consultar el estado:", error instanceof Error ? error.message : error);
    return respond({ success: false, error: "No se pudo consultar el estado. Intentá nuevamente más tarde." }, 500, origin);
  }
});
