import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { applicationReference, formatDateTime } from './format'

export type ExportDocument = {
  document_type: string
  original_filename: string
  file_size_bytes: number
  signed_url: string | null
}

export type ExportIncome = Record<string, unknown>

export type ExportApplication = {
  id: string
  created_at: string
  full_name: string
  dni: string
  dni_updated: boolean
  phone: string
  has_referrer: boolean
  is_electro_variety_client: boolean | null
  referrer_full_name: string | null
  referrer_phone: string | null
  referrer_relationship: string | null
  alternate_phone: string
  alternate_phone_relationship: string
  address: string
  between_streets: string
  locality: string
  housing_type: string
  has_service_in_own_name: boolean
  service_types: string[]
  service_holder_name: string | null
  service_holder_dni: string | null
  service_holder_relationship: string | null
  has_debts: boolean
  debt_reason: string | null
  debt_amount: number | null
  loan_amount: number
  loan_frequency: string
  installment_count: number
  installment_amount: number
  total_to_pay: number
  loan_purpose: string
  status: string
  whatsapp_rejection_opt_in: boolean
  whatsapp_rejection_opt_in_at: string | null
  privacy_accepted: boolean
  incomes: ExportIncome[]
  documents: Array<ExportDocument & { id: string }>
}

export type DownloadedAttachment = {
  document: ExportDocument
  bytes: Uint8Array
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 38
const GRAPHITE = rgb(37 / 255, 43 / 255, 53 / 255)
const BLUE = rgb(0, 111 / 255, 198 / 255)
const PALE_BLUE = rgb(231 / 255, 243 / 255, 1)
const SILVER = rgb(184 / 255, 195 / 255, 209 / 255)
const MUTED = rgb(94 / 255, 105 / 255, 120 / 255)
const WHITE = rgb(1, 1, 1)

const serviceLabels: Record<string, string> = {
  edesur: 'Edesur',
  metrogas: 'Metrogas',
  water: 'Agua',
  other: 'Otro',
  none: 'Ninguno a mi nombre',
}

const housingLabels: Record<string, string> = {
  own: 'Vivienda propia',
  rent_contract: 'Alquilo por contrato',
  rent_verbal: 'Alquilo de palabra',
}

const incomeLabels: Record<string, string> = {
  formal_employment: 'Trabajo en blanco',
  informal_employment: 'Trabajo informal',
  self_employed: 'Trabajo por cuenta propia',
  business: 'Comercio propio',
  allowance: 'Asignación',
  retirement: 'Jubilación',
  pension: 'Pensión',
  cooperative: 'Cooperativa',
  other: 'Otros ingresos',
}

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  under_review: 'En revision',
  approved: 'Aprobada',
  rejected: 'Rechazada',
}

const documentLabels: Record<string, string> = {
  dni_front: 'Frente de tu DNI',
  dni_back: 'Dorso de tu DNI',
  rental_contract: 'Contrato de alquiler',
  utility_bill: 'Comprobante del servicio',
  service_holder_dni_front: 'Frente del DNI del titular del servicio',
  service_holder_dni_back: 'Dorso del DNI del titular del servicio',
  salary_receipt: 'Recibo de sueldo',
  wallet_statement: 'Resumen de billetera virtual',
  business_photo: 'Fotografía del comercio',
  business_photos: 'Fotografías del comercio',
  business_video: 'Video del comercio',
  income_proof: 'Comprobante de ingresos',
  income_proof_selfEmployed: 'Comprobante de ingresos de cuenta propia u otros ingresos',
  income_proof_allowance: 'Comprobante de asignación',
  income_proof_retirement: 'Comprobante de jubilación',
  income_proof_pension: 'Comprobante de pensión',
  income_proof_cooperative: 'Comprobante de cooperativa',
}

const incomeFields: Array<[string, string, boolean?]> = [
  ['activity_description', 'Actividad / origen del ingreso'],
  ['wallet_provider', 'Billetera virtual utilizada'],
  ['benefit_name', 'Beneficio o institución'],
  ['business_name', 'Nombre del comercio'],
  ['business_activity', 'Actividad comercial'],
  ['business_address', 'Dirección del comercio'],
  ['business_duration', 'Antigüedad del comercio'],
  ['business_revenue', 'Facturación mensual aproximada', true],
  ['business_profit', 'Ganancia mensual aproximada', true],
]

const safeText = (value: unknown) => String(value ?? '—')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
  .replace(/[^\u0000-\u00FF]/g, '?')
  .trim() || '—'

const money = (value: unknown) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
}).format(Number(value) || 0)

const safeFilename = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 100) || 'archivo'

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number) => {
  const result: string[] = []
  for (const paragraph of safeText(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate
      } else {
        result.push(line)
        line = word
      }
    }
    result.push(line || ' ')
  }
  return result
}

function drawText(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color = GRAPHITE) {
  page.drawText(safeText(text), { x, y, size, font, color, maxWidth: PAGE_WIDTH - x - MARGIN })
}

async function imageAsJpeg(bytes: Uint8Array, mimeType: string) {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo procesar una imagen adjunta.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const converted = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('No se pudo convertir una imagen adjunta.')), 'image/jpeg', 0.9)
  })
  return { bytes: new Uint8Array(await converted.arrayBuffer()), width: canvas.width, height: canvas.height }
}

async function videoPreview(bytes: Uint8Array, filename: string) {
  const mimeType = filename.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4'
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }))
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('No se pudo generar la vista previa del video.')), 8000)
      video.onloadeddata = () => { window.clearTimeout(timeout); resolve() }
      video.onerror = () => { window.clearTimeout(timeout); reject(new Error('El navegador no pudo abrir el video.')) }
    })
    if (Number.isFinite(video.duration) && video.duration > 1) {
      video.currentTime = Math.min(1, video.duration / 2)
      await new Promise<void>((resolve) => { video.onseeked = () => resolve(); window.setTimeout(resolve, 1500) })
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 360
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo crear la vista previa del video.')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('No se pudo generar la vista previa del video.')), 'image/jpeg', 0.88)
    })
    return { bytes: new Uint8Array(await image.arrayBuffer()), width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function downloadApplicationFile(document: ExportDocument): Promise<Uint8Array> {
  if (!document.signed_url) throw new Error(`No se pudo abrir "${document.original_filename}". Actualizá la lista e intentá nuevamente.`)
  const response = await fetch(document.signed_url)
  if (!response.ok) throw new Error(`No se pudo descargar "${document.original_filename}". Actualizá la lista e intentá nuevamente.`)
  return new Uint8Array(await response.arrayBuffer())
}

export async function buildApplicationPdf(
  application: ExportApplication,
  attachments: DownloadedAttachment[],
  logoUrl: string,
) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Solicitud de ${application.full_name}`)
  pdf.setAuthor('Préstamos Variety')
  pdf.setSubject(`Solicitud ${application.id}`)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page: PDFPage
  let y = 0
  let logo: Awaited<ReturnType<typeof pdf.embedJpg>> | null = null
  try {
    const response = await fetch(logoUrl)
    if (response.ok) logo = await pdf.embedJpg(await response.arrayBuffer())
  } catch { /* El logo es decorativo; el PDF sigue generándose sin él. */ }

  const addPage = (continuation = true) => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE })
    if (continuation) {
      drawText(page, `PRESTAMOS VARIETY | ${application.full_name}`, MARGIN, PAGE_HEIGHT - 27, 8, bold, MUTED)
      page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 34 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 34 }, thickness: 0.6, color: SILVER })
      y = PAGE_HEIGHT - 51
    } else {
      if (logo) page.drawImage(logo, { x: MARGIN, y: PAGE_HEIGHT - 91, width: 58, height: 58 })
      drawText(page, 'PRESTAMOS VARIETY', MARGIN + 70, PAGE_HEIGHT - 52, 12, bold)
      drawText(page, 'PRESTAMOS PERSONALES', MARGIN + 70, PAGE_HEIGHT - 69, 8, regular, MUTED)
      const heroY = PAGE_HEIGHT - 195
      page.drawRectangle({ x: MARGIN, y: heroY, width: PAGE_WIDTH - MARGIN * 2, height: 92, color: GRAPHITE })
      page.drawRectangle({ x: PAGE_WIDTH - MARGIN - 8, y: heroY, width: 8, height: 92, color: BLUE })
      drawText(page, `SOLICITUD PERSONAL | ${statusLabels[application.status] || application.status}`, MARGIN + 17, heroY + 71, 8, bold, rgb(155 / 255, 212 / 255, 1))
      drawText(page, 'Solicitud de prestamo', MARGIN + 17, heroY + 47, 20, bold, WHITE)
      drawText(page, application.full_name, MARGIN + 17, heroY + 28, 12, bold, WHITE)
      drawText(page, `Solicitud #${applicationReference(application.id)} | ${formatDateTime(application.created_at)}`, MARGIN + 17, heroY + 12, 7.5, regular, WHITE)
      y = heroY - 24
    }
    return page
  }

  page = addPage(false)

  const ensureRoom = (height: number) => {
    if (y - height < 38) page = addPage()
  }

  const drawFields = (fields: Array<[string, unknown]>) => {
    const gap = 10
    const fieldWidth = (PAGE_WIDTH - MARGIN * 2 - gap) / 2
    for (let index = 0; index < fields.length; index += 2) {
      const row = fields.slice(index, index + 2)
      const wrapped = row.map(([label, value]) => ({
        label: safeText(label),
        lines: wrapText(String(value ?? '—'), bold, 9.2, fieldWidth - 20),
      }))
      const rowHeight = Math.max(40, ...wrapped.map((item) => 20 + item.lines.length * 12))
      ensureRoom(rowHeight + 7)
      row.forEach((_, column) => {
        const x = MARGIN + column * (fieldWidth + gap)
        const item = wrapped[column]
        page.drawRectangle({ x, y: y - rowHeight, width: fieldWidth, height: rowHeight, color: WHITE, borderColor: SILVER, borderWidth: 0.6 })
        page.drawText(item.label, { x: x + 9, y: y - 13, size: 7.5, font: regular, color: MUTED, maxWidth: fieldWidth - 18 })
        item.lines.forEach((line, lineIndex) => page.drawText(line, { x: x + 9, y: y - 27 - lineIndex * 12, size: 9.2, font: bold, color: GRAPHITE, maxWidth: fieldWidth - 18 }))
      })
      y -= rowHeight + 7
    }
  }

  const drawSection = (number: string, title: string, fields: Array<[string, unknown]>) => {
    ensureRoom(50)
    y -= 7
    page.drawRectangle({ x: MARGIN, y: y - 19, width: 24, height: 24, color: PALE_BLUE })
    page.drawText(number, { x: MARGIN + 3, y: y - 11, size: 7.5, font: bold, color: BLUE })
    page.drawText(safeText(title), { x: MARGIN + 33, y: y - 11, size: 12, font: bold, color: GRAPHITE })
    y -= 31
    drawFields(fields)
  }

  const state = (value: boolean) => value ? 'Si' : 'No'
  const serviceNames = application.service_types?.length
    ? application.service_types.map((service) => serviceLabels[service] || service).join(', ')
    : 'Ninguno informado'
  drawSection('01', 'Datos personales', [
    ['Nombre y apellido', application.full_name],
    ['DNI', application.dni],
    ['DNI actualizado', state(application.dni_updated)],
    ['Telefono personal', application.phone],
    ['Telefono alternativo', application.alternate_phone],
    ['Vinculo con el contacto alternativo', application.alternate_phone_relationship],
    ['Vino recomendado por alguien', state(application.has_referrer)],
    ['Es cliente de Electro Variety', typeof application.is_electro_variety_client === 'boolean' ? state(application.is_electro_variety_client) : 'No informado'],
    ...(application.has_referrer ? [
      ['Nombre de quien recomendo', application.referrer_full_name],
      ['Telefono de quien recomendo', application.referrer_phone],
      ['Vinculo con quien recomendo', application.referrer_relationship],
    ] as Array<[string, unknown]> : []),
  ])
  drawSection('02', 'Domicilio', [
    ['Calle y numero', application.address],
    ['Entre calles', application.between_streets],
    ['Localidad', application.locality],
    ['Situacion de vivienda', housingLabels[application.housing_type] || application.housing_type],
  ])
  drawSection('03', 'Comprobante de domicilio', [
    ['Servicios o comprobantes declarados', serviceNames],
    ...(application.service_types?.some((service) => service !== 'none') ? [
      ['Servicio a nombre de la persona', state(application.has_service_in_own_name)],
      ...(!application.has_service_in_own_name ? [
        ['Nombre del titular', application.service_holder_name],
        ['DNI del titular', application.service_holder_dni],
        ['Vinculo con el titular', application.service_holder_relationship],
      ] as Array<[string, unknown]> : []),
    ] as Array<[string, unknown]> : []),
  ])
  drawSection('04', 'Situacion financiera', [
    ['Tiene deudas actualmente', state(application.has_debts)],
    ...(application.has_debts ? [
      ['Motivo de la deuda', application.debt_reason],
      ['Monto aproximado de la deuda', money(application.debt_amount)],
    ] as Array<[string, unknown]> : []),
  ])

  ensureRoom(55)
  y -= 7
  page.drawRectangle({ x: MARGIN, y: y - 19, width: 24, height: 24, color: PALE_BLUE })
  page.drawText('05', { x: MARGIN + 3, y: y - 11, size: 7.5, font: bold, color: BLUE })
  page.drawText('Trabajo e ingresos', { x: MARGIN + 33, y: y - 11, size: 12, font: bold, color: GRAPHITE })
  y -= 31
  if (!application.incomes.length) drawFields([['Fuentes de ingreso', 'Sin datos de ingresos']])
  for (const income of application.incomes) {
    const source = String(income.source_type ?? '')
    const details: Array<[string, unknown]> = [['Ingreso mensual aproximado', money(income.monthly_income)]]
    for (const [key, label, isMoney] of incomeFields) {
      const value = income[key]
      if (value !== null && value !== undefined && value !== '') details.push([label, isMoney ? money(value) : value])
    }
    ensureRoom(55)
    page.drawText(incomeLabels[source] || source || 'Fuente de ingreso', { x: MARGIN, y, size: 9, font: bold, color: BLUE })
    y -= 9
    drawFields(details)
    y -= 6
  }
  drawSection('06', 'Tu prestamo', [
    ['Monto solicitado', money(application.loan_amount)],
    ['Modalidad de cuotas', `${application.installment_count} cuotas ${application.loan_frequency === 'weekly' ? 'semanales' : application.loan_frequency === 'fortnightly' ? 'quincenales' : 'mensuales'}`],
    ['Valor de cada cuota', money(application.installment_amount)],
    ['Total estimado a pagar', money(application.total_to_pay)],
    ['Para que necesita el prestamo', application.loan_purpose],
  ])
  drawSection('07', 'Consentimientos', [
    ['Tratamiento de datos', application.privacy_accepted ? 'Aceptado' : 'No registrado'],
    ['Notificacion del resultado por WhatsApp', application.whatsapp_rejection_opt_in ? 'Aceptada' : 'No aceptada'],
    ...(application.whatsapp_rejection_opt_in_at ? [['Consentimiento WhatsApp registrado', formatDateTime(application.whatsapp_rejection_opt_in_at)] as [string, unknown]] : []),
  ])

  if (attachments.length) {
    ensureRoom(65)
    y -= 8
    page.drawRectangle({ x: MARGIN, y: y - 19, width: 24, height: 24, color: PALE_BLUE })
    page.drawText('+', { x: MARGIN + 7, y: y - 11, size: 11, font: bold, color: BLUE })
    page.drawText('Documentacion adjunta', { x: MARGIN + 33, y: y - 11, size: 12, font: bold, color: GRAPHITE })
    y -= 31

    for (const attachment of attachments) {
      const { document, bytes } = attachment
      const label = documentLabels[document.document_type] || document.document_type
      const filename = safeFilename(document.original_filename)
      const lowerName = filename.toLowerCase()
      const isPdf = lowerName.endsWith('.pdf') || bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
      const isVideo = /\.(mp4|mov|quicktime)$/i.test(lowerName)
      if (isPdf) {
        const cover = addPage()
        cover.drawRectangle({ x: MARGIN, y: PAGE_HEIGHT - 150, width: PAGE_WIDTH - MARGIN * 2, height: 92, color: PALE_BLUE, borderColor: SILVER, borderWidth: 0.8 })
        cover.drawText(safeText(label), { x: MARGIN + 16, y: PAGE_HEIGHT - 83, size: 13, font: bold, color: GRAPHITE, maxWidth: PAGE_WIDTH - MARGIN * 2 - 32 })
        cover.drawText(safeText(filename), { x: MARGIN + 16, y: PAGE_HEIGHT - 108, size: 9, font: regular, color: MUTED, maxWidth: PAGE_WIDTH - MARGIN * 2 - 32 })
        try {
          const sourcePdf = await PDFDocument.load(bytes)
          const copied = await pdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
          copied.forEach((pdfPage) => pdf.addPage(pdfPage))
        } catch {
          cover.drawText('No se pudo representar este archivo PDF; el original esta incluido en el ZIP.', { x: MARGIN + 16, y: PAGE_HEIGHT - 130, size: 8, font: regular, color: MUTED, maxWidth: PAGE_WIDTH - MARGIN * 2 - 32 })
        }
        continue
      }
      if (isVideo) {
        const cover = addPage()
        cover.drawRectangle({ x: MARGIN, y: PAGE_HEIGHT - 150, width: PAGE_WIDTH - MARGIN * 2, height: 92, color: PALE_BLUE, borderColor: SILVER, borderWidth: 0.8 })
        cover.drawText(safeText(`${label}: ${filename}`), { x: MARGIN + 16, y: PAGE_HEIGHT - 83, size: 11, font: bold, color: GRAPHITE, maxWidth: PAGE_WIDTH - MARGIN * 2 - 32 })
        try {
          const preview = await videoPreview(bytes, filename)
          const embedded = await pdf.embedJpg(preview.bytes)
          const scale = Math.min((PAGE_WIDTH - MARGIN * 2) / preview.width, (PAGE_HEIGHT - 260) / preview.height)
          cover.drawImage(embedded, { x: (PAGE_WIDTH - preview.width * scale) / 2, y: PAGE_HEIGHT - 170 - preview.height * scale, width: preview.width * scale, height: preview.height * scale })
          cover.drawText('Vista previa. El archivo de video original esta incluido en el ZIP.', { x: MARGIN, y: 45, size: 8, font: regular, color: MUTED })
        } catch {
          cover.drawText('No se pudo generar una vista previa. El archivo original esta incluido en el ZIP.', { x: MARGIN + 16, y: PAGE_HEIGHT - 126, size: 9, font: regular, color: MUTED })
        }
        page = addPage()
        y = PAGE_HEIGHT - 51
        continue
      }

      try {
        const mime = lowerName.endsWith('.png') ? 'image/png' : lowerName.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
        const converted = mime === 'image/webp' ? await imageAsJpeg(bytes, mime) : null
        const imageBytes = converted?.bytes || bytes
        const embedded = mime === 'image/png' ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes)
        const imageWidth = converted?.width || embedded.width
        const imageHeight = converted?.height || embedded.height
        const imagePage = addPage()
        imagePage.drawText(safeText(label), { x: MARGIN, y: PAGE_HEIGHT - 60, size: 13, font: bold, color: GRAPHITE, maxWidth: PAGE_WIDTH - MARGIN * 2 })
        imagePage.drawText(safeText(filename), { x: MARGIN, y: PAGE_HEIGHT - 77, size: 8, font: regular, color: MUTED, maxWidth: PAGE_WIDTH - MARGIN * 2 })
        const maxWidth = PAGE_WIDTH - MARGIN * 2
        const maxHeight = PAGE_HEIGHT - 145
        const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight)
        const width = imageWidth * scale
        const height = imageHeight * scale
        imagePage.drawImage(embedded, { x: (PAGE_WIDTH - width) / 2, y: Math.max(40, (PAGE_HEIGHT - height) / 2 - 20), width, height })
        y = PAGE_HEIGHT - 51
      } catch {
        const fallback = addPage()
        fallback.drawText(safeText(`${label}: ${filename}`), { x: MARGIN, y: PAGE_HEIGHT - 70, size: 12, font: bold, color: GRAPHITE, maxWidth: PAGE_WIDTH - MARGIN * 2 })
        fallback.drawText('No se pudo incorporar la vista previa; el original esta incluido en el ZIP.', { x: MARGIN, y: PAGE_HEIGHT - 92, size: 9, font: regular, color: MUTED, maxWidth: PAGE_WIDTH - MARGIN * 2 })
        y = PAGE_HEIGHT - 51
      }
    }
  }

  const pages = pdf.getPages()
  pages.forEach((pdfPage, index) => {
    const { width } = pdfPage.getSize()
    pdfPage.drawText(`${index + 1} / ${pages.length}`, { x: width - MARGIN - 35, y: 20, size: 7, font: regular, color: MUTED })
  })
  return pdf.save()
}

export { documentLabels, money, safeFilename }
