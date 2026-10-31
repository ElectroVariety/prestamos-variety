import { createClient } from "@supabase/supabase-js";

const BUCKET = "loan-private-documents";
const PAGE_SIZE = 50;
const origins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://electrovariety.github.io",
]);
const baseHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" };

function respond(body: Record<string, unknown>, status: number, origin: string) {
  const headers = new Headers(baseHeaders);
  if (origins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

type RejectionNotificationState = "not_eligible" | "pending" | "sending" | "sent" | "failed" | "unknown";

function normalizeWhatsAppRecipient(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.startsWith("549") && digits.length === 13) return digits;
  if (digits.startsWith("54") && digits.length === 12) digits = "549" + digits.slice(2);
  if (digits.length === 10) digits = "549" + digits;
  return /^549\d{10}$/.test(digits) ? digits : null;
}

async function sendRejectionNotification(
  admin: ReturnType<typeof createClient>,
  applicationId: string,
  expectedState: "pending" | "failed",
): Promise<{ status: RejectionNotificationState; error_code?: string }> {
  const { data: application, error: readError } = await admin
    .from("loan_applications")
    .select("id,status,phone,whatsapp_rejection_opt_in,whatsapp_rejection_status")
    .eq("id", applicationId)
    .maybeSingle();
  if (readError || !application) {
    console.error("No se pudo leer la solicitud para el aviso de rechazo.");
    return { status: "failed", error_code: "application_unavailable" };
  }
  if (application.status !== "rejected") {
    return { status: application.whatsapp_rejection_status, error_code: "not_rejected" };
  }
  if (!application.whatsapp_rejection_opt_in) {
    if (application.whatsapp_rejection_status === "pending") {
      await admin.from("loan_applications")
        .update({ whatsapp_rejection_status: "not_eligible", whatsapp_rejection_error_code: null })
        .eq("id", applicationId)
        .eq("whatsapp_rejection_status", "pending");
    }
    return { status: "not_eligible" };
  }
  if (application.whatsapp_rejection_status !== expectedState) {
    return { status: application.whatsapp_rejection_status };
  }

  const accessToken = Deno.env.get("WHATSAPP_CLOUD_API_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const templateName = Deno.env.get("WHATSAPP_REJECTION_TEMPLATE_NAME");
  const templateLanguage = Deno.env.get("WHATSAPP_REJECTION_TEMPLATE_LANGUAGE") ?? "es_AR";
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION");
  if (!accessToken || !phoneNumberId || !templateName || !graphVersion || !/^v\d+\.\d+$/.test(graphVersion)) {
    return { status: "pending", error_code: "not_configured" };
  }

  const { data: claim, error: claimError } = await admin.from("loan_applications")
    .update({ whatsapp_rejection_status: "sending", whatsapp_rejection_error_code: null })
    .eq("id", applicationId)
    .eq("status", "rejected")
    .eq("whatsapp_rejection_opt_in", true)
    .eq("whatsapp_rejection_status", expectedState)
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("No se pudo reservar el envío del aviso de rechazo:", claimError.message);
    return { status: "failed", error_code: "database_error" };
  }
  if (!claim) {
    const { data: current } = await admin.from("loan_applications")
      .select("whatsapp_rejection_status")
      .eq("id", applicationId)
      .maybeSingle();
    return { status: current?.whatsapp_rejection_status ?? "unknown" };
  }

  const recipient = normalizeWhatsAppRecipient(application.phone);
  if (!recipient) {
    await admin.from("loan_applications")
      .update({ whatsapp_rejection_status: "failed", whatsapp_rejection_error_code: "invalid_phone" })
      .eq("id", applicationId)
      .eq("whatsapp_rejection_status", "sending");
    return { status: "failed", error_code: "invalid_phone" };
  }

  let response: Response;
  let providerResult: Record<string, unknown> | null = null;
  try {
    response = await fetch("https://graph.facebook.com/" + graphVersion + "/" + phoneNumberId + "/messages", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage },
        },
      }),
    });
    providerResult = await response.json().catch(() => null);
  } catch {
    await admin.from("loan_applications")
      .update({ whatsapp_rejection_status: "unknown", whatsapp_rejection_error_code: "network_unknown" })
      .eq("id", applicationId)
      .eq("whatsapp_rejection_status", "sending");
    return { status: "unknown", error_code: "network_unknown" };
  }

  if (!response.ok) {
    const providerError = providerResult?.error as Record<string, unknown> | undefined;
    const providerCode = typeof providerError?.code === "number" || typeof providerError?.code === "string"
      ? String(providerError.code).slice(0, 40)
      : "provider_error";
    const { error: updateError } = await admin.from("loan_applications")
      .update({ whatsapp_rejection_status: "failed", whatsapp_rejection_error_code: providerCode })
      .eq("id", applicationId)
      .eq("whatsapp_rejection_status", "sending");
    if (updateError) console.error("No se pudo registrar el fallo del aviso de rechazo:", updateError.message);
    return { status: "failed", error_code: providerCode };
  }

  const messages = providerResult?.messages as Array<Record<string, unknown>> | undefined;
  const messageId = typeof messages?.[0]?.id === "string" ? messages[0].id : null;
  const sentAt = new Date().toISOString();
  const { error: sentUpdateError } = await admin.from("loan_applications")
    .update({
      whatsapp_rejection_status: "sent",
      whatsapp_rejection_sent_at: sentAt,
      whatsapp_rejection_message_id: messageId,
      whatsapp_rejection_error_code: null,
    })
    .eq("id", applicationId)
    .eq("whatsapp_rejection_status", "sending");
  if (sentUpdateError) {
    console.error("Meta aceptó el aviso, pero no se pudo registrar el resultado:", sentUpdateError.message);
    return { status: "unknown", error_code: "delivery_record_unknown" };
  }
  return { status: "sent" };
}


Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  if (request.method === "OPTIONS") {
    const headers = new Headers({ "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Max-Age": "86400", "Vary": "Origin" });
    if (origins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return respond({ error: "Método no permitido." }, 405, origin);
  if (!origins.has(origin)) return respond({ error: "Origen no autorizado." }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("LOAN_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !serviceKey) return respond({ error: "El servicio no está configurado." }, 500, origin);
  if (!token) return respond({ error: "Iniciá sesión para continuar." }, 401, origin);

  const authClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return respond({ error: "La sesión no es válida. Iniciá sesión nuevamente." }, 401, origin);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: access, error: accessError } = await admin.from("loan_admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (accessError) {
    console.error("No se pudo comprobar el acceso administrativo:", accessError.message);
    return respond({ error: "No se pudo comprobar tu autorización." }, 500, origin);
  }
  if (!access) return respond({ error: "Tu cuenta no tiene permiso para revisar solicitudes." }, 403, origin);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch { return respond({ error: "La solicitud no tiene un formato válido." }, 400, origin); }

  if (body.action === "decide") {
    const id = typeof body.application_id === "string" ? body.application_id : "";
    const status = body.status;
    if (!id || (status !== "approved" && status !== "rejected")) return respond({ error: "La decisión indicada no es válida." }, 400, origin);
    const rawNotes = body.admin_notes;
    if (rawNotes !== undefined && typeof rawNotes !== "string") return respond({ error: "La nota interna no es válida." }, 400, origin);
    const adminNotes = typeof rawNotes === "string" ? rawNotes.trim() : "";
    if (adminNotes.length > 2000) return respond({ error: "La nota interna no puede superar 2000 caracteres." }, 400, origin);

    const { data, error } = await admin.from("loan_applications")
      .update({
        status,
        decided_at: new Date().toISOString(),
        decided_by: authData.user.id,
        admin_notes: adminNotes || null,
      })
      .eq("id", id)
      .in("status", ["pending", "under_review"])
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("No se pudo actualizar la solicitud:", error.message);
      return respond({ error: "No se pudo actualizar la solicitud." }, 500, origin);
    }
    if (!data) return respond({ error: "La solicitud ya fue revisada o no existe. Actualizá el listado." }, 409, origin);
    if (status === "rejected") {
      const notification = await sendRejectionNotification(admin, id, "pending");
      return respond({ success: true, notification }, 200, origin);
    }
    return respond({ success: true }, 200, origin);
  }

  if (body.action === "retry_rejection_whatsapp") {
    const id = typeof body.application_id === "string" ? body.application_id : "";
    if (!id) return respond({ error: "La solicitud indicada no es válida." }, 400, origin);
    const { data: application, error } = await admin.from("loan_applications")
      .select("id,status,whatsapp_rejection_opt_in,whatsapp_rejection_status")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("No se pudo consultar el estado del aviso:", error.message);
      return respond({ error: "No se pudo consultar el estado del aviso." }, 500, origin);
    }
    if (!application || application.status !== "rejected") return respond({ error: "La solicitud no está rechazada." }, 409, origin);
    if (!application.whatsapp_rejection_opt_in) return respond({ success: true, notification: { status: "not_eligible" } }, 200, origin);
    if (application.whatsapp_rejection_status !== "pending" && application.whatsapp_rejection_status !== "failed") {
      return respond({ success: true, notification: { status: application.whatsapp_rejection_status } }, 200, origin);
    }
    const notification = await sendRejectionNotification(admin, id, application.whatsapp_rejection_status);
    return respond({ success: true, notification }, 200, origin);
  }

  if (body.action === "archive" || body.action === "unarchive") {
    const id = typeof body.application_id === "string" ? body.application_id : "";
    if (!id) return respond({ error: "La solicitud indicada no es válida." }, 400, origin);
    const isArchiving = body.action === "archive";
    let update = admin.from("loan_applications")
      .update(isArchiving
        ? { archived_at: new Date().toISOString(), archived_by: authData.user.id }
        : { archived_at: null, archived_by: null })
      .eq("id", id);
    update = isArchiving ? update.is("archived_at", null) : update.not("archived_at", "is", null);
    const { data, error } = await update.select("id").maybeSingle();
    if (error) {
      console.error("No se pudo actualizar el archivo de la solicitud:", error.message);
      return respond({ error: "No se pudo actualizar el archivo de la solicitud." }, 500, origin);
    }
    if (!data) return respond({ error: isArchiving
      ? "La solicitud ya está archivada o no existe. Actualizá el listado."
      : "La solicitud no está archivada o no existe. Actualizá el listado." }, 409, origin);
    return respond({ success: true }, 200, origin);
  }

  if (body.action === "delete") {
    const id = typeof body.application_id === "string" ? body.application_id : "";
    if (!id) return respond({ error: "La solicitud indicada no es válida." }, 400, origin);

    const { data: existing, error: existingError } = await admin.from("loan_applications")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (existingError) {
      console.error("No se pudo comprobar la solicitud a eliminar:", existingError.message);
      return respond({ error: "No se pudo comprobar la solicitud." }, 500, origin);
    }
    if (!existing) return respond({ error: "La solicitud no existe o ya fue eliminada." }, 404, origin);

    const { data: documents, error: documentsError } = await admin.from("loan_documents")
      .select("storage_path")
      .eq("application_id", id);
    if (documentsError) {
      console.error("No se pudieron localizar los documentos para eliminar:", documentsError.message);
      return respond({ error: "No se pudieron preparar los documentos para su eliminación." }, 500, origin);
    }

    const storagePaths = (documents ?? []).map((document) => document.storage_path);
    if (storagePaths.length > 0) {
      const { error: storageError } = await admin.storage.from(BUCKET).remove(storagePaths);
      if (storageError) {
        console.error("No se pudieron eliminar los documentos privados:", storageError.message);
        return respond({ error: "No se pudieron eliminar los documentos. La solicitud sigue guardada." }, 500, origin);
      }
    }

    const { data: deleted, error: deleteError } = await admin.from("loan_applications")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (deleteError) {
      console.error("No se pudo eliminar la solicitud:", deleteError.message);
      return respond({ error: "No se pudo eliminar la solicitud." }, 500, origin);
    }
    if (!deleted) return respond({ error: "La solicitud ya no está disponible." }, 404, origin);
    return respond({ success: true }, 200, origin);
  }

  if (body.action !== "list") return respond({ error: "La operación solicitada no es válida." }, 400, origin);
  const status = body.status;
  if (status !== "pending" && status !== "under_review" && status !== "approved" && status !== "rejected" && status !== "all" && status !== "archived") return respond({ error: "El filtro indicado no es válido." }, 400, origin);

  const rawOffset = body.offset === undefined ? 0 : Number(body.offset);
  if (!Number.isSafeInteger(rawOffset) || rawOffset < 0) return respond({ error: "La página solicitada no es válida." }, 400, origin);
  const offset = rawOffset;

  let query = admin.from("loan_applications")
    .select("*")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + PAGE_SIZE);
  if (status === "archived") query = query.not("archived_at", "is", null);
  else {
    query = query.is("archived_at", null);
    if (status !== "all") query = query.eq("status", status);
  }
  const { data: applications, error: listError } = await query;
  if (listError) {
    console.error("No se pudieron leer solicitudes:", listError.message);
    return respond({ error: "No se pudieron cargar las solicitudes. Verificá el esquema de loan_applications." }, 500, origin);
  }

  try {
    const pageApplications = applications ?? [];
    const hasMore = pageApplications.length > PAGE_SIZE;
    const results = await Promise.all(pageApplications.slice(0, PAGE_SIZE).map(async (application) => {
      const [incomeResult, docsResult] = await Promise.all([
        admin.from("loan_income_sources").select("*").eq("application_id", application.id),
        admin.from("loan_documents").select("id,document_type,storage_path,original_filename,file_size_bytes").eq("application_id", application.id),
      ]);
      if (incomeResult.error || docsResult.error) throw new Error("No se pudieron cargar los ingresos o los documentos asociados.");
      const documents = await Promise.all((docsResult.data ?? []).map(async (document) => {
        const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(document.storage_path, 300);
        if (error || !data) throw new Error("No se pudo preparar el acceso temporal a un documento.");
        return { id: document.id, document_type: document.document_type, original_filename: document.original_filename, file_size_bytes: document.file_size_bytes, signed_url: data.signedUrl };
      }));
      return { ...application, incomes: incomeResult.data ?? [], documents };
    }));
    return respond({ success: true, applications: results, has_more: hasMore, next_offset: offset + results.length }, 200, origin);
  }
  catch (error) {
    console.error("No se pudieron preparar las solicitudes:", error instanceof Error ? error.message : error);
    return respond({ error: "No se pudieron cargar los detalles y documentos." }, 500, origin);
  }
});
