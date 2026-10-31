import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { applicationReference, formatDateTime } from './lib/format'
import type { DownloadedAttachment, ExportApplication } from './lib/application-export'
import './AdminApp.css'

type Document = {
  id: string
  document_type: string
  original_filename: string
  file_size_bytes: number
  signed_url: string | null
}

type Application = ExportApplication & {
  status: string
  archived_at: string | null
  archived_by: string | null
  decided_at: string | null
  decided_by: string | null
  admin_notes: string | null
  whatsapp_rejection_status: string
  whatsapp_rejection_sent_at: string | null
  whatsapp_rejection_message_id: string | null
  whatsapp_rejection_error_code: string | null
  documents: Document[]
}

const money = (amount: unknown) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(amount) || 0)

const incomeLabels: Record<string, string> = {
  formal_employment: 'Trabajo en blanco',
  informal_employment: 'Trabajo informal',
  self_employed: 'Cuenta propia',
  business: 'Comercio',
  allowance: 'Asignación',
  retirement: 'Jubilación',
  pension: 'Pensión',
  cooperative: 'Cooperativa',
  other: 'Otros ingresos',
}

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

const incomeDetailFields: Array<[string, string, boolean?]> = [
  ['activity_description', 'Actividad / origen'],
  ['wallet_provider', 'Billetera virtual'],
  ['benefit_name', 'Beneficio o institución'],
  ['business_name', 'Nombre del comercio'],
  ['business_activity', 'Actividad comercial'],
  ['business_address', 'Dirección del comercio'],
  ['business_duration', 'Antigüedad del comercio'],
  ['business_revenue', 'Facturación mensual aproximada', true],
  ['business_profit', 'Ganancia mensual aproximada', true],
]

const documentLabels: Record<string, string> = {
  dni_front: 'DNI frente',
  dni_back: 'DNI dorso',
  rental_contract: 'Contrato de alquiler',
  utility_bill: 'Comprobante de domicilio',
  service_holder_dni_front: 'DNI del titular frente',
  service_holder_dni_back: 'DNI del titular dorso',
  salary_receipt: 'Recibo de sueldo',
  wallet_statement: 'Resumen de billetera',
  business_photo: 'Foto del comercio',
  business_video: 'Video del comercio',
  income_proof: 'Comprobante de ingresos',
}

const statusLabel: Record<string, string> = {
  pending: 'Pendiente',
  under_review: 'En revisión',
  approved: 'Aprobada',
  rejected: 'Rechazada',
}

function PdfField({ label, value }: { label: string; value: unknown }) {
  const text = value === null || value === undefined || value === '' ? '—' : String(value)
  return <div className="pdf-field"><small>{label}</small><b>{text}</b></div>
}

function PdfSection({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="pdf-section">
      <div className="pdf-section-heading"><span>{number}</span><h2>{title}</h2></div>
      <div className="pdf-grid">{children}</div>
    </section>
  )
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [applications, setApplications] = useState<Application[]>([])
  const [selected, setSelected] = useState<Application | null>(null)
  const [filter, setFilter] = useState('pending')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [whatsAppApplicant, setWhatsAppApplicant] = useState<Application | null>(null)
  const [whatsAppNumber, setWhatsAppNumber] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)

  useEffect(() => () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl)
  }, [pdfPreviewUrl])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  const callAdmin = useCallback(async (body: Record<string, string>) => {
    const { data, error: invokeError } = await supabase.functions.invoke('loan-admin-panel', { body })
    if (invokeError) {
      let message = invokeError.message || 'No se pudo completar la operación.'
      try {
        const response = (invokeError as { context?: unknown }).context
        if (response instanceof Response) {
          const responseBody = await response.clone().json()
          if (typeof responseBody?.error === 'string') message = responseBody.error
        }
      } catch {
        // Conserva el mensaje del cliente si el servidor no devolvió JSON.
      }
      throw new Error(message)
    }
    if (!data?.success) throw new Error(data?.error || 'No se pudo completar la operación.')
    return data
  }, [])

  const loadApplications = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    setDecisionNote('')
    setApplications([])
    try {
      const rows: Application[] = []
      let offset = 0
      let hasNextPage = true
      while (hasNextPage) {
        const data = await callAdmin({ action: 'list', status: filter, offset: String(offset) })
        const pageRows = (data.applications ?? []) as Application[]
        rows.push(...pageRows)
        hasNextPage = Boolean(data.has_more)
        const nextOffset = Number(data.next_offset ?? offset + pageRows.length)
        if (hasNextPage && nextOffset <= offset) throw new Error('La carga de solicitudes no pudo avanzar. Actualizá el panel e intentá de nuevo.')
        offset = nextOffset
      }
      setApplications(rows)
      setSelected((current) => current ? rows.find((row) => row.id === current.id) ?? null : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las solicitudes.')
    } finally {
      setLoading(false)
    }
  }, [session, filter, callAdmin])

  useEffect(() => {
    void loadApplications()
  }, [loadApplications])

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) setError('No se pudo iniciar sesión. Verificá tus datos.')
  }

  const decide = async (status: 'approved' | 'rejected') => {
    if (!selected) return
    const verb = status === 'approved' ? 'aprobar' : 'rechazar'
    if (!window.confirm('¿Confirmás ' + verb + ' la solicitud de ' + selected.full_name + '?')) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const result = await callAdmin({ action: 'decide', application_id: selected.id, status, admin_notes: decisionNote })
      setDecisionNote('')
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(selected.id)
        return next
      })
      if (status === 'rejected') {
        const delivery = result.notification?.status
        const deliveryNotice: Record<string, string> = {
          sent: 'Solicitud rechazada y aviso enviado por WhatsApp.',
          pending: 'Solicitud rechazada. El aviso quedó pendiente de configurar WhatsApp Cloud API.',
          failed: 'Solicitud rechazada, pero no se pudo enviar el aviso. Podés revisar el estado y reintentar desde la solicitud.',
          unknown: 'Solicitud rechazada. No se pudo confirmar si WhatsApp recibió el aviso; revisá el estado antes de reintentar.',
          not_eligible: 'Solicitud rechazada. No se envió el aviso porque no hay consentimiento de WhatsApp.',
        }
        setNotice(deliveryNotice[String(delivery)] || 'Solicitud rechazada.')
      } else {
        setNotice('Solicitud aprobada.')
      }
      if (status === 'approved') {
        setWhatsAppApplicant(selected)
        setWhatsAppNumber(formatWhatsAppNumber(selected.phone))
      }
      setSelected(null)
      await loadApplications()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el estado.')
    } finally {
      setLoading(false)
    }
  }


  const formatWhatsAppNumber = (phone: string) => {
    const digits = phone.replace(/\D/g, '')
    if (digits.startsWith('549')) return `+${digits}`
    if (digits.startsWith('54')) return `+549${digits.slice(2)}`
    return `+549${digits}`
  }

  const prepareWhatsAppMessage = (application: Application) => {
    setWhatsAppApplicant(application)
    setWhatsAppNumber(formatWhatsAppNumber(application.phone))
  }

  const retryRejectionWhatsApp = async () => {
    if (!selected) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const result = await callAdmin({ action: 'retry_rejection_whatsapp', application_id: selected.id })
      const status = String(result.notification?.status || '')
      const deliveryNotice: Record<string, string> = {
        sent: 'El aviso de rechazo se envió por WhatsApp.',
        pending: 'El aviso sigue pendiente: falta completar la configuración de WhatsApp Cloud API.',
        failed: 'Meta rechazó el envío. Revisá la configuración y volvé a intentar.',
        unknown: 'No se pudo confirmar si Meta recibió el aviso. No lo reintentes hasta revisar el estado en Meta.',
      }
      setNotice(deliveryNotice[status] || 'Se actualizó el estado del aviso.')
      await loadApplications()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo reintentar el aviso.')
    } finally {
      setLoading(false)
    }
  }

  const deleteApplication = async () => {
    if (!selected) return
    const name = selected.full_name
    if (!window.confirm('Vas a eliminar permanentemente la solicitud de ' + name + ' y sus documentos. Esta acción no se puede deshacer. ¿Continuar?')) return
    if (window.prompt('Para confirmar, escribí ELIMINAR') !== 'ELIMINAR') return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      await callAdmin({ action: 'delete', application_id: selected.id })
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(selected.id)
        return next
      })
      if (whatsAppApplicant?.id === selected.id) {
        setWhatsAppApplicant(null)
        setWhatsAppNumber('')
      }
      setSelected(null)
      setNotice('La solicitud y sus documentos fueron eliminados permanentemente.')
      await loadApplications()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar la solicitud.')
    } finally {
      setLoading(false)
    }
  }

  const setApplicationArchived = async (archived: boolean) => {
    if (!selected) return
    const action = archived ? 'archive' : 'unarchive'
    const prompt = archived
      ? `¿Archivar la solicitud de ${selected.full_name}? Podés encontrarla después en “Archivadas” y restaurarla.`
      : `¿Restaurar la solicitud de ${selected.full_name} desde el archivo?`
    if (!window.confirm(prompt)) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      await callAdmin({ action, application_id: selected.id })
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(selected.id)
        return next
      })
      setSelected(null)
      setNotice(archived ? 'La solicitud quedó archivada y se conserva en Supabase.' : 'La solicitud volvió a la lista activa.')
      await loadApplications()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el archivo de la solicitud.')
    } finally {
      setLoading(false)
    }
  }

  const whatsAppDigits = whatsAppNumber.replace(/\D/g, '')

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const getFreshApplication = async (applicationId: string) => {
    let offset = 0
    let hasNextPage = true
    while (hasNextPage) {
      const page = await callAdmin({ action: 'list', status: filter, offset: String(offset) })
      const rows = (page.applications ?? []) as Application[]
      const match = rows.find((row) => row.id === applicationId)
      if (match) return match
      hasNextPage = Boolean(page.has_more)
      offset = Number(page.next_offset ?? offset + rows.length)
    }
    throw new Error('La solicitud ya no aparece en este filtro. Actualizá la lista e intentá de nuevo.')
  }

  const getAttachments = async (application: Application, downloadFile: (document: Document) => Promise<Uint8Array>) => {
    const files: DownloadedAttachment[] = []
    for (const document of application.documents) {
      files.push({ document, bytes: await downloadFile(document) })
    }
    return files
  }

  const createSelectedApplicationPdf = async () => {
    if (!selected) throw new Error('Elegí una solicitud para continuar.')
    const { buildApplicationPdf, downloadApplicationFile, safeFilename } = await import('./lib/application-export')
    const application = await getFreshApplication(selected.id)
    const attachments = await getAttachments(application, downloadApplicationFile)
    const pdf = await buildApplicationPdf(application, attachments, `${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`)
    const filename = `Solicitud-${safeFilename(application.full_name)}-${application.id.slice(0, 8)}.pdf`
    return { blob: new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' }), filename }
  }

  const downloadApplicationPdf = async () => {
    if (!selected || exporting) return
    setExporting(true)
    setExportProgress('Preparando la solicitud y sus archivos adjuntos…')
    setError('')
    setNotice('')
    try {
      const { blob, filename } = await createSelectedApplicationPdf()
      downloadBlob(blob, filename)
      setNotice('El PDF de la solicitud, con sus adjuntos, se descargó correctamente.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar el PDF.')
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }

  const previewApplicationPdf = async () => {
    if (!selected || exporting) return
    setExporting(true)
    setExportProgress('Preparando la vista previa de la solicitud y sus archivos adjuntos…')
    setError('')
    setNotice('')
    try {
      const { blob } = await createSelectedApplicationPdf()
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl)
      setPdfPreviewUrl(URL.createObjectURL(blob))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir la vista previa del PDF.')
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }

  const closePdfPreview = () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl)
    setPdfPreviewUrl(null)
  }

  const toggleApplication = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectVisibleApplications = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      const allVisibleSelected = applications.length > 0 && applications.every((application) => next.has(application.id))
      applications.forEach((application) => allVisibleSelected ? next.delete(application.id) : next.add(application.id))
      return next
    })
  }

  const downloadSelectedZip = async () => {
    if (!selectedIds.size || exporting) return
    setExporting(true)
    setExportProgress('Preparando solicitudes…')
    setError('')
    setNotice('')
    try {
      const [{ default: JSZip }, { buildApplicationPdf, downloadApplicationFile, safeFilename }] = await Promise.all([
        import('jszip'),
        import('./lib/application-export'),
      ])
      const zip = new JSZip()
      const idsToExport = new Set(selectedIds)
      let processed = 0
      let offset = 0
      let hasNextPage = true
      while (hasNextPage && processed < idsToExport.size) {
        const page = await callAdmin({ action: 'list', status: filter, offset: String(offset) })
        const rows = (page.applications ?? []) as Application[]
        for (const application of rows) {
          if (!idsToExport.has(application.id)) continue
          processed += 1
          setExportProgress(`Solicitud ${processed} de ${idsToExport.size}: descargando adjuntos…`)
          const attachments = await getAttachments(application, downloadApplicationFile)
          const pdf = await buildApplicationPdf(application, attachments, `${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`)
          const folder = zip.folder(`solicitud-${application.id.slice(0, 8)}-${safeFilename(application.full_name)}`)
          if (!folder) throw new Error('No se pudo preparar una carpeta del archivo ZIP.')
          folder.file('solicitud.pdf', pdf)
          const attachmentsFolder = folder.folder('adjuntos')
          attachments.forEach(({ document, bytes }, index) => {
            attachmentsFolder?.file(`${String(index + 1).padStart(2, '0')}-${safeFilename(document.original_filename)}`, bytes)
          })
        }
        hasNextPage = Boolean(page.has_more)
        offset = Number(page.next_offset ?? offset + rows.length)
      }
      if (processed !== idsToExport.size) throw new Error('Algunas solicitudes ya no están disponibles en este filtro. Volvé a seleccionarlas e intentá de nuevo.')
      setExportProgress(`Comprimiendo ${processed} solicitudes en un ZIP…`)
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => {
        setExportProgress(`Comprimiendo ZIP… ${Math.round(metadata.percent)}%`)
      })
      downloadBlob(blob, `Solicitudes-Prestamos-Variety-${new Date().toISOString().slice(0, 10)}.zip`)
      setNotice(`Se descargó el ZIP con ${processed} solicitudes, cada una con su PDF y sus archivos originales.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar el archivo ZIP. Si seleccionaste muchas solicitudes, dividí la descarga en grupos más pequeños.')
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }

  const whatsAppMessage = whatsAppApplicant
    ? `Hola ${whatsAppApplicant.full_name}. Revisamos tu solicitud y cumplís con las condiciones para acceder a un préstamo. Para continuar con el proceso, respondé este mensaje y un asesor te brindará el asesoramiento sobre los próximos pasos. — Préstamos Variety.`
    : ''

  if (!session) {
    return (
      <main className="admin-login">
        <div className="admin-brand"><span className="logo-frame admin-logo-frame"><img src={`${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`} alt="Préstamos Variety" /></span><div><b>PRÉSTAMOS VARIETY</b><small>Administración de préstamos</small></div></div>
        <form onSubmit={signIn}>
          <h1>Ingresar</h1>
          <p>Acceso exclusivo para personal autorizado.</p>
          <label>Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button className="admin-primary">Iniciar sesión</button>
        </form>
      </main>
    )
  }

  return (
    <main className="admin-shell">
      {selected && (
        <article className="application-print" aria-hidden="true">
          <header className="pdf-brand-header">
            <span className="logo-frame pdf-logo-frame"><img src={`${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`} alt="" /></span>
            <div><b>PRÉSTAMOS VARIETY</b><small>PRÉSTAMOS PERSONALES</small></div>
          </header>
          <section className="pdf-hero">
            <span className="pdf-kicker">SOLICITUD PERSONAL · {statusLabel[selected.status] || selected.status}</span>
            <h1>Solicitud de préstamo</h1>
            <p>{selected.full_name}</p>
            <small>Solicitud #{applicationReference(selected.id)} · {formatDateTime(selected.created_at)}</small>
          </section>

          <PdfSection number="01" title="Datos personales">
            <PdfField label="Nombre y apellido" value={selected.full_name} />
            <PdfField label="DNI" value={selected.dni} />
            <PdfField label="¿Tiene el DNI actualizado?" value={selected.dni_updated ? 'Sí' : 'No'} />
            <PdfField label="Teléfono personal" value={selected.phone} />
            <PdfField label="Teléfono alternativo" value={selected.alternate_phone} />
            <PdfField label="Vínculo con el contacto alternativo" value={selected.alternate_phone_relationship} />
            <PdfField label="¿Vino recomendado por alguien?" value={selected.has_referrer ? 'Sí' : 'No'} />
            <PdfField label="¿Es cliente de Electro Variety?" value={typeof selected.is_electro_variety_client === 'boolean' ? selected.is_electro_variety_client ? 'Sí' : 'No' : 'No informado'} />
            {selected.has_referrer && <>
              <PdfField label="Nombre de quien recomendó" value={selected.referrer_full_name} />
              <PdfField label="Teléfono de quien recomendó" value={selected.referrer_phone} />
              <PdfField label="Vínculo con quien recomendó" value={selected.referrer_relationship} />
            </>}
          </PdfSection>

          <PdfSection number="02" title="Domicilio">
            <PdfField label="Calle y número" value={selected.address} />
            <PdfField label="Entre calles" value={selected.between_streets} />
            <PdfField label="Localidad" value={selected.locality} />
            <PdfField label="Situación de vivienda" value={housingLabels[selected.housing_type] || selected.housing_type} />
          </PdfSection>

          <PdfSection number="03" title="Comprobante de domicilio">
            <PdfField label="Servicios o comprobantes declarados" value={selected.service_types?.length ? selected.service_types.map((service) => serviceLabels[service] || service).join(', ') : 'Ninguno informado'} />
            {selected.service_types?.some((service) => service !== 'none') && <>
              <PdfField label="¿El servicio está a nombre de la persona?" value={selected.has_service_in_own_name ? 'Sí' : 'No'} />
              {!selected.has_service_in_own_name && <>
                <PdfField label="Nombre del titular del servicio" value={selected.service_holder_name} />
                <PdfField label="DNI del titular del servicio" value={selected.service_holder_dni} />
                <PdfField label="Vínculo con el titular" value={selected.service_holder_relationship} />
              </>}
            </>}
          </PdfSection>

          <PdfSection number="04" title="Situación financiera">
            <PdfField label="¿Tiene deudas actualmente?" value={selected.has_debts ? 'Sí' : 'No'} />
            {selected.has_debts && <>
              <PdfField label="Motivo de la deuda" value={selected.debt_reason} />
              <PdfField label="Monto aproximado de la deuda" value={money(selected.debt_amount)} />
            </>}
          </PdfSection>

          <PdfSection number="05" title="Trabajo e ingresos">
            {selected.incomes.length ? selected.incomes.map((income, index) => (
              <div className="pdf-income" key={String(income.source_type) + index}>
                <h3>{incomeLabels[String(income.source_type)] || String(income.source_type)}</h3>
                <PdfField label="Ingreso mensual aproximado" value={money(income.monthly_income)} />
                {incomeDetailFields.map(([key, label, isMoney]) => {
                  const value = income[key]
                  if (value === null || value === undefined || value === '') return null
                  return <PdfField key={key} label={label} value={isMoney ? money(value) : value} />
                })}
              </div>
            )) : <PdfField label="Fuentes de ingreso" value="Sin datos de ingresos" />}
          </PdfSection>

          <PdfSection number="06" title="Tu préstamo">
            <PdfField label="Monto solicitado" value={money(selected.loan_amount)} />
            <PdfField label="Modalidad de cuotas" value={`${selected.installment_count} cuotas ${selected.loan_frequency === 'weekly' ? 'semanales' : selected.loan_frequency === 'fortnightly' ? 'quincenales' : 'mensuales'}`} />
            <PdfField label="Valor de cada cuota" value={money(selected.installment_amount)} />
            <PdfField label="Total estimado a pagar" value={money(selected.total_to_pay)} />
            <PdfField label="¿Para qué necesita el préstamo?" value={selected.loan_purpose} />
          </PdfSection>

          <section className="pdf-consents">
            <b>Consentimientos</b>
            <p>Tratamiento de datos: {selected.privacy_accepted ? 'Aceptado' : 'No registrado'}</p>
            <p>Notificación del resultado por WhatsApp: {selected.whatsapp_rejection_opt_in ? 'Aceptada' : 'No aceptada'}</p>
            {selected.whatsapp_rejection_opt_in_at && <small>Consentimiento de WhatsApp registrado el {formatDateTime(selected.whatsapp_rejection_opt_in_at)}</small>}
          </section>

          <section className="pdf-documents">
            <div className="pdf-section-heading"><span>＋</span><h2>Documentación adjunta</h2></div>
            {selected.documents.length ? selected.documents.map((document) => (
              <p key={document.id}><b>{documentLabels[document.document_type] || document.document_type}</b><br /><small>{document.original_filename} · {Math.max(1, Math.round(document.file_size_bytes / 1024))} KB</small></p>
            )) : <p>No hay documentos cargados.</p>}
          </section>
          <footer className="pdf-footer">Préstamos Variety · Solicitud personal · Información confidencial</footer>
        </article>
      )}
      <header className="admin-top">
        <div className="admin-brand"><span className="logo-frame admin-logo-frame"><img src={`${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`} alt="Préstamos Variety" /></span><div><b>PRÉSTAMOS VARIETY</b><small>Panel de solicitudes</small></div></div>
        <button className="admin-logout" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
      </header>
      <section className="admin-heading">
        <div><p className="admin-kicker">GESTIÓN DE CRÉDITOS</p><h1>Solicitudes de préstamos</h1><p>Revisá los datos y documentos antes de tomar una decisión.</p></div>
        <select aria-label="Filtrar solicitudes" value={filter} onChange={(event) => { setSelectedIds(new Set()); setFilter(event.target.value) }}>
          <option value="pending">Pendientes</option><option value="under_review">En revisión</option><option value="approved">Aprobadas</option><option value="rejected">Rechazadas</option><option value="all">Todas</option><option value="archived">Archivadas</option>
        </select>
      </section>
      {(error || notice) && <p className={error ? 'admin-error' : 'admin-message'} role="status">{error || notice}</p>}
      {whatsAppApplicant && (
        <section className="whatsapp-card" aria-label="Mensaje de aprobación por WhatsApp">
          <div>
            <h2>Continuar el asesoramiento por WhatsApp</h2>
            <p>Revisá el número y el texto. WhatsApp Business se abrirá para que confirmes el envío.</p>
          </div>
          <label>Número de WhatsApp
            <input type="tel" value={whatsAppNumber} onChange={(event) => setWhatsAppNumber(event.target.value)} placeholder="+549…" />
          </label>
          <label>Mensaje
            <textarea rows={4} readOnly value={whatsAppMessage} />
          </label>
          {/^549\d{10}$/.test(whatsAppDigits)
            ? <a className="whatsapp-link" href={`https://wa.me/${whatsAppDigits}?text=${encodeURIComponent(whatsAppMessage)}`} target="_blank" rel="noreferrer">Abrir chat en WhatsApp</a>
            : <p className="whatsapp-hint">El número se prepara con el prefijo +549. Corregilo si hace falta; para Argentina debe tener +549 y 10 dígitos.</p>}
          <button className="whatsapp-dismiss" onClick={() => { setWhatsAppApplicant(null); setWhatsAppNumber('') }}>Cerrar aviso</button>
        </section>
      )}
      {pdfPreviewUrl && (
        <div className="pdf-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closePdfPreview() }}>
          <section className="pdf-preview-dialog" role="dialog" aria-modal="true" aria-label="Vista previa de la solicitud en PDF">
            <header><b>Vista previa de la solicitud</b><button onClick={closePdfPreview} aria-label="Cerrar vista previa">×</button></header>
            <iframe title="Solicitud en formato PDF" src={`${pdfPreviewUrl}#toolbar=0&navpanes=0`} />
          </section>
        </div>
      )}
      <div className="admin-layout">
        <section className="admin-list" aria-label="Listado de solicitudes">
          <div className="admin-list-header"><b>{applications.length} solicitudes cargadas</b><button onClick={() => void loadApplications()} disabled={loading}>Actualizar</button></div>
          <div className="bulk-export-toolbar">
            <b>{selectedIds.size} seleccionadas</b>
            <div className="bulk-export-actions">
              <button onClick={selectVisibleApplications} disabled={!applications.length || loading || exporting}>Seleccionar todas del filtro</button>
              <button onClick={() => setSelectedIds(new Set())} disabled={!selectedIds.size || exporting}>Limpiar</button>
              <button className="bulk-download-button" onClick={() => void downloadSelectedZip()} disabled={!selectedIds.size || exporting} aria-label={exporting ? 'Preparando el archivo ZIP' : 'Descargar solicitudes seleccionadas en ZIP'} title={exporting ? 'Preparando el archivo ZIP' : 'Descargar solicitudes seleccionadas en ZIP'}>
                <img className="download-logo" src={`${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`} alt="" aria-hidden="true" />
              </button>
            </div>
            {exportProgress && <p role="status">{exportProgress}</p>}
            <small>Se muestran todas las solicitudes del filtro. Para incluir archivadas, elegí “Archivadas” arriba.</small>
          </div>
          {loading && <p className="admin-empty">Cargando…</p>}
          {!loading && applications.length === 0 && <p className="admin-empty">No hay solicitudes en este filtro.</p>}
          {applications.map((application) => (
            <div className="application-list-item" key={application.id}>
              <input
                type="checkbox"
                aria-label={`Seleccionar solicitud de ${application.full_name}`}
                checked={selectedIds.has(application.id)}
                onChange={() => toggleApplication(application.id)}
              />
              <button className={'application-row ' + (selected?.id === application.id ? 'is-selected' : '')} onClick={() => { setSelected(application); setDecisionNote('') }}>
                <span className={'status-dot status-' + application.status} />
                <span className="application-summary"><b>{application.full_name}</b><small>DNI {application.dni} · {new Date(application.created_at).toLocaleDateString('es-AR')}{application.archived_at ? ' · Archivada' : ''}</small></span>
                <strong>{money(application.loan_amount)}</strong>
              </button>
            </div>
          ))}
        </section>
        <section className="application-detail">
          {!selected ? <div className="admin-empty detail-placeholder">Elegí una solicitud para ver sus datos y documentación.</div> : (
            <>
              <div className="detail-header">
                <div><span className={'status-badge status-' + selected.status}>{statusLabel[selected.status] || selected.status}</span>{selected.archived_at && <span className="archived-badge">Archivada</span>}<h2>{selected.full_name}</h2><p>Solicitud #{applicationReference(selected.id)} · {formatDateTime(selected.created_at)}</p></div>
                <div className="detail-header-actions">
                  <button className="archive-button" onClick={() => void setApplicationArchived(!selected.archived_at)} disabled={loading}>{selected.archived_at ? 'Restaurar' : 'Archivar'}</button>
                  <button className="pdf-preview-button" onClick={() => void previewApplicationPdf()} disabled={exporting} aria-label="Ver solicitud como PDF" title="Ver solicitud como PDF">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>Ver PDF</span>
                  </button>
                  <button className="pdf-download-button" onClick={() => void downloadApplicationPdf()} disabled={exporting} aria-label={exporting ? 'Preparando PDF' : 'Descargar PDF de esta solicitud'} title={exporting ? 'Preparando PDF' : 'Descargar PDF de esta solicitud'}>
                    <img className="download-logo" src={`${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`} alt="" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="detail-subsection">
                <h3>Datos personales</h3>
                <div className="detail-grid">
                  <div><small>Nombre y apellido</small><b>{selected.full_name}</b></div>
                  <div><small>DNI</small><b>{selected.dni}</b></div>
                  <div><small>¿Tiene el DNI actualizado?</small><b>{selected.dni_updated ? 'Sí' : 'No'}</b></div>
                  <div><small>Teléfono personal</small><b>{selected.phone}</b></div>
                  <div><small>Teléfono alternativo</small><b>{selected.alternate_phone}</b></div>
                  <div><small>Vínculo con el contacto alternativo</small><b>{selected.alternate_phone_relationship}</b></div>
                  <div><small>¿Vino recomendado?</small><b>{selected.has_referrer ? 'Sí' : 'No'}</b></div>
                  <div><small>¿Es cliente de Electro Variety?</small><b>{typeof selected.is_electro_variety_client === 'boolean' ? selected.is_electro_variety_client ? 'Sí' : 'No' : 'No informado'}</b></div>
                  {selected.has_referrer && <>
                    <div><small>Nombre de quien recomendó</small><b>{selected.referrer_full_name || '—'}</b></div>
                    <div><small>Teléfono de quien recomendó</small><b>{selected.referrer_phone || '—'}</b></div>
                    <div><small>Vínculo con quien recomendó</small><b>{selected.referrer_relationship || '—'}</b></div>
                  </>}
                </div>
              </div>
              <div className="detail-subsection">
                <h3>Domicilio</h3>
                <div className="detail-grid">
                  <div><small>Calle y número</small><b>{selected.address}</b></div>
                  <div><small>Entre calles</small><b>{selected.between_streets || '—'}</b></div>
                  <div><small>Localidad</small><b>{selected.locality}</b></div>
                  <div><small>Situación de vivienda</small><b>{housingLabels[selected.housing_type] || selected.housing_type || '—'}</b></div>
                </div>
              </div>
              <div className="detail-subsection">
                <h3>Comprobante de domicilio</h3>
                <div className="detail-grid">
                  <div><small>Servicios o comprobantes declarados</small><b>{selected.service_types?.length ? selected.service_types.map((service) => serviceLabels[service] || service).join(', ') : 'Ninguno informado'}</b></div>
                  {selected.service_types?.some((service) => service !== 'none') && <>
                    <div><small>¿El servicio está a nombre de la persona?</small><b>{selected.has_service_in_own_name ? 'Sí' : 'No'}</b></div>
                    {!selected.has_service_in_own_name && <>
                      <div><small>Nombre del titular del servicio</small><b>{selected.service_holder_name || '—'}</b></div>
                      <div><small>DNI del titular del servicio</small><b>{selected.service_holder_dni || '—'}</b></div>
                      <div><small>Vínculo con el titular</small><b>{selected.service_holder_relationship || '—'}</b></div>
                    </>}
                  </>}
                </div>
              </div>
              <div className="detail-subsection">
                <h3>Situación financiera</h3>
                <div className="detail-grid">
                  <div><small>¿Tiene deudas actualmente?</small><b>{selected.has_debts ? 'Sí' : 'No'}</b></div>
                  {selected.has_debts && <>
                    <div><small>Motivo de la deuda</small><b>{selected.debt_reason || '—'}</b></div>
                    <div><small>Monto aproximado de la deuda</small><b>{money(selected.debt_amount)}</b></div>
                  </>}
                </div>
              </div>
              <div className="detail-subsection">
                <h3>Trabajo e ingresos</h3>
                {selected.incomes.length ? selected.incomes.map((income, index) => (
                  <div className="income-detail" key={String(income.source_type) + index}>
                    <div className="income-row"><b>{incomeLabels[String(income.source_type)] || String(income.source_type)}</b><span>{money(income.monthly_income)} por mes</span></div>
                    <div className="detail-grid income-fields">
                      {incomeDetailFields.map(([key, label, isMoney]) => {
                        const value = income[key]
                        if (value === null || value === undefined || value === '') return null
                        return <div key={key}><small>{label}</small><b>{isMoney ? money(value) : String(value)}</b></div>
                      })}
                    </div>
                  </div>
                )) : <p>Sin datos de ingresos.</p>}
              </div>
              <div className="detail-subsection">
                <h3>Préstamo solicitado</h3>
                <div className="detail-grid">
                  <div><small>Monto solicitado</small><b>{money(selected.loan_amount)}</b></div>
                  <div><small>Modalidad de cuotas</small><b>{selected.installment_count} cuotas {selected.loan_frequency === 'weekly' ? 'semanales' : selected.loan_frequency === 'fortnightly' ? 'quincenales' : 'mensuales'} de {money(selected.installment_amount)}</b></div>
                  <div><small>Total estimado a pagar</small><b>{money(selected.total_to_pay)}</b></div>
                  <div className="detail-wide"><small>¿Para qué necesita el préstamo?</small><b>{selected.loan_purpose}</b></div>
                </div>
              </div>
              <div className="detail-subsection">
                <h3>Consentimientos</h3>
                <div className="detail-grid">
                  <div><small>Aceptó el tratamiento de datos</small><b>{selected.privacy_accepted ? 'Sí' : 'No registrado'}</b></div>
                  <div><small>Aceptó recibir el resultado por WhatsApp</small><b>{selected.whatsapp_rejection_opt_in ? 'Sí' : 'No'}</b></div>
                  {selected.whatsapp_rejection_opt_in_at && <div><small>Fecha del consentimiento de WhatsApp</small><b>{formatDateTime(selected.whatsapp_rejection_opt_in_at)}</b></div>}
                </div>
              </div>
              <div className="detail-subsection">
                <h3>Documentación <span>{selected.documents.length}</span></h3>
                {selected.documents.length ? selected.documents.map((document) => (
                  document.signed_url ? (
                    <a className="document-row" key={document.id} href={document.signed_url} target="_blank" rel="noreferrer">
                      <span>▧</span><span><b>{documentLabels[document.document_type] || document.document_type}</b><small>{document.original_filename} · {Math.max(1, Math.round(document.file_size_bytes / 1024))} KB</small></span><strong>Ver ↗</strong>
                    </a>
                  ) : (
                    <div className="document-row" key={document.id} aria-label="Enlace temporal no disponible">
                      <span>▧</span><span><b>{documentLabels[document.document_type] || document.document_type}</b><small>{document.original_filename} · {Math.max(1, Math.round(document.file_size_bytes / 1024))} KB · Actualizá para intentar de nuevo</small></span><strong>No disponible</strong>
                    </div>
                  )
                )) : <p>No hay documentos cargados.</p>}
              </div>
              {(selected.decided_at || selected.decided_by || selected.admin_notes) && (
                <div className="detail-subsection">
                  <h3>Registro de decisión</h3>
                  {selected.decided_at && <p><b>Fecha:</b> {formatDateTime(selected.decided_at)}</p>}
                  {selected.decided_by && <p><b>Cuenta administradora:</b> {selected.decided_by === session.user.id ? session.user.email || selected.decided_by : selected.decided_by}</p>}
                  {selected.admin_notes && <p><b>Nota interna:</b> {selected.admin_notes}</p>}
                </div>
              )}
              {selected.status === 'rejected' && (
                <div className="detail-subsection">
                  <h3>Aviso de rechazo por WhatsApp</h3>
                  {!selected.whatsapp_rejection_opt_in
                    ? <p>No se envió: la persona no aceptó recibir el aviso por WhatsApp.</p>
                    : <>
                        <p><b>Estado:</b> {{
                          pending: 'Pendiente de configuración',
                          sending: 'En proceso',
                          sent: 'Enviado',
                          failed: 'Falló el envío',
                          unknown: 'No se pudo confirmar el resultado',
                          not_eligible: 'Sin consentimiento',
                        }[selected.whatsapp_rejection_status] || selected.whatsapp_rejection_status}</p>
                        {selected.whatsapp_rejection_sent_at && <p><b>Fecha de envío:</b> {formatDateTime(selected.whatsapp_rejection_sent_at)}</p>}
                        {selected.whatsapp_rejection_error_code && <p><b>Detalle técnico:</b> {selected.whatsapp_rejection_error_code}</p>}
                        {(selected.whatsapp_rejection_status === 'pending' || selected.whatsapp_rejection_status === 'failed') && (
                          <button className="whatsapp-prepare" disabled={loading} onClick={() => void retryRejectionWhatsApp()}>
                            {selected.whatsapp_rejection_status === 'pending' ? 'Intentar envío por WhatsApp' : 'Reintentar aviso por WhatsApp'}
                          </button>
                        )}
                      </>}
                </div>
              )}
              {selected.status === 'approved' && (
                <div className="detail-subsection">
                  <button className="whatsapp-prepare" onClick={() => prepareWhatsAppMessage(selected)}>Preparar mensaje por WhatsApp</button>
                </div>
              )}
              {(selected.status === 'pending' || selected.status === 'under_review') && (
                <>
                  <div className="detail-subsection">
                    <label className="admin-note-label" htmlFor="decision-note">Nota interna para esta decisión (opcional)</label>
                    <textarea
                      id="decision-note"
                      className="admin-note-input"
                      rows={3}
                      maxLength={2000}
                      value={decisionNote}
                      onChange={(event) => setDecisionNote(event.target.value)}
                    />
                    <small>{decisionNote.length}/2000 caracteres</small>
                  </div>
                  <div className="decision-actions"><button disabled={loading} className="reject-button" onClick={() => void decide('rejected')}>Rechazar</button><button disabled={loading} className="approve-button" onClick={() => void decide('approved')}>Aprobar solicitud</button></div>
                </>
              )}
              <div className="delete-actions"><button disabled={loading} className="delete-button" onClick={() => void deleteApplication()}>Eliminar solicitud y documentos</button></div>
            </>
          )}
        </section>
      </div>
      <footer className="admin-privacy">La información de las solicitudes es confidencial. Los documentos se abren mediante enlaces privados temporales.</footer>
    </main>
  )
}
