import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://electrovariety.github.io",
]);

const BUCKET = "loan-private-documents";
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 20;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
]);

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

function respond(
  body: Record<string, unknown>,
  status: number,
  origin = "",
) {
  const headers = new Headers(jsonHeaders);
  if (allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function textField(
  body: Record<string, unknown>,
  field: string,
  max = 200,
  required = false,
): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return required ? null : "";
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > max) return null;
  return cleaned;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function createTrackingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const canonical = Array.from(bytes, (byte) => alphabet[byte & 31]).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const groups = canonical.match(/.{1,3}/g) ?? [];
  return { code: groups.join("-"), hash };
}

function safeFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "documento";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "documento";
}

function documentType(fileKey: string): string | null {
  const known: Record<string, string> = {
    dni_front: "dni_front",
    dni_back: "dni_back",
    rental_contract: "rental_contract",
    utility_bill: "utility_bill",
    service_holder_dni_front: "service_holder_dni_front",
    service_holder_dni_back: "service_holder_dni_back",
    salary_receipt: "salary_receipt",
    wallet_statement: "wallet_statement",
    business_photos: "business_photo",
    business_video: "business_video",
  };
  if (known[fileKey]) return known[fileKey];
  if (fileKey.startsWith("income_proof_")) return "income_proof";
  return null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";

  if (req.method === "OPTIONS") {
    const headers = new Headers({
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    });
    if (allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") return respond({ error: "Método no permitido." }, 405, origin);
  if (!allowedOrigins.has(origin)) return respond({ error: "Origen no autorizado." }, 403);

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return respond({ error: "Se requiere un formulario multipart con los datos y documentos." }, 415, origin);
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return respond({ error: "La solicitud supera el tamaño máximo permitido." }, 413, origin);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return respond({ error: "No se pudo leer el formulario enviado." }, 400, origin);
  }

  const payloadRaw = form.get("payload");
  if (typeof payloadRaw !== "string" || new TextEncoder().encode(payloadRaw).length > 32_000) {
    return respond({ error: "Faltan los datos de la solicitud o son demasiado extensos." }, 400, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(payloadRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch {
    return respond({ error: "Los datos de la solicitud no tienen un formato válido." }, 400, origin);
  }
  const trackingCodeRequested = body.tracking_code_requested === true;
  if (body.tracking_code_requested !== undefined && typeof body.tracking_code_requested !== "boolean") {
    return respond({ error: "La opción del código de seguimiento no es válida." }, 400, origin);
  }

  const fullName = textField(body, "full_name", 150, true);
  const dniRaw = textField(body, "dni", 20, true);
  const phone = textField(body, "phone", 40, true);
  const rawHasReferrer = body.has_referrer;
  const hasReferrer = rawHasReferrer === true;
  if (rawHasReferrer !== undefined && typeof rawHasReferrer !== "boolean") {
    return respond({ error: "La respuesta sobre la recomendación no es válida." }, 400, origin);
  }
  const isElectroVarietyClient = body.is_electro_variety_client;
  if (typeof isElectroVarietyClient !== "boolean") {
    return respond({ error: "Indicá si sos cliente de Electro Variety." }, 400, origin);
  }
  const referrerFullName = textField(body, "referrer_full_name", 150, hasReferrer);
  const referrerPhone = textField(body, "referrer_phone", 40, hasReferrer);
  const referrerRelationship = textField(body, "referrer_relationship", 100, hasReferrer);
  const address = textField(body, "address", 200, true);
  const locality = textField(body, "locality", 120, true);
  const loanPurpose = textField(body, "loan_purpose", 1000, true);
  const alternatePhone = textField(body, "alternate_phone", 40);
  const alternateRelationship = textField(body, "alternate_phone_relationship", 100, true);
  const betweenStreets = textField(body, "between_streets", 200, true);
  const housingType = textField(body, "housing_type", 30, true);
  const serviceHolderName = textField(body, "service_holder_name", 150);
  const serviceHolderDni = textField(body, "service_holder_dni", 20);
  const serviceHolderRelationship = textField(body, "service_holder_relationship", 100);
  const debtReason = textField(body, "debt_reason", 1000);
  const serviceTypes = body.service_types;
  const hasDebts = body.has_debts;
  const serviceOwner = body.service_owner;
  const privacyAccepted = body.privacy_accepted;
  const rawWhatsAppRejectionOptIn = body.whatsapp_rejection_opt_in;
  const whatsappRejectionOptIn = rawWhatsAppRejectionOptIn === true;
  if (rawWhatsAppRejectionOptIn !== undefined && typeof rawWhatsAppRejectionOptIn !== "boolean") return respond({ error: "La opción de WhatsApp no es válida." }, 400, origin);
  const dniUpdated = body.dni_updated;
  const loanAmount = numberField(body.loan_amount);
  const loanFrequency = textField(body, "loan_frequency", 20);
  const installmentCount = numberField(body.installment_count);
  const installmentAmount = numberField(body.installment_amount);
  const totalToPay = numberField(body.total_to_pay);
  const debtAmount = body.debt_amount == null || body.debt_amount === ""
    ? null
    : numberField(body.debt_amount);

  if (!fullName || !dniRaw || !phone || !address || !locality || !loanPurpose ||
      alternatePhone === null || !alternateRelationship || !betweenStreets ||
      !housingType || serviceHolderName === null || serviceHolderDni === null ||
      serviceHolderRelationship === null || debtReason === null ||
      referrerFullName === null || referrerPhone === null ||
      referrerRelationship === null) {
    return respond({ error: "Hay campos obligatorios vacíos o con formato incorrecto." }, 400, origin);
  }
  if (hasReferrer && (!referrerFullName || !referrerPhone || !referrerRelationship)) {
    return respond({ error: "Completá el nombre, el teléfono y el vínculo con quien te recomendó." }, 400, origin);
  }

  const dni = dniRaw.replace(/\D/g, "");
  if (!/^\d{7,8}$/.test(dni)) return respond({ error: "El DNI no tiene un formato válido." }, 400, origin);
  if (typeof dniUpdated !== "boolean") return respond({ error: "Indicá si el DNI está actualizado." }, 400, origin);

  if (loanAmount === null || !Number.isInteger(loanAmount) || loanAmount < 100_000 ||
      loanAmount > 1_000_000 || loanAmount % 100_000 !== 0) {
    return respond({ error: "El monto solicitado no es válido." }, 400, origin);
  }

  const serverPlans: Record<number, Record<string, { count: number; amount: number }>> = {
    100000: { weekly: { count: 20, amount: 12000 }, fortnightly: { count: 10, amount: 23000 }, monthly: { count: 5, amount: 45000 } },
    200000: { weekly: { count: 20, amount: 23000 }, fortnightly: { count: 10, amount: 45000 }, monthly: { count: 5, amount: 90000 } },
    300000: { weekly: { count: 20, amount: 34000 }, fortnightly: { count: 10, amount: 68000 }, monthly: { count: 5, amount: 135000 } },
    400000: { weekly: { count: 20, amount: 45000 }, fortnightly: { count: 10, amount: 90000 }, monthly: { count: 5, amount: 180000 } },
    500000: { weekly: { count: 20, amount: 57000 }, fortnightly: { count: 10, amount: 113000 }, monthly: { count: 5, amount: 225000 } },
    600000: { weekly: { count: 20, amount: 68000 }, fortnightly: { count: 10, amount: 135000 }, monthly: { count: 5, amount: 270000 } },
    700000: { weekly: { count: 20, amount: 79000 }, fortnightly: { count: 10, amount: 158000 }, monthly: { count: 5, amount: 315000 } },
    800000: { weekly: { count: 20, amount: 90000 }, fortnightly: { count: 10, amount: 180000 }, monthly: { count: 5, amount: 360000 } },
    900000: { weekly: { count: 20, amount: 102000 }, fortnightly: { count: 10, amount: 203000 }, monthly: { count: 5, amount: 405000 } },
    1000000: { weekly: { count: 20, amount: 113000 }, fortnightly: { count: 10, amount: 225000 }, monthly: { count: 5, amount: 450000 } },
  };
  const expectedPlan = serverPlans[loanAmount]?.[String(loanFrequency)];
  const expectedCount = expectedPlan?.count ?? 0;
  const expectedInstallment = expectedPlan?.amount ?? 0;
  if (!expectedCount || installmentCount !== expectedCount ||
      installmentAmount !== expectedInstallment ||
      totalToPay !== installmentAmount * installmentCount) {
    return respond({ error: "Los datos del simulador no coinciden con el plan seleccionado." }, 400, origin);
  }

  if (!["own", "rent_contract", "rent_verbal"].includes(housingType)) {
    return respond({ error: "El tipo de vivienda no es válido." }, 400, origin);
  }
  if (typeof hasDebts !== "boolean" || privacyAccepted !== true) {
    return respond({ error: "Falta completar una opción obligatoria o aceptar el aviso de privacidad." }, 400, origin);
  }
  if (!Array.isArray(serviceTypes) || serviceTypes.length < 1 || !serviceTypes.every((v) =>
    typeof v === "string" && ["edesur", "metrogas", "water", "other", "internet", "mobile", "none"].includes(v))) {
    return respond({ error: "Los servicios seleccionados no son válidos." }, 400, origin);
  }
  if (new Set(serviceTypes).size !== serviceTypes.length ||
      (serviceTypes.includes("none") && serviceTypes.length > 1)) {
    return respond({ error: "La selección de servicios no es válida." }, 400, origin);
  }
  const hasService = serviceTypes.some((s) => s !== "none");
  if ((hasService && typeof serviceOwner !== "boolean") || (!hasService && serviceOwner !== null)) {
    return respond({ error: "Indicá correctamente quién es titular del servicio." }, 400, origin);
  }
  if (serviceOwner === false && (!serviceHolderName || !/^\d{7,8}$/.test(serviceHolderDni.replace(/\D/g, "")) || !serviceHolderRelationship)) {
    return respond({ error: "Completá los datos del titular del servicio." }, 400, origin);
  }
  if (hasDebts && (debtAmount === null || debtAmount < 0 || !debtReason)) {
    return respond({ error: "Completá los datos de las deudas." }, 400, origin);
  }
  if (!hasDebts && (debtReason || debtAmount !== null)) {
    return respond({ error: "No envíes datos de deuda si indicaste que no tenés deudas." }, 400, origin);
  }

  const incomeSources = body.income_sources;
  const validIncomeTypes = new Set(["formal_employment", "informal_employment", "self_employed", "business", "allowance", "retirement", "pension", "cooperative", "other"]);
  if (!Array.isArray(incomeSources) || incomeSources.length < 1 || incomeSources.length > 9) {
    return respond({ error: "Seleccioná al menos una fuente de ingresos." }, 400, origin);
  }

  const normalizedSources: Record<string, unknown>[] = [];
  for (const item of incomeSources) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return respond({ error: "Una fuente de ingresos no es válida." }, 400, origin);
    }
    const source = item as Record<string, unknown>;
    const sourceType = source.source_type;
    const monthlyIncome = numberField(source.monthly_income);
    if (typeof sourceType !== "string" || !validIncomeTypes.has(sourceType) ||
        monthlyIncome === null || monthlyIncome < 0) {
      return respond({ error: "Revisá el tipo y el monto de tus ingresos." }, 400, origin);
    }
    const activityDescription = textField(source, "activity_description", 1000);
    const walletProvider = textField(source, "wallet_provider", 100);
    const benefitName = textField(source, "benefit_name", 150);
    const businessName = textField(source, "business_name", 150);
    const businessAddress = textField(source, "business_address", 200);
    const businessDuration = textField(source, "business_duration", 100);
    const businessRevenue = source.business_revenue == null || source.business_revenue === "" ? null : numberField(source.business_revenue);
    const businessProfit = source.business_profit == null || source.business_profit === "" ? null : numberField(source.business_profit);
    if (activityDescription === null || walletProvider === null || benefitName === null ||
        businessName === null || businessAddress === null || businessDuration === null ||
        (source.business_revenue != null && source.business_revenue !== "" && (businessRevenue === null || businessRevenue < 0)) ||
        (source.business_profit != null && source.business_profit !== "" && (businessProfit === null || businessProfit < 0))) {
      return respond({ error: "Hay datos de ingresos con formato incorrecto." }, 400, origin);
    }
    if (sourceType === "business" && (!businessName || !businessAddress || !businessDuration || businessRevenue === null || businessProfit === null || !activityDescription)) {
      return respond({ error: "Completá todos los datos del comercio." }, 400, origin);
    }
    if (sourceType === "self_employed" && !activityDescription) return respond({ error: "Indicá tu actividad independiente." }, 400, origin);
    if (sourceType === "informal_employment" && !walletProvider) return respond({ error: "Indicá la billetera virtual utilizada." }, 400, origin);
    normalizedSources.push({
      source_type: sourceType,
      monthly_income: monthlyIncome,
      activity_description: activityDescription,
      wallet_provider: walletProvider,
      benefit_name: benefitName,
      business_name: businessName,
      business_address: businessAddress,
      business_duration: businessDuration,
      business_revenue: businessRevenue,
      business_profit: businessProfit,
    });
  }

  // Leer y validar todos los archivos antes de crear registros.
  const files: { key: string; index: number; file: File; type: string }[] = [];
  let totalBytes = 0;
  for (const [key, value] of form.entries()) {
    if (key === "payload") continue;
    const match = /^file:([a-zA-Z0-9_-]+):(\d+)$/.exec(key);
    if (!match || !(value instanceof File)) return respond({ error: "Se recibió un campo de archivo inválido." }, 400, origin);
    const type = documentType(match[1]);
    if (!type) return respond({ error: "Se recibió un tipo de documento no permitido." }, 400, origin);
    if (value.size <= 0 || value.size > MAX_FILE_BYTES || !ALLOWED_MIME.has(value.type)) {
      return respond({ error: `El archivo "${safeFilename(value.name)}" está vacío, supera 5 MB o tiene un formato no permitido.` }, 400, origin);
    }
    totalBytes += value.size;
    files.push({ key: match[1], index: Number(match[2]), file: value, type });
  }
  if (files.length > MAX_FILES || totalBytes > MAX_REQUEST_BYTES) {
    return respond({ error: "La cantidad o el tamaño total de los archivos supera el límite permitido." }, 413, origin);
  }

  const fileKeys = new Set(files.map((f) => f.key));
  const requiredFiles = ["dni_front", "dni_back"];
  if (housingType === "rent_contract") requiredFiles.push("rental_contract");
  if (hasService) requiredFiles.push("utility_bill");
  if (serviceOwner === false) requiredFiles.push("service_holder_dni_front", "service_holder_dni_back");
  if (normalizedSources.some((s) => s.source_type === "formal_employment")) requiredFiles.push("salary_receipt");
  if (normalizedSources.some((s) => s.source_type === "informal_employment")) requiredFiles.push("wallet_statement");
  for (const s of normalizedSources) {
    if (["allowance", "retirement", "pension", "cooperative"].includes(String(s.source_type))) {
      const uiType = ({ allowance: "allowance", retirement: "retirement", pension: "pension", cooperative: "cooperative" } as Record<string, string>)[String(s.source_type)];
      requiredFiles.push(`income_proof_${uiType}`);
    }
  }
  if (requiredFiles.some((key) => !fileKeys.has(key))) {
    return respond({ error: "Falta adjuntar uno o más documentos obligatorios." }, 400, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("LOAN_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Faltan secretos de Supabase en la función.");
    return respond({ error: "El servicio no está configurado correctamente." }, 500, origin);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const application = {
    whatsapp_rejection_opt_in: whatsappRejectionOptIn,
    whatsapp_rejection_opt_in_at: whatsappRejectionOptIn ? new Date().toISOString() : null,
    whatsapp_rejection_consent_version: whatsappRejectionOptIn ? "20261029-v2" : null,
    whatsapp_rejection_status: whatsappRejectionOptIn ? "pending" : "not_eligible",
    full_name: fullName,
    dni,
    dni_updated: dniUpdated,
    phone,
    has_referrer: hasReferrer,
    is_electro_variety_client: isElectroVarietyClient,
    referrer_full_name: hasReferrer ? referrerFullName : null,
    referrer_phone: hasReferrer ? referrerPhone : null,
    referrer_relationship: hasReferrer ? referrerRelationship : null,
    alternate_phone: alternatePhone,
    alternate_phone_relationship: alternateRelationship,
    address,
    between_streets: betweenStreets,
    locality,
    housing_type: housingType,
    has_service_in_own_name: hasService ? serviceOwner === true : false,
    service_types: serviceTypes,
    service_holder_name: serviceOwner === false ? serviceHolderName : "",
    service_holder_dni: serviceOwner === false ? serviceHolderDni.replace(/\D/g, "") : "",
    service_holder_relationship: serviceOwner === false ? serviceHolderRelationship : "",
    has_debts: hasDebts,
    debt_reason: hasDebts ? debtReason : "",
    debt_amount: hasDebts ? debtAmount : null,
    loan_amount: loanAmount,
    loan_frequency: loanFrequency,
    installment_count: installmentCount,
    installment_amount: installmentAmount,
    total_to_pay: totalToPay,
    loan_purpose: loanPurpose,
    privacy_accepted: true,
    status: "pending",
  };

  let applicationId: string | null = null;
  const uploadedPaths: string[] = [];
  try {
    const tracking = trackingCodeRequested ? await createTrackingCode() : null;
    const { data: saved, error: appError } = await supabase
      .from("loan_applications").insert({ ...application, tracking_code_hash: tracking?.hash ?? null }).select("id").single();
    if (appError?.code === "P0001" && appError.message === "DNI_APPLICATION_PREVIOUSLY_REJECTED") {
      return respond({
        success: false,
        error: "La solicitud anterior con este DNI fue rechazada. No es posible enviar otra solicitud.",
      }, 409, origin);
    }
    if (appError?.code === "P0001" && appError.message === "DNI_PENDING_APPLICATION_EXISTS") {
      return respond({
        success: false,
        error: "Ya tenés una solicitud pendiente con este DNI. Esperá a que la revisemos antes de enviar otra.",
      }, 409, origin);
    }
    if (appError || !saved) throw new Error(`No se pudo guardar la solicitud: ${appError?.message ?? "sin ID"}`);
    applicationId = String(saved.id);

    const sourceRows = normalizedSources.map((source) => ({ ...source, application_id: applicationId }));
    const { error: sourcesError } = await supabase.from("loan_income_sources").insert(sourceRows);
    if (sourcesError) throw new Error(`No se pudieron guardar los ingresos: ${sourcesError.message}`);

    const documentRows: Record<string, unknown>[] = [];
    for (const item of files) {
      const path = `${applicationId}/${crypto.randomUUID()}-${safeFilename(item.file.name)}`;
      const bytes = await item.file.arrayBuffer();
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: item.file.type,
        upsert: false,
      });
      if (uploadError) throw new Error(`No se pudo guardar un documento: ${uploadError.message}`);
      uploadedPaths.push(path);
      documentRows.push({
        application_id: applicationId,
        document_type: item.type,
        storage_path: path,
        original_filename: safeFilename(item.file.name),
        mime_type: item.file.type,
        file_size_bytes: item.file.size,
      });
    }

    if (documentRows.length) {
      const { error: docsError } = await supabase.from("loan_documents").insert(documentRows);
      if (docsError) throw new Error(`No se pudieron registrar los documentos: ${docsError.message}`);
    }

    return respond({
      success: true,
      message: "La solicitud y sus documentos se guardaron correctamente.",
      application_id: applicationId,
      ...(tracking ? { tracking_code: tracking.code } : {}),
    }, 201, origin);
  } catch (error) {
    console.error("Error procesando solicitud:", error instanceof Error ? error.message : error);
    if (uploadedPaths.length) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove(uploadedPaths);
      if (removeError) console.error("No se pudieron eliminar todos los archivos cargados:", removeError.message);
    }
    if (applicationId) {
      const { error: deleteError } = await supabase.from("loan_applications").delete().eq("id", applicationId);
      if (deleteError) console.error("No se pudo eliminar la solicitud incompleta:", deleteError.message);
    }
    return respond({ error: "No se pudo completar el envío. No se confirmó la solicitud; revisá los datos e intentá nuevamente." }, 500, origin);
  }
});
