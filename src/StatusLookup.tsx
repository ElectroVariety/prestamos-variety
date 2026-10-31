import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabase'
import { formatDateTime } from './lib/format'

type StatusResult = {
  status: 'pending' | 'under_review' | 'approved' | 'rejected'
  created_at: string
  decided_at: string | null
}

const labels: Record<StatusResult['status'], string> = {
  pending: 'Pendiente',
  under_review: 'En revisión',
  approved: 'Aprobada',
  rejected: 'Rechazada',
}

export default function StatusLookup({ initialCode }: { initialCode?: string | null }) {
  const [code, setCode] = useState(initialCode ?? '')
  const [result, setResult] = useState<StatusResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [deletionOpen, setDeletionOpen] = useState(false)
  const [dniConfirmation, setDniConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deletionProgress, setDeletionProgress] = useState(0)
  const [deletionError, setDeletionError] = useState('')
  const [deleted, setDeleted] = useState(false)

  useEffect(() => {
    if (initialCode) setCode(initialCode)
  }, [initialCode])

  const lookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('check-loan-status', {
        body: { code: code.trim() },
      })
      if (invokeError) throw new Error(invokeError.message)
      if (!data?.success) throw new Error(data?.error || 'No se pudo consultar el estado.')
      if (!['pending', 'under_review', 'approved', 'rejected'].includes(data.status)) {
        throw new Error('La respuesta recibida no contiene un estado válido.')
      }
      setResult(data as StatusResult)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar el estado.')
    } finally {
      setLoading(false)
    }
  }

  const deleteRejectedData = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (result?.status !== 'rejected' || deleting) return
    setDeleting(true)
    setDeletionProgress(0)
    setDeletionError('')
    const minimumProgressDurationMs = 8000
    const startedAt = performance.now()
    const progressTimer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt
      setDeletionProgress(Math.min(90, Math.floor((elapsed / minimumProgressDurationMs) * 90)))
    }, 100)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('check-loan-status', {
        body: { action: 'delete_rejected', code: code.trim(), dni: dniConfirmation },
      })
      if (invokeError) throw new Error(invokeError.message)
      if (!data?.success || data.deleted !== true) throw new Error(data?.error || 'No se pudo completar la eliminación.')
      const remainingTime = minimumProgressDurationMs - (performance.now() - startedAt)
      if (remainingTime > 0) await new Promise((resolve) => window.setTimeout(resolve, remainingTime))
      window.clearInterval(progressTimer)
      setDeletionProgress(100)
      setDeleted(true)
      setResult(null)
      setCode('')
      setDniConfirmation('')
      setDeletionOpen(false)
    } catch (cause) {
      window.clearInterval(progressTimer)
      setDeletionProgress(0)
      setDeletionError(cause instanceof Error ? cause.message : 'No se pudo completar la eliminación. Intentá nuevamente.')
    } finally {
      window.clearInterval(progressTimer)
      setDeleting(false)
    }
  }

  if (deleted) {
    return (
      <section id="consultar-estado" className="status-lookup status-deletion-complete" role="status">
        <span className="deletion-success-icon" aria-hidden="true">✓</span>
        <h2>Eliminación completada</h2>
        <div className="deletion-progress-label"><span>Eliminación completada</span><strong>100%</strong></div>
        <div className="deletion-progress" role="progressbar" aria-label="Eliminación completada" aria-valuemin={0} aria-valuemax={100} aria-valuenow={100}>
          <span className="deletion-progress-fill" style={{ width: '100%' }} />
        </div>
        <p>Los datos personales, financieros y documentos de esta solicitud se eliminaron correctamente.</p>
        <small>Se conserva una huella protegida no reversible del DNI únicamente para mantener el bloqueo de nuevas solicitudes tras el rechazo.</small>
      </section>
    )
  }

  return (
    <section id="consultar-estado" className="status-lookup">
      <div className="status-lookup-heading">
        <span className="section-number" aria-hidden="true">✓</span>
        <div><h2>Consultar estado de solicitud</h2><p>Ingresá el código de seguimiento que recibiste al enviarla.</p></div>
      </div>
      <form onSubmit={(event) => void lookup(event)}>
        <label htmlFor="tracking-code">Código de seguimiento</label>
        <div className="status-lookup-controls">
          <input
            id="tracking-code"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={44}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ABC-123-XYZ"
            required
          />
          <button className="status-lookup-submit" type="submit" disabled={loading}>{loading ? 'Consultando…' : 'Consultar'}</button>
        </div>
      </form>
      {error && <p className="status-lookup-error" role="alert">{error}</p>}
      {result && (
        <div className="status-lookup-result" role="status">
          <span className={`status-lookup-badge status-${result.status}`}>{labels[result.status]}</span>
          <p>Solicitud recibida el {formatDateTime(result.created_at)}.</p>
          {result.decided_at && <p>Decisión registrada el {formatDateTime(result.decided_at)}.</p>}
          <small>Por privacidad, esta consulta solo muestra el estado de la solicitud.</small>
        </div>
      )}
      {result?.status === 'rejected' && !deletionOpen && (
        <button className="request-data-deletion" type="button" onClick={() => { setDeletionError(''); setDeletionOpen(true) }}>
          Eliminar los datos de esta solicitud
        </button>
      )}
      {result?.status === 'rejected' && deletionOpen && (
        <form className="delete-data-form" onSubmit={(event) => void deleteRejectedData(event)}>
          <h3>Confirmar eliminación</h3>
          <p>Se eliminarán permanentemente los datos personales, financieros y documentos de esta solicitud. Para confirmar, ingresá el DNI asociado.</p>
          <label htmlFor="deletion-dni">DNI de la solicitud</label>
          <input id="deletion-dni" type="text" inputMode="numeric" autoComplete="off" value={dniConfirmation} onChange={(event) => setDniConfirmation(event.target.value)} required disabled={deleting} />
          {deleting && <>
            <div className="deletion-progress-label"><span>Eliminando datos y archivos…</span><strong>{deletionProgress}%</strong></div>
            <div className="deletion-progress" role="progressbar" aria-label="Eliminando datos de la solicitud" aria-valuemin={0} aria-valuemax={100} aria-valuenow={deletionProgress}>
              <span className="deletion-progress-fill" style={{ width: `${deletionProgress}%` }} />
            </div>
          </>}
          {deletionError && <p className="status-lookup-error" role="alert">{deletionError}</p>}
          <small>Se conservará únicamente una huella protegida no reversible del DNI para mantener el bloqueo de nuevas solicitudes tras el rechazo.</small>
          <div className="delete-data-actions">
            <button type="button" className="delete-data-cancel" onClick={() => setDeletionOpen(false)} disabled={deleting}>Cancelar</button>
            <button type="submit" className="delete-data-confirm" disabled={deleting}>{deleting ? 'Eliminando…' : 'Confirmar eliminación'}</button>
          </div>
        </form>
      )}
    </section>
  )
}
