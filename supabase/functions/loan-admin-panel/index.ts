import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "loan-private-documents";
const PAGE_SIZE = 250;
const RED_ZONES_KML_URL = "https://www.google.com/maps/d/kml?forcekml=1&mid=1ZVh-1tRfDFTc4O1eITKjEkASCXFQExtL";
const GEOREF_ADDRESS_URL = "https://apis.datos.gob.ar/georef/api/v2.0/direcciones";
const origins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://electrovariety.github.io",
]);
const baseHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" };

type Ring = Array<[number, number]>;
type RedPolygon = { outer: Ring; holes: Ring[] };
type AddressZoneResult = {
  address: string;
  locality: string;
  normalized_address: string;
  latitude: number;
  longitude: number;
  inside_red_zone: boolean;
  matching_polygons: number;
  approximate: true;
  queried_at: string;
  source: "Georef Argentina";
};

let redPolygonCache: { expiresAt: number; polygons: RedPolygon[] } | null = null;

function xmlAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function kmlColorIsRed(color: string | null): boolean {
  if (!color || !/^[0-9a-f]{8}$/i.test(color)) return false;
  // KML colors use AABBGGRR order.
  const blue = Number.parseInt(color.slice(2, 4), 16);
  const green = Number.parseInt(color.slice(4, 6), 16);
  const red = Number.parseInt(color.slice(6, 8), 16);
  return red >= 80 && red > green * 1.25 && red > blue * 1.25;
}

function parseKmlCoordinates(block: string): Ring {
  const match = block.match(/<coordinates(?:\s[^>]*)?>([\s\S]*?)<\/coordinates>/i);
  if (!match) return [];
  return match[1].trim().split(/\s+/).flatMap((tuple): Array<[number, number]> => {
    const [longitudeText, latitudeText] = tuple.split(",");
    const longitude = Number(longitudeText);
    const latitude = Number(latitudeText);
    return Number.isFinite(longitude) && Number.isFinite(latitude) && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90
      ? [[longitude, latitude]]
      : [];
  });
}

function parseRedKmlPolygons(kml: string): RedPolygon[] {
  const redStyles = new Set<string>();
  const styleMaps = new Map<string, string>();
  const stylePattern = /<Style\b([^>]*)>([\s\S]*?)<\/Style>/gi;
  for (const match of kml.matchAll(stylePattern)) {
    const id = xmlAttribute(match[1], "id");
    const color = match[2].match(/<PolyStyle\b[^>]*>[\s\S]*?<color>([^<]+)<\/color>/i)?.[1]?.trim() ?? null;
    if (id && kmlColorIsRed(color)) redStyles.add(id);
  }
  const styleMapPattern = /<StyleMap\b([^>]*)>([\s\S]*?)<\/StyleMap>/gi;
  for (const match of kml.matchAll(styleMapPattern)) {
    const id = xmlAttribute(match[1], "id");
    const normalStyle = match[2].match(/<Pair\b[^>]*>[\s\S]*?<key>normal<\/key>[\s\S]*?<styleUrl>\s*#([^<\s]+)\s*<\/styleUrl>/i)?.[1];
    if (id && normalStyle) styleMaps.set(id, normalStyle);
  }

  const polygons: RedPolygon[] = [];
  const placemarkPattern = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  for (const placemarkMatch of kml.matchAll(placemarkPattern)) {
    const placemark = placemarkMatch[1];
    const styleId = placemark.match(/<styleUrl>\s*#([^<\s]+)\s*<\/styleUrl>/i)?.[1];
    if (!styleId) continue;
    const redStyleId = styleMaps.get(styleId) ?? styleId;
    if (!redStyles.has(redStyleId)) continue;

    const polygonPattern = /<Polygon\b[^>]*>([\s\S]*?)<\/Polygon>/gi;
    for (const polygonMatch of placemark.matchAll(polygonPattern)) {
      const polygon = polygonMatch[1];
      const outerMatch = polygon.match(/<outerBoundaryIs\b[^>]*>([\s\S]*?)<\/outerBoundaryIs>/i);
      if (!outerMatch) continue;
      const outer = parseKmlCoordinates(outerMatch[1]);
      if (outer.length < 3) continue;
      const holes = [...polygon.matchAll(/<innerBoundaryIs\b[^>]*>([\s\S]*?)<\/innerBoundaryIs>/gi)]
        .map((match) => parseKmlCoordinates(match[1]))
        .filter((ring) => ring.length >= 3);
      polygons.push({ outer, holes });
    }
  }
  return polygons;
}

async function getRedZonePolygons(): Promise<RedPolygon[]> {
  if (redPolygonCache && redPolygonCache.expiresAt > Date.now()) return redPolygonCache.polygons;
  let response: Response;
  try {
    response = await fetch(RED_ZONES_KML_URL, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("No se pudo obtener el mapa de zonas. Intentá nuevamente más tarde.");
  }
  if (!response.ok) throw new Error("El mapa de zonas no está disponible en este momento.");
  const kml = await response.text();
  if (kml.length > 5_000_000 || !/<kml\b/i.test(kml)) throw new Error("El mapa de zonas devolvió un archivo no válido.");
  const polygons = parseRedKmlPolygons(kml);
  if (polygons.length === 0) throw new Error("No se encontraron polígonos rojos válidos en el mapa.");
  redPolygonCache = { expiresAt: Date.now() + 15 * 60 * 1000, polygons };
  return polygons;
}

function pointInRing(longitude: number, latitude: number, ring: Ring): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x1, y1] = ring[previous];
    const [x2, y2] = ring[current];
    const cross = (longitude - x1) * (y2 - y1) - (latitude - y1) * (x2 - x1);
    if (Math.abs(cross) < 1e-10 && longitude >= Math.min(x1, x2) - 1e-10 && longitude <= Math.max(x1, x2) + 1e-10 && latitude >= Math.min(y1, y2) - 1e-10 && latitude <= Math.max(y1, y2) + 1e-10) return true;
    if ((y1 > latitude) !== (y2 > latitude) && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

async function lookupAddressRedZone(admin: SupabaseClient, applicationId: string): Promise<AddressZoneResult> {
  const { data: application, error } = await admin.from("loan_applications")
    .select("id,address,between_streets,locality")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error("No se pudo leer el domicilio de la solicitud.");
  if (!application) throw new Error("La solicitud ya no está disponible.");

  const address = String(application.address ?? "").trim();
  const locality = String(application.locality ?? "").trim();
  const betweenStreets = String(application.between_streets ?? "").trim();
  if (!address || !locality) throw new Error("La solicitud no tiene calle y localidad para ubicar el domicilio.");

  const addressToGeocode = betweenStreets ? `${address}, entre ${betweenStreets}` : address;
  const georefUrl = new URL(GEOREF_ADDRESS_URL);
  georefUrl.searchParams.set("direccion", addressToGeocode);
  georefUrl.searchParams.set("localidad", locality);
  georefUrl.searchParams.set("max", "10");
  let georefResponse: Response;
  try {
    georefResponse = await fetch(georefUrl, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("No se pudo ubicar el domicilio con Georef. Intentá nuevamente más tarde.");
  }
  if (georefResponse.status === 429) throw new Error("Georef alcanzó su límite de consultas. Esperá un momento y volvé a intentar.");
  if (!georefResponse.ok) throw new Error("Georef no pudo procesar este domicilio en este momento.");

  let georef: Record<string, unknown>;
  try { georef = await georefResponse.json() as Record<string, unknown>; }
  catch { throw new Error("Georef devolvió una respuesta que no se pudo interpretar."); }
  const results = Array.isArray(georef.direcciones) ? georef.direcciones.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
  const resultCount = typeof georef.cantidad === "number" ? georef.cantidad : results.length;
  if (resultCount === 0 || results.length === 0) throw new Error("Georef no encontró una ubicación para este domicilio. Revisá la dirección y la localidad.");
  let match = results.length === 1 ? results[0] : null;
  if (!match && results.length > 1) {
    const normalizedLocality = locality.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR").trim();
    const localityMatches = results.filter((item) => {
      const itemLocality = item.localidad && typeof item.localidad === "object" ? (item.localidad as Record<string, unknown>).nombre : null;
      const censusLocality = item.localidad_censal && typeof item.localidad_censal === "object" ? (item.localidad_censal as Record<string, unknown>).nombre : null;
      const names = [itemLocality, censusLocality].filter((name): name is string => typeof name === "string")
        .map((name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR").trim());
      return names.includes(normalizedLocality);
    });
    if (localityMatches.length === 1) match = localityMatches[0];
  }
  if (!match) throw new Error("Georef encontró varias ubicaciones posibles. No se marcó ninguna zona; verificá la dirección manualmente.");

  const location = match.ubicacion && typeof match.ubicacion === "object" ? match.ubicacion as Record<string, unknown> : null;
  const latitude = Number(location?.lat);
  const longitude = Number(location?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("Georef no devolvió coordenadas válidas para este domicilio.");
  }

  const polygons = await getRedZonePolygons();
  const matchingPolygons = polygons.filter((polygon) => pointInRing(longitude, latitude, polygon.outer)
    && !polygon.holes.some((hole) => pointInRing(longitude, latitude, hole))).length;
  return {
    address,
    locality,
    normalized_address: typeof match.nomenclatura === "string" ? match.nomenclatura : `${address}, ${locality}`,
    latitude,
    longitude,
    inside_red_zone: matchingPolygons > 0,
    matching_polygons: matchingPolygons,
    approximate: true,
    queried_at: new Date().toISOString(),
    source: "Georef Argentina",
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

async function prepareApplicationDetails(admin: SupabaseClient, applications: Array<Record<string, unknown>>) {
  if (applications.length === 0) return [];
  const applicationIds = applications.map((application) => String(application.id));
  const [incomeResult, docsResult] = await Promise.all([
    admin.from("loan_income_sources").select("*").in("application_id", applicationIds),
    admin.from("loan_documents").select("id,application_id,document_type,storage_path,original_filename,file_size_bytes").in("application_id", applicationIds),
  ]);
  if (incomeResult.error || docsResult.error) throw new Error("No se pudieron cargar los ingresos o los documentos asociados.");

  const rawDocuments = docsResult.data ?? [];
  const signedDocuments = await mapWithConcurrency(rawDocuments, 8, async (document) => {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(document.storage_path, 300);
    if (error || !data) {
      console.warn("No se pudo preparar un enlace temporal para un documento; la solicitud continuará cargando.");
      return { ...document, signed_url: null as string | null };
    }
    return { ...document, signed_url: data.signedUrl as string | null };
  });

  const incomesByApplication = new Map<string, typeof incomeResult.data>();
  for (const income of incomeResult.data ?? []) {
    const group = incomesByApplication.get(income.application_id) ?? [];
    group.push(income);
    incomesByApplication.set(income.application_id, group);
  }
  const documentsByApplication = new Map<string, typeof signedDocuments>();
  for (const document of signedDocuments) {
    const group = documentsByApplication.get(document.application_id) ?? [];
    group.push(document);
    documentsByApplication.set(document.application_id, group);
  }

  return applications.map((application) => {
    const { tracking_code_hash: _trackingCodeHash, ...safeApplication } = application;
    return {
      ...safeApplication,
      incomes: incomesByApplication.get(String(application.id)) ?? [],
      documents: (documentsByApplication.get(String(application.id)) ?? []).map(({ storage_path: _storagePath, application_id: _applicationId, ...document }) => document),
    };
  });
}

function respond(body: Record<string, unknown>, status: number, origin: string) {
  const headers = new Headers(baseHeaders);
  if (origins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

type BcraEntity = {
  entidad: string;
  situacion: number | null;
  monto_miles: number | null;
  dias_atraso: number | null;
  en_revision: boolean;
  proceso_judicial: boolean;
};

function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

async function lookupBcraByApplicationDni(admin: SupabaseClient, applicationId: string) {
  const { data: application, error: applicationError } = await admin
    .from("loan_applications")
    .select("id,dni,full_name")
    .eq("id", applicationId)
    .maybeSingle();
  if (applicationError) throw new Error("No se pudo leer el DNI de la solicitud.");
  if (!application) throw new Error("La solicitud ya no está disponible.");

  const dni = String(application.dni ?? "").trim();
  if (!dni || dni.length > 20) throw new Error("La solicitud no tiene un DNI válido para consultar.");
  const dniDigits = normalizeDigits(dni);
  if (!/^\d{7,8}$/.test(dniDigits)) throw new Error("El DNI de esta solicitud no permite validar el CUIL automáticamente.");

  let nosisResponse: Response;
  try {
    const form = new URLSearchParams({
      Texto: dni,
      Tipo: "-1",
      EdadDesde: "-1",
      EdadHasta: "-1",
      IdProvincia: "-1",
      Localidad: "",
    });
    nosisResponse = await fetch("https://informes.nosis.com/Home/Buscar", {
      method: "POST",
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://informes.nosis.com/",
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("No se pudo conectar con Nosis. Intentá nuevamente más tarde.");
  }
  if (!nosisResponse.ok) throw new Error("Nosis no pudo procesar la búsqueda en este momento.");

  let nosis: Record<string, unknown>;
  try {
    nosis = await nosisResponse.json() as Record<string, unknown>;
  } catch {
    throw new Error("Nosis devolvió una respuesta que no se pudo interpretar.");
  }
  if (nosis.ExigirCaptcha === true) {
    throw new Error("Nosis solicitó una verificación adicional. No se pudo completar la consulta automática.");
  }
  if (nosis.HayError === true) throw new Error("Nosis no pudo completar la búsqueda.");

  const candidates = Array.isArray(nosis.EntidadesEncontradas) ? nosis.EntidadesEncontradas : [];
  const paddedDni = dniDigits.length === 7 ? dniDigits.padStart(8, "0") : dniDigits;
  const matching = candidates.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const cuil = normalizeDigits(candidate.Documento);
    if (!/^\d{11}$/.test(cuil) || (paddedDni.length === 8 && cuil.slice(2, 10) !== paddedDni)) return [];
    return [{ cuil, name: typeof candidate.RazonSocial === "string" ? candidate.RazonSocial : "" }];
  });
  const uniqueCandidates = [...new Map(matching.map((candidate) => [candidate.cuil, candidate])).values()];
  if (!uniqueCandidates.length) {
    throw new Error("Nosis no encontró un CUIL asociado al DNI de esta solicitud.");
  }
  if (uniqueCandidates.length > 1) {
    throw new Error("Nosis devolvió más de un CUIL posible para este DNI. Revisá la identidad antes de consultar el BCRA.");
  }

  const { cuil, name: nosisName } = uniqueCandidates[0];
  let bcraResponse: Response;
  try {
    bcraResponse = await fetch(`https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/${cuil}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Se obtuvo el CUIL, pero no se pudo conectar con el BCRA.");
  }

  if (bcraResponse.status === 404) {
    return {
      cuil,
      name: nosisName || String(application.full_name ?? ""),
      has_records: false,
      period: null,
      entities: [] as BcraEntity[],
      queried_at: new Date().toISOString(),
    };
  }
  if (!bcraResponse.ok) throw new Error("El BCRA no pudo completar la consulta en este momento.");

  let bcra: Record<string, unknown>;
  try {
    bcra = await bcraResponse.json() as Record<string, unknown>;
  } catch {
    throw new Error("El BCRA devolvió una respuesta que no se pudo interpretar.");
  }
  const results = bcra.results && typeof bcra.results === "object"
    ? bcra.results as Record<string, unknown>
    : {};
  const periods = Array.isArray(results.periodos) ? results.periodos : [];
  const latest = [...periods]
    .filter((period): period is Record<string, unknown> => Boolean(period) && typeof period === "object")
    .sort((a, b) => String(b.periodo ?? "").localeCompare(String(a.periodo ?? "")))[0];
  const entities = Array.isArray(latest?.entidades) ? latest.entidades.flatMap((entity) => {
    if (!entity || typeof entity !== "object") return [];
    const item = entity as Record<string, unknown>;
    return [{
      entidad: typeof item.entidad === "string" ? item.entidad : "Entidad informante",
      situacion: typeof item.situacion === "number" ? item.situacion : null,
      monto_miles: typeof item.monto === "number" && Number.isFinite(item.monto) ? item.monto : null,
      dias_atraso: typeof item.diasAtrasoPago === "number" ? item.diasAtrasoPago : null,
      en_revision: item.enRevision === true,
      proceso_judicial: item.procesoJud === true,
    } satisfies BcraEntity];
  }) : [];

  return {
    cuil,
    name: typeof results.denominacion === "string" && results.denominacion
      ? results.denominacion
      : nosisName || String(application.full_name ?? ""),
    has_records: periods.length > 0,
    period: typeof latest?.periodo === "string" ? latest.periodo : null,
    entities,
    queried_at: new Date().toISOString(),
  };
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

  if (body.action === "check_bcra") {
    const applicationId = typeof body.application_id === "string" ? body.application_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return respond({ error: "La solicitud indicada no es válida." }, 400, origin);
    try {
      const creditCheck = await lookupBcraByApplicationDni(admin, applicationId);
      return respond({ success: true, credit_check: creditCheck }, 200, origin);
    } catch (error) {
      return respond({ error: error instanceof Error ? error.message : "No se pudo consultar el BCRA." }, 502, origin);
    }
  }

  if (body.action === "check_red_zone") {
    const applicationId = typeof body.application_id === "string" ? body.application_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return respond({ error: "La solicitud indicada no es válida." }, 400, origin);
    try {
      const zoneCheck = await lookupAddressRedZone(admin, applicationId);
      return respond({ success: true, zone_check: zoneCheck }, 200, origin);
    } catch (error) {
      return respond({ error: error instanceof Error ? error.message : "No se pudo consultar la zona." }, 502, origin);
    }
  }

  if (body.action === "detail") {
    const id = typeof body.application_id === "string" ? body.application_id : "";
    if (!id) return respond({ error: "La solicitud indicada no es válida." }, 400, origin);
    const { data: application, error } = await admin.from("loan_applications").select("*").eq("id", id).maybeSingle();
    if (error) {
      console.error("No se pudo leer el detalle de la solicitud:", error.message);
      return respond({ error: "No se pudieron cargar los datos de la solicitud." }, 500, origin);
    }
    if (!application) return respond({ error: "La solicitud ya no está disponible." }, 404, origin);
    try {
      const [prepared] = await prepareApplicationDetails(admin, [application]);
      return respond({ success: true, application: prepared }, 200, origin);
    } catch (error) {
      console.error("No se pudo preparar el detalle de la solicitud:", error instanceof Error ? error.message : error);
      return respond({ error: "No se pudieron cargar los datos y documentos de la solicitud." }, 500, origin);
    }
  }

  if (body.action === "document_link") {
    const applicationId = typeof body.application_id === "string" ? body.application_id : "";
    const documentId = typeof body.document_id === "string" ? body.document_id : "";
    if (!applicationId || !documentId) return respond({ error: "El documento indicado no es válido." }, 400, origin);
    const { data: document, error } = await admin.from("loan_documents")
      .select("storage_path")
      .eq("id", documentId)
      .eq("application_id", applicationId)
      .maybeSingle();
    if (error) {
      console.error("No se pudo localizar el documento solicitado:", error.message);
      return respond({ error: "No se pudo preparar el enlace del documento." }, 500, origin);
    }
    if (!document) return respond({ error: "El documento ya no está disponible." }, 404, origin);
    const { data, error: signingError } = await admin.storage.from(BUCKET).createSignedUrl(document.storage_path, 300);
    if (signingError || !data?.signedUrl) {
      console.error("No se pudo crear un enlace temporal para el documento:", signingError?.message);
      return respond({ error: "No se pudo preparar el enlace temporal del documento." }, 500, origin);
    }
    return respond({ success: true, signed_url: data.signedUrl }, 200, origin);
  }

  if (body.action === "details") {
    let ids: unknown;
    try { ids = typeof body.application_ids === "string" ? JSON.parse(body.application_ids) : null; }
    catch { return respond({ error: "La lista de solicitudes no tiene un formato válido." }, 400, origin); }
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > PAGE_SIZE || !ids.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))) {
      return respond({ error: "La cantidad o el formato de solicitudes no es válido." }, 400, origin);
    }
    const uniqueIds = [...new Set(ids as string[])];
    const { data: applications, error } = await admin.from("loan_applications").select("*").in("id", uniqueIds);
    if (error) {
      console.error("No se pudieron leer los detalles de las solicitudes:", error.message);
      return respond({ error: "No se pudieron cargar los datos de las solicitudes." }, 500, origin);
    }
    if ((applications ?? []).length !== uniqueIds.length) return respond({ error: "Algunas solicitudes ya no están disponibles." }, 404, origin);
    try {
      const applicationsById = new Map((applications ?? []).map((application) => [application.id, application]));
      const orderedApplications = uniqueIds.map((id) => applicationsById.get(id)!);
      const prepared = await prepareApplicationDetails(admin, orderedApplications);
      return respond({ success: true, applications: prepared }, 200, origin);
    } catch (error) {
      console.error("No se pudieron preparar los detalles de las solicitudes:", error instanceof Error ? error.message : error);
      return respond({ error: "No se pudieron cargar los datos y documentos de las solicitudes." }, 500, origin);
    }
  }

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
        ...(status === "approved" ? { archived_at: null, archived_by: null } : {}),
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

  const summaryList = body.action === "list_summary";
  if (body.action !== "list" && !summaryList) return respond({ error: "La operación solicitada no es válida." }, 400, origin);
  const status = body.status;
  if (status !== "pending" && status !== "under_review" && status !== "approved" && status !== "rejected" && status !== "all" && status !== "archived") return respond({ error: "El filtro indicado no es válido." }, 400, origin);

  const rawOffset = body.offset === undefined ? 0 : Number(body.offset);
  if (!Number.isSafeInteger(rawOffset) || rawOffset < 0) return respond({ error: "La página solicitada no es válida." }, 400, origin);
  const offset = rawOffset;

  let query = admin.from("loan_applications")
    .select(summaryList ? "id,status,full_name,dni,phone,locality,created_at,loan_amount,archived_at,is_electro_variety_client,has_referrer" : "*")
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

  const pageApplications = applications ?? [];
  const hasMore = pageApplications.length > PAGE_SIZE;
  const page = pageApplications.slice(0, PAGE_SIZE);
  if (summaryList) {
    const pageIds = page.map((application) => String(application.id));
    const salaryReceiptIds = new Set<string>();
    if (pageIds.length) {
      const { data: salaryReceipts, error: salaryReceiptError } = await admin.from("loan_documents")
        .select("application_id")
        .in("application_id", pageIds)
        .eq("document_type", "salary_receipt");
      if (salaryReceiptError) {
        console.error("No se pudo comprobar el recibo de sueldo:", salaryReceiptError.message);
        return respond({ error: "No se pudo cargar el filtro de recibos de sueldo." }, 500, origin);
      }
      (salaryReceipts ?? []).forEach((document) => salaryReceiptIds.add(String(document.application_id)));
    }
    const summaries = page.map((application) => ({
      ...application,
      has_salary_receipt: salaryReceiptIds.has(String(application.id)),
    }));
    return respond({ success: true, applications: summaries, has_more: hasMore, next_offset: offset + page.length }, 200, origin);
  }
  try {
    const prepared = await prepareApplicationDetails(admin, page);
    return respond({ success: true, applications: prepared, has_more: hasMore, next_offset: offset + prepared.length }, 200, origin);
  } catch (error) {
    console.error("No se pudieron preparar las solicitudes:", error instanceof Error ? error.message : error);
    return respond({ error: "No se pudieron cargar los detalles y documentos." }, 500, origin);
  }
});
