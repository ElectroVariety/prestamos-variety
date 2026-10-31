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
    </section>
  )
}
