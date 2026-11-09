
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { supabase } from './lib/supabase'
import StatusLookup from './StatusLookup'
import './App.css'

type IncomeType =
  | 'formal'
  | 'informal'
  | 'selfEmployed'
  | 'business'
  | 'allowance'
  | 'retirement'
  | 'pension'
  | 'cooperative'
  | 'other'

type LoanFrequency = 'weekly' | 'fortnightly' | 'monthly'

type LoanPlan = {
  installments: number
  amount: number
}

type GeoSuggestion = { id: string; label: string; detail: string }

type PickedLocality = { id: string; name: string }
type PickedStreet = { id: string; name: string }

async function fetchGeorefSuggestions(resource: 'localidades' | 'calles', query: string, parentId: string | null, signal: AbortSignal): Promise<GeoSuggestion[]> {
  const url = new URL(`https://apis.datos.gob.ar/georef/api/v2.0/${resource}`)
  url.searchParams.set(resource === 'localidades' ? 'nombre' : 'nombre', query)
  url.searchParams.set('max', '8')
  if (resource === 'calles' && parentId) url.searchParams.set('localidad', parentId)
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(response.status === 429 ? 'Georef está recibiendo muchas consultas. Probá nuevamente en unos segundos.' : 'No se pudieron cargar las sugerencias de ubicación.')
  const body = await response.json() as Record<string, unknown>
  const entries = Array.isArray(body[resource]) ? body[resource] as Array<Record<string, unknown>> : []
  return entries.flatMap((entry): GeoSuggestion[] => {
    if (typeof entry.id !== 'string' || typeof entry.nombre !== 'string') return []
    const province = entry.provincia && typeof entry.provincia === 'object' ? (entry.provincia as Record<string, unknown>).nombre : null
    const department = entry.departamento && typeof entry.departamento === 'object' ? (entry.departamento as Record<string, unknown>).nombre : null
    return [{
      id: entry.id,
      label: entry.nombre,
      detail: resource === 'localidades'
        ? [department, province].filter((item): item is string => typeof item === 'string').join(' · ')
        : (typeof entry.nomenclatura === 'string' ? entry.nomenclatura : [entry.categoria, province].filter((item): item is string => typeof item === 'string').join(' · ')),
    }]
  })
}

function GeoPredictiveInput({
  id, value, options, disabled, loading, error, placeholder, onChange, onSelect, onUseTyped,
}: {
  id: string
  value: string
  options: GeoSuggestion[]
  disabled?: boolean
  loading: boolean
  error: string
  placeholder: string
  onChange: (value: string) => void
  onSelect: (option: GeoSuggestion) => void
  onUseTyped: () => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const listId = `${id}-suggestions`
  const canSuggest = !disabled && value.trim().length >= 3
  const optionCount = options.length + 1
  return (
    <div className="geo-predictive">
      <input
        id={id}
        type="text"
        value={value}
        required
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && canSuggest}
        aria-controls={listId}
        aria-activedescendant={open && canSuggest ? `${listId}-${activeIndex}` : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(0) }}
        onKeyDown={(event) => {
          if (!open || !canSuggest) return
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (index + 1) % optionCount) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (index + optionCount - 1) % optionCount) }
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter' && activeIndex === options.length) { event.preventDefault(); onUseTyped(); setOpen(false) }
          if (event.key === 'Enter' && options[activeIndex]) { event.preventDefault(); onSelect(options[activeIndex]); setOpen(false) }
        }}
      />
      {open && canSuggest && (
        <div id={listId} className="geo-suggestions" role="listbox">
          {loading && <div className="geo-suggestion-status">Buscando sugerencias…</div>}
          {!loading && error && <div className="geo-suggestion-status geo-suggestion-error">{error}</div>}
          {!loading && !error && options.length === 0 && <div className="geo-suggestion-status">No encontramos coincidencias oficiales.</div>}
          {!loading && options.map((option, index) => (
            <button
              id={`${listId}-${index}`}
              className="geo-suggestion-option"
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              key={option.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onSelect(option); setOpen(false) }}
            >
              <b>{option.label}</b>{option.detail && <small>{option.detail}</small>}
            </button>
          ))}
          <button
            id={`${listId}-${options.length}`}
            className="geo-suggestion-manual"
            type="button"
            role="option"
            aria-selected={activeIndex === options.length}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { onUseTyped(); setOpen(false) }}
          >
            Usar “{value.trim()}” como está escrito
          </button>
        </div>
      )}
    </div>
  )
}

const loanPlans: Record<number, Record<LoanFrequency, LoanPlan>> = {
  100000: {
    weekly: { installments: 20, amount: 12000 },
    fortnightly: { installments: 10, amount: 23000 },
    monthly: { installments: 5, amount: 45000 },
  },
  200000: {
    weekly: { installments: 20, amount: 23000 },
    fortnightly: { installments: 10, amount: 45000 },
    monthly: { installments: 5, amount: 90000 },
  },
  300000: {
    weekly: { installments: 20, amount: 34000 },
    fortnightly: { installments: 10, amount: 68000 },
    monthly: { installments: 5, amount: 135000 },
  },
  400000: {
    weekly: { installments: 20, amount: 45000 },
    fortnightly: { installments: 10, amount: 90000 },
    monthly: { installments: 5, amount: 180000 },
  },
  500000: {
    weekly: { installments: 20, amount: 57000 },
    fortnightly: { installments: 10, amount: 113000 },
    monthly: { installments: 5, amount: 225000 },
  },
  600000: {
    weekly: { installments: 20, amount: 68000 },
    fortnightly: { installments: 10, amount: 135000 },
    monthly: { installments: 5, amount: 270000 },
  },
  700000: {
    weekly: { installments: 20, amount: 79000 },
    fortnightly: { installments: 10, amount: 158000 },
    monthly: { installments: 5, amount: 315000 },
  },
  800000: {
    weekly: { installments: 20, amount: 90000 },
    fortnightly: { installments: 10, amount: 180000 },
    monthly: { installments: 5, amount: 360000 },
  },
  900000: {
    weekly: { installments: 20, amount: 102000 },
    fortnightly: { installments: 10, amount: 203000 },
    monthly: { installments: 5, amount: 405000 },
  },
  1000000: {
    weekly: { installments: 20, amount: 113000 },
    fortnightly: { installments: 10, amount: 225000 },
    monthly: { installments: 5, amount: 450000 },
  },
}

const incomeOptions: { value: IncomeType; label: string }[] = [
  { value: 'formal', label: 'Trabajo en blanco' },
  { value: 'informal', label: 'Trabajo en negro' },
  { value: 'selfEmployed', label: 'Trabajo por cuenta propia' },
  { value: 'business', label: 'Tengo un comercio' },
  { value: 'allowance', label: 'Cobro una asignación' },
  { value: 'retirement', label: 'Cobro una jubilación' },
  { value: 'pension', label: 'Cobro una pensión' },
  { value: 'cooperative', label: 'Cobro de una cooperativa' },
  { value: 'other', label: 'Otros ingresos' },
]

const incomeLabels: Record<IncomeType, string> = {
  formal: 'Trabajo en blanco',
  informal: 'Trabajo en negro',
  selfEmployed: 'Trabajo por cuenta propia',
  business: 'Comercio propio',
  allowance: 'Asignación',
  retirement: 'Jubilación',
  pension: 'Pensión',
  cooperative: 'Cooperativa',
  other: 'Otros ingresos',
}

const deliveryPhotos = [
  'entrega-1.jpeg',
  'entrega-2.jpeg',
  'entrega-3.jpeg',
  'entrega-4.jpeg',
  'entrega-5.jpeg',
  'entrega-chatgpt-1.jpg',
  'entrega-chatgpt-2.jpg',
  'entrega-chatgpt-3.jpg',
  'entrega-chatgpt-4.jpg',
  'entrega-chatgpt-5.jpg',
  'entrega-chatgpt-6.jpg',
]

const trackingCodeStorageKey = 'prestamos-variety:tracking-code:v1'

function readRememberedTrackingCode(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const code = window.localStorage.getItem(trackingCodeStorageKey)?.toUpperCase() ?? ''
    return /^[A-HJ-NP-Z2-9]{3}(?:-[A-HJ-NP-Z2-9]{3}){2}$/.test(code) ? code : null
  } catch {
    return null
  }
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)

function Field({
  label,
  required = true,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="required"> *</span>}
      </span>
      {children}
    </label>
  )
}

function GeoField({ label, inputId, children }: { label: string; inputId: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={inputId}>{label}<span className="required"> *</span></label>
      {children}
    </div>
  )
}

function Upload({
  label,
  fileKey,
  accept = 'image/jpeg,image/png,image/webp,application/pdf',
  multiple = false,
  required = true,
  onFilesChange,
  resetKey,
}: {
  label: string
  fileKey: string
  accept?: string
  multiple?: boolean
  required?: boolean
  onFilesChange: (key: string, files: File[]) => void
  resetKey: number
}) {
  const [error, setError] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSelectedFiles([])
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }, [resetKey])

  useEffect(() => {
    const urls = selectedFiles.map((file) => file.type.startsWith('image/') ? URL.createObjectURL(file) : '')
    setPreviewUrls(urls)
    return () => urls.forEach((url) => { if (url) URL.revokeObjectURL(url) })
  }, [selectedFiles])

  const maxFileSize = 5 * 1024 * 1024

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    setError('')
    const allowedTypes = accept.split(',').map((item) => item.trim())
    const invalid = selected.find((file) => {
      const typeAllowed = allowedTypes.some((type) =>
        type.endsWith('/*') ? file.type.startsWith(type.slice(0, -1)) : file.type === type,
      )
      return !typeAllowed || file.size > maxFileSize || file.size === 0
    })

    if (invalid) {
      setError(
        invalid.size > maxFileSize
          ? `“${invalid.name}” supera el límite de 5 MB. Elegí otro archivo o comprimilo.`
          : `“${invalid.name}” no se pudo aceptar. Revisá el formato y que el archivo no esté vacío.`,
      )
      event.target.value = ''
      return
    }

    setSelectedFiles(selected)
    onFilesChange(fileKey, selected)
  }

  const clearFiles = () => {
    setSelectedFiles([])
    setError('')
    if (inputRef.current) inputRef.current.value = ''
    onFilesChange(fileKey, [])
  }

  return (
    <div className="upload-field">
      <label className="upload">
        <span className="upload-icon" aria-hidden="true">{selectedFiles.length ? '✓' : '＋'}</span>
        <span className="upload-copy">
          <strong>{label}{required ? ' *' : ''}</strong>
          <small>{selectedFiles.length ? 'Tocá para cambiar el archivo' : multiple ? 'Podés seleccionar varios archivos' : 'Elegí un archivo de tu dispositivo'}</small>
          <small>Máximo 5 MB por archivo.</small>
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          required={required && selectedFiles.length === 0}
          onChange={handleChange}
        />
      </label>
      {selectedFiles.length > 0 && (
        <div className="upload-selected-list" aria-live="polite">
          {selectedFiles.map((file, index) => (
            <div className="upload-selected-file" key={`${file.name}-${file.lastModified}-${index}`}>
              {previewUrls[index] ? <img className="upload-thumbnail" src={previewUrls[index]} alt={`Vista previa de ${file.name}`} /> : <span className="upload-file-icon" aria-hidden="true">{file.type === 'application/pdf' ? 'PDF' : file.type.startsWith('video/') ? '▶' : 'FILE'}</span>}
              <span className="upload-file-info"><strong>{file.name}</strong><small>{(file.size / (1024 * 1024)).toFixed(2)} MB</small></span>
            </div>
          ))}
          <button className="upload-clear" type="button" onClick={clearFiles}>Quitar {selectedFiles.length > 1 ? 'archivos' : 'archivo'}</button>
        </div>
      )}
      {error && <small role="alert" className="upload-error">{error}</small>}
    </div>
  )
}

function Section({
  number,
  title,
  description,
  children,
}: {
  number: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="form-section">
      <div className="section-heading">
        <span className="section-number">{number}</span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </div>
      <div className="section-content">{children}</div>
    </section>
  )
}

function App() {
  const deliveryGalleryRef = useRef<HTMLDivElement>(null)
  const deliveryModalCloseRef = useRef<HTMLButtonElement>(null)
  const galleryInteractionPauseUntilRef = useRef(0)
  const [selectedDeliveryPhoto, setSelectedDeliveryPhoto] = useState<string | null>(null)
  const [rememberedTrackingCode, setRememberedTrackingCode] = useState<string | null>(() => readRememberedTrackingCode())
  const [localityQuery, setLocalityQuery] = useState('')
  const [selectedLocality, setSelectedLocality] = useState<PickedLocality | null>(null)
  const [localitySuggestions, setLocalitySuggestions] = useState<GeoSuggestion[]>([])
  const [localityLoading, setLocalityLoading] = useState(false)
  const [localityLookupError, setLocalityLookupError] = useState('')
  const [streetQuery, setStreetQuery] = useState('')
  const [selectedStreet, setSelectedStreet] = useState<PickedStreet | null>(null)
  const [streetNumber, setStreetNumber] = useState('')
  const [streetSuggestions, setStreetSuggestions] = useState<GeoSuggestion[]>([])
  const [streetLoading, setStreetLoading] = useState(false)
  const [streetLookupError, setStreetLookupError] = useState('')
  const [housing, setHousing] = useState('')
  const [referrerStatus, setReferrerStatus] = useState('')
  const [electroVarietyClientStatus, setElectroVarietyClientStatus] = useState('')
  const [serviceOwner, setServiceOwner] = useState('')
  const [serviceTypes, setServiceTypes] = useState<string[]>([])
  const [hasDebts, setHasDebts] = useState('')
  const [incomeTypes, setIncomeTypes] = useState<IncomeType[]>([])
  const [loanAmount, setLoanAmount] = useState(500000)
  const [loanFrequency, setLoanFrequency] =
    useState<LoanFrequency>('weekly')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [rememberTrackingCode, setRememberTrackingCode] = useState(() => Boolean(rememberedTrackingCode))
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File[]>>({})
  const [uploadResetKey, setUploadResetKey] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showRequiredErrors, setShowRequiredErrors] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [trackingCode, setTrackingCode] = useState<string | null>(rememberedTrackingCode)
  const [trackingCodeCopied, setTrackingCodeCopied] = useState(false)

  const selectedPlan = loanPlans[loanAmount][loanFrequency]

  useEffect(() => {
    const query = localityQuery.trim()
    if (query.length < 3 || selectedLocality?.name === query) {
      setLocalitySuggestions([])
      setLocalityLoading(false)
      setLocalityLookupError('')
      return
    }
    const controller = new AbortController()
    setLocalityLoading(true)
    setLocalityLookupError('')
    const timer = window.setTimeout(() => {
      void fetchGeorefSuggestions('localidades', query, null, controller.signal)
        .then(setLocalitySuggestions)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setLocalitySuggestions([])
          setLocalityLookupError(error instanceof Error ? error.message : 'No se pudieron cargar las sugerencias de localidad.')
        })
        .finally(() => { if (!controller.signal.aborted) setLocalityLoading(false) })
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [localityQuery, selectedLocality])

  useEffect(() => {
    const query = streetQuery.trim()
    if (!selectedLocality || query.length < 3 || selectedStreet?.name === query) {
      setStreetSuggestions([])
      setStreetLoading(false)
      setStreetLookupError('')
      return
    }
    const controller = new AbortController()
    setStreetLoading(true)
    setStreetLookupError('')
    const localityId = selectedLocality.id === 'manual' ? selectedLocality.name : selectedLocality.id
    const timer = window.setTimeout(() => {
      void fetchGeorefSuggestions('calles', query, localityId, controller.signal)
        .then(setStreetSuggestions)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setStreetSuggestions([])
          setStreetLookupError(error instanceof Error ? error.message : 'No se pudieron cargar las sugerencias de calles.')
        })
        .finally(() => { if (!controller.signal.aborted) setStreetLoading(false) })
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [streetQuery, selectedLocality, selectedStreet])

  useEffect(() => {
    const gallery = deliveryGalleryRef.current
    if (!gallery || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const gallerySection = gallery.parentElement

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible'
        || gallerySection?.matches(':hover')
        || gallerySection?.contains(document.activeElement)
        || Date.now() < galleryInteractionPauseUntilRef.current) return

      const maxScroll = gallery.scrollWidth - gallery.clientWidth
      if (maxScroll <= 4) return

      if (gallery.scrollLeft >= maxScroll - 8) {
        gallery.scrollTo({ left: 0, behavior: 'smooth' })
      } else {
        const firstCard = gallery.querySelector<HTMLElement>('.delivery-gallery-card')
        const step = (firstCard?.getBoundingClientRect().width ?? gallery.clientWidth * 0.8) + 10
        gallery.scrollBy({ left: step, behavior: 'smooth' })
      }
    }, 4800)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selectedDeliveryPhoto) return

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    deliveryModalCloseRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedDeliveryPhoto(null)
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousActiveElement?.focus()
    }
  }, [selectedDeliveryPhoto])

  const scrollDeliveryGallery = (direction: -1 | 1) => {
    const gallery = deliveryGalleryRef.current
    if (!gallery) return
    gallery.scrollBy({ left: direction * gallery.clientWidth * 0.8, behavior: 'smooth' })
  }

  const handleFilesChange = (key: string, files: File[]) => {
    setSelectedFiles((current) => ({ ...current, [key]: files }))
  }

  const toggleService = (service: string) => {
    setServiceTypes((current) =>
      service === 'none'
        ? current.includes('none')
          ? []
          : ['none']
        : current.includes(service)
          ? current.filter((item) => item !== service && item !== 'none')
          : [...current.filter((item) => item !== 'none'), service],
    )
  }

  const toggleIncome = (type: IncomeType) => {
    setIncomeTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setShowRequiredErrors(true)
    setSubmitMessage('')
    setSubmitError('')

    const form = event.currentTarget
    if (!form.reportValidity()) return
    if (!selectedLocality) {
      setSubmitError('Elegí una localidad de las sugerencias o confirmá el texto escrito manualmente.')
      document.getElementById('application-locality')?.focus()
      return
    }
    if (!selectedStreet) {
      setSubmitError('Elegí una calle de las sugerencias o confirmá el texto escrito manualmente.')
      document.getElementById('application-street')?.focus()
      return
    }
    if (!streetNumber || Number(streetNumber) < 1) {
      setSubmitError('Ingresá la altura del domicilio.')
      document.getElementById('application-street-number')?.focus()
      return
    }
    if (!privacyAccepted) {
      setSubmitError('Debés aceptar la declaración de privacidad para continuar.')
      return
    }
    if (incomeTypes.length === 0) {
      setSubmitError('Seleccioná al menos una fuente de ingresos.')
      return
    }
    if (serviceTypes.length === 0) {
      setSubmitError('Indicá qué comprobante de domicilio tenés, o seleccioná “Ninguno a mi nombre”.')
      return
    }

    const requiredFileKeys = ['dni_front', 'dni_back']
    if (housing === 'rent_contract') requiredFileKeys.push('rental_contract')
    if (serviceTypes.some((service) => service !== 'none')) requiredFileKeys.push('utility_bill')
    if (serviceOwner === 'no') requiredFileKeys.push('service_holder_dni_front', 'service_holder_dni_back')
    if (incomeTypes.includes('formal')) requiredFileKeys.push('salary_receipt')
    if (incomeTypes.includes('informal')) requiredFileKeys.push('wallet_statement')
    incomeTypes
      .filter((type) => ['allowance', 'retirement', 'pension', 'cooperative'].includes(type))
      .forEach((type) => requiredFileKeys.push(`income_proof_${type}`))
    if (requiredFileKeys.some((key) => !(selectedFiles[key]?.length))) {
      setSubmitError('Falta adjuntar uno o más documentos obligatorios. Revisá los archivos marcados con *.')
      return
    }

    const formData = new FormData(form)
    const value = (name: string) => String(formData.get(name) ?? '').trim()
    const parseAmount = (raw: string) => {
      if (!/^\d+$/.test(raw) && !/^\d{1,3}(?:\.\d{3})+$/.test(raw) && !/^\d{1,3}(?:,\d{3})+$/.test(raw)) return null
      const normalized = raw.replace(/[.,]/g, '')
      const amount = Number(normalized)
      return Number.isSafeInteger(amount) ? amount : null
    }
    const numeric = (name: string) => {
      const raw = value(name)
      return raw === '' ? null : parseAmount(raw)
    }
    const sourceTypeMap: Record<IncomeType, string> = {
      formal: 'formal_employment',
      informal: 'informal_employment',
      selfEmployed: 'self_employed',
      business: 'business',
      allowance: 'allowance',
      retirement: 'retirement',
      pension: 'pension',
      cooperative: 'cooperative',
      other: 'other',
    }

    const income_sources = incomeTypes.map((type) => ({
      source_type: sourceTypeMap[type],
      monthly_income: numeric(`income_${type}`),
      activity_description:
        ['formal', 'informal'].includes(type) ? value(`occupation_${type}`) :
        type === 'selfEmployed' ? value('self_employed_activity') :
        type === 'other' ? value('other_income_description') :
        type === 'business' ? value('business_activity') : null,
      wallet_provider: type === 'informal' ? value('wallet_provider') : null,
      benefit_name: ['allowance', 'retirement', 'pension', 'cooperative'].includes(type)
        ? value(`benefit_${type}`) : null,
      business_name: type === 'business' ? value('business_name') : null,
      business_address: type === 'business' ? value('business_address') : null,
      business_duration: type === 'business' ? value('business_duration') : null,
      business_revenue: type === 'business' ? numeric('business_revenue') : null,
      business_profit: type === 'business' ? numeric('business_profit') : null,
    }))

    const payload = {
      full_name: value('full_name'),
      dni: value('dni'),
      dni_updated: value('dni_updated') === 'yes',
      phone: value('phone'),
      has_referrer: referrerStatus === 'yes',
      is_electro_variety_client: electroVarietyClientStatus === 'yes',
      referrer_full_name: referrerStatus === 'yes' ? value('referrer_full_name') : '',
      referrer_phone: referrerStatus === 'yes' ? value('referrer_phone') : '',
      referrer_relationship: referrerStatus === 'yes' ? value('referrer_relationship') : '',
      alternate_phone: value('alternate_phone'),
      alternate_phone_relationship: value('alternate_phone_relationship'),
      address: value('address'),
      between_streets: value('between_streets'),
      locality: value('locality'),
      housing_type: housing,
      service_types: serviceTypes,
      service_owner: serviceTypes.some((service) => service !== 'none') ? serviceOwner === 'yes' : null,
      service_holder_name: serviceOwner === 'no' ? value('service_holder_name') : null,
      service_holder_dni: serviceOwner === 'no' ? value('service_holder_dni') : null,
      service_holder_relationship: serviceOwner === 'no' ? value('service_holder_relationship') : null,
      has_debts: hasDebts === 'yes',
      debt_reason: hasDebts === 'yes' ? value('debt_reason') : null,
      debt_amount: hasDebts === 'yes' ? numeric('debt_amount') : null,
      income_sources,
      loan_amount: loanAmount,
      loan_frequency: loanFrequency,
      installment_count: selectedPlan.installments,
      installment_amount: selectedPlan.amount,
      total_to_pay: selectedPlan.installments * selectedPlan.amount,
      loan_purpose: value('loan_purpose'),
      privacy_accepted: privacyAccepted,
      tracking_code_requested: true,
    }

    const body = new FormData()
    body.append('payload', JSON.stringify(payload))
    Object.entries(selectedFiles).forEach(([key, files]) => {
      files.forEach((file, index) => body.append(`file:${key}:${index}`, file, file.name))
    })

    setIsSubmitting(true)
    try {
      const { data, error } = await supabase.functions.invoke('submit-loan-application', { body })
      if (error) {
        let message = error.message || 'No se pudo enviar la solicitud.'
        try {
          const response = (error as { context?: unknown }).context
          if (response instanceof Response) {
            const responseBody = await response.clone().json()
            if (typeof responseBody?.error === 'string') message = responseBody.error
          }
        } catch {
          // Keep the original function error if the response has no JSON body.
        }
        throw new Error(message)
      }
      if (!data || data.success !== true) {
        throw new Error(data?.error || 'El servidor no confirmó el registro de la solicitud.')
      }
      if (typeof data.tracking_code !== 'string') {
        throw new Error('La solicitud se guardó, pero no se recibió su código. Contactanos para obtener ayuda.')
      }
      let codeWasRemembered = false
      try {
        if (rememberTrackingCode) {
          window.localStorage.setItem(trackingCodeStorageKey, data.tracking_code)
          setRememberedTrackingCode(data.tracking_code)
          codeWasRemembered = true
        } else {
          window.localStorage.removeItem(trackingCodeStorageKey)
          setRememberedTrackingCode(null)
        }
      } catch {
        setRememberedTrackingCode(null)
      }
      setTrackingCode(data.tracking_code)
      setTrackingCodeCopied(false)
      setSubmitMessage(codeWasRemembered
        ? 'La solicitud se envió correctamente. El código quedó guardado en este dispositivo.'
        : rememberTrackingCode
          ? 'La solicitud se envió correctamente. No se pudo guardar el código en este navegador; copialo y guardalo.'
          : 'La solicitud se envió correctamente. Guardá este código para consultar su estado.')
      setShowRequiredErrors(false)
      form.reset()
      setSelectedFiles({})
      setUploadResetKey((current) => current + 1)
      setHousing('')
      setLocalityQuery('')
      setSelectedLocality(null)
      setLocalitySuggestions([])
      setStreetQuery('')
      setSelectedStreet(null)
      setStreetNumber('')
      setStreetSuggestions([])
      setReferrerStatus('')
      setElectroVarietyClientStatus('')
      setServiceOwner('')
      setServiceTypes([])
      setHasDebts('')
      setIncomeTypes([])
      setLoanAmount(500000)
      setLoanFrequency('weekly')
      setPrivacyAccepted(false)
    } catch (error) {
      console.error('Error al enviar solicitud:', error)
      setSubmitError(
        error instanceof Error
          ? `${error.message}`
          : 'Ocurrió un error inesperado al enviar la solicitud.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="brand-header">
        <span className="logo-frame brand-logo-frame">
          <img src={`${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`} alt="Préstamos Variety" />
        </span>
        <div className="brand-name">
          <strong>PRÉSTAMOS VARIETY</strong>
          <span>PRÉSTAMOS PERSONALES</span>
        </div>
        <span className="secure-label">Solicitud online</span>
        <a className="status-nav-link" href="#consultar-estado">Consultar estado</a>
      </header>

      {rememberedTrackingCode && !submitMessage && (
        <div className="remembered-code-banner" role="status">
          <span>Hay un código de seguimiento guardado en este dispositivo.</span>
          <a href="#consultar-estado">Consultar estado ↓</a>
        </div>
      )}

      <div className="hero">
        <span className="eyebrow">SOLICITUD PERSONAL</span>
        <h1>Solicitá tu préstamo</h1>
        <p>
          Completá tus datos y adjuntá la documentación correspondiente
          para que podamos evaluar tu solicitud.
        </p>
        <div className="notice">
          <span aria-hidden="true">ⓘ</span>
          Los campos marcados con <b>*</b> son obligatorios.
        </div>
      </div>

      <section className="delivery-gallery" aria-labelledby="delivery-gallery-title">
        <div className="delivery-gallery-heading">
          <div>
            <h2 id="delivery-gallery-title">Un impulso para tus proyectos</h2>
            <p>Conocé algunas entregas de Préstamos Variety</p>
          </div>
          <div className="delivery-gallery-controls">
            <button type="button" onClick={() => scrollDeliveryGallery(-1)} aria-label="Ver entregas anteriores">‹</button>
            <button type="button" onClick={() => scrollDeliveryGallery(1)} aria-label="Ver más entregas">›</button>
          </div>
        </div>
        <div
          className="delivery-gallery-track"
          ref={deliveryGalleryRef}
          role="list"
          aria-label="Galería de entregas de préstamos"
          onTouchStart={() => { galleryInteractionPauseUntilRef.current = Date.now() + 6500 }}
          onWheel={() => { galleryInteractionPauseUntilRef.current = Date.now() + 6500 }}
        >
          {deliveryPhotos.map((photo, index) => (
            <figure className="delivery-gallery-card" role="listitem" key={photo}>
              <button type="button" className="delivery-gallery-image-button" onClick={() => setSelectedDeliveryPhoto(photo)} aria-label={`Ampliar imagen de entrega ${index + 1}`}>
                <img
                  src={`${import.meta.env.BASE_URL}entregas/${photo}`}
                  alt={`Entrega de Préstamos Variety ${index + 1}; rostro y datos del comprobante protegidos`}
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </figure>
          ))}
        </div>
      </section>

      {selectedDeliveryPhoto && (
        <div className="delivery-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDeliveryPhoto(null) }}>
          <section className="delivery-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Imagen ampliada de entrega">
            <button ref={deliveryModalCloseRef} type="button" className="delivery-lightbox-close" onClick={() => setSelectedDeliveryPhoto(null)} aria-label="Cerrar imagen ampliada">×</button>
            <img src={`${import.meta.env.BASE_URL}entregas/${selectedDeliveryPhoto}`} alt="Entrega de Préstamos Variety; rostro y datos del comprobante protegidos" />
          </section>
        </div>
      )}

      <form
        className={`loan-form${showRequiredErrors ? ' show-required-errors' : ''}`}
        onSubmit={handleSubmit}
        onInvalidCapture={() => setShowRequiredErrors(true)}
      >
        <Section number="01" title="Datos personales">
          <div className="form-grid">
            <Field label="Nombre y apellido">
              <input name="full_name" autoComplete="name" required />
            </Field>

            <Field label="DNI">
              <input
                name="dni"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={16}
                pattern="[A-Za-z]?[0-9. -]{7,15}"
                title="Ingresá 7 u 8 números, con puntos opcionales; si tu DNI empieza con una letra, también podés incluirla."
                required
              />
            </Field>

            <Field label="¿Tenés el DNI actualizado?">
              <select name="dni_updated" required defaultValue="">
                <option value="" disabled>Seleccioná una opción</option>
                <option value="yes">Sí</option>
                <option value="no">No</option>
              </select>
            </Field>

            <Field label="Teléfono personal">
              <input name="phone" type="tel" autoComplete="tel" required />
            </Field>

            <Field label="Teléfono alternativo">
              <input name="alternate_phone" type="tel" required />
            </Field>

            <Field label="Vínculo con el contacto alternativo">
              <input name="alternate_phone_relationship" required />
            </Field>
          </div>

          <Field label="¿Venís recomendado por alguien?">
            <div className="choice-list horizontal">
              <label className="choice">
                <input
                  type="radio"
                  name="has_referrer"
                  value="yes"
                  checked={referrerStatus === 'yes'}
                  onChange={() => setReferrerStatus('yes')}
                  required
                />
                <span>Sí</span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="has_referrer"
                  value="no"
                  checked={referrerStatus === 'no'}
                  onChange={() => setReferrerStatus('no')}
                  required
                />
                <span>No</span>
              </label>
            </div>
          </Field>

          <Field label="¿Sos cliente de Electro Variety?">
            <div className="choice-list horizontal">
              <label className="choice">
                <input
                  type="radio"
                  name="is_electro_variety_client"
                  value="yes"
                  checked={electroVarietyClientStatus === 'yes'}
                  onChange={() => setElectroVarietyClientStatus('yes')}
                  required
                />
                <span>Sí</span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="is_electro_variety_client"
                  value="no"
                  checked={electroVarietyClientStatus === 'no'}
                  onChange={() => setElectroVarietyClientStatus('no')}
                  required
                />
                <span>No</span>
              </label>
            </div>
          </Field>

          {referrerStatus === 'yes' && (
            <div className="conditional-panel form-grid">
              <Field label="Nombre y apellido de quien te recomendó">
                <input name="referrer_full_name" autoComplete="name" required />
              </Field>
              <Field label="Teléfono de quien te recomendó">
                <input name="referrer_phone" type="tel" autoComplete="tel" required />
              </Field>
              <Field label="¿Cuál es tu vínculo con esta persona?">
                <input
                  name="referrer_relationship"
                  placeholder="Ej.: familiar, amistad, compañero de trabajo"
                  maxLength={100}
                  required
                />
              </Field>
            </div>
          )}

          <div className="upload-grid">
              <Upload label="Frente de tu DNI" fileKey="dni_front" onFilesChange={handleFilesChange} resetKey={uploadResetKey} />
              <Upload label="Dorso de tu DNI" fileKey="dni_back" onFilesChange={handleFilesChange} resetKey={uploadResetKey} />
          </div>
        </Section>

        <Section number="02" title="Domicilio">
          <div className="form-grid">
            <GeoField label="Localidad" inputId="application-locality">
              <GeoPredictiveInput
                id="application-locality"
                value={localityQuery}
                options={localitySuggestions}
                loading={localityLoading}
                error={localityLookupError}
                placeholder="Empezá a escribir tu localidad"
                onChange={(value) => {
                  setLocalityQuery(value)
                  setSelectedLocality(null)
                  setStreetQuery('')
                  setSelectedStreet(null)
                  setStreetNumber('')
                }}
                onSelect={(option) => {
                  setLocalityQuery(option.label)
                  setSelectedLocality({ id: option.id, name: option.label })
                  setStreetQuery('')
                  setSelectedStreet(null)
                  setStreetNumber('')
                }}
                onUseTyped={() => setSelectedLocality({ id: 'manual', name: localityQuery.trim() })}
              />
            </GeoField>
            <GeoField label="Calle" inputId="application-street">
              <GeoPredictiveInput
                id="application-street"
                value={streetQuery}
                options={streetSuggestions}
                loading={streetLoading}
                error={streetLookupError}
                disabled={!selectedLocality}
                placeholder={selectedLocality ? 'Empezá a escribir la calle' : 'Primero elegí la localidad'}
                onChange={(value) => { setStreetQuery(value); setSelectedStreet(null); setStreetNumber('') }}
                onSelect={(option) => {
                  setStreetQuery(option.label)
                  setSelectedStreet({ id: option.id, name: option.label })
                  setStreetNumber('')
                }}
                onUseTyped={() => setSelectedStreet({ id: 'manual', name: streetQuery.trim() })}
              />
            </GeoField>
            <Field label="Altura del domicilio">
              <input
                id="application-street-number"
                type="number"
                min="1"
                max="999999"
                step="1"
                inputMode="numeric"
                placeholder="Ej.: 1234"
                value={streetNumber}
                onChange={(event) => setStreetNumber(event.target.value)}
                required
              />
            </Field>
            <Field label="Entre calles">
              <input name="between_streets" required />
            </Field>
          </div>
          <input type="hidden" name="locality" value={selectedLocality?.name ?? ''} />
          <input type="hidden" name="address" value={selectedStreet && streetNumber ? `${selectedStreet.name} ${streetNumber}` : ''} />
          <small className="georef-attribution">Sugerencias de ubicación por <a href="https://www.argentina.gob.ar/georef" target="_blank" rel="noreferrer">Servicio Georef</a>. Podés ingresar los datos manualmente si no aparece una sugerencia.</small>

          <Field label="¿Cuál es tu situación de vivienda?">
            <div className="choice-list">
              {[
                { value: 'own', label: 'Vivienda propia' },
                { value: 'rent_contract', label: 'Alquilo por contrato' },
                { value: 'rent_verbal', label: 'Alquilo de palabra' },
              ].map((option) => (
                <label className="choice" key={option.value}>
                  <input
                    type="radio"
                    name="housing_type"
                    value={option.value}
                    checked={housing === option.value}
                    onChange={() => setHousing(option.value)}
                    required
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </Field>

          {housing === 'rent_contract' && (
            <div className="conditional-panel">
              <Upload label="Foto del contrato de alquiler" fileKey="rental_contract" onFilesChange={handleFilesChange} resetKey={uploadResetKey} />
            </div>
          )}
        </Section>

        <Section
          number="03"
          title="Comprobante de domicilio"
          description="Seleccioná los servicios que tengas disponibles."
        >
          <Field label="¿Qué servicio o comprobante tenés?">
            <div className="choice-grid required-choice-group">
              {[
                { value: 'edesur', label: 'Edesur' },
                { value: 'metrogas', label: 'Metrogas' },
                { value: 'water', label: 'Agua' },
                { value: 'other', label: 'Otro' },
                { value: 'none', label: 'Ninguno a mi nombre' },
              ].map((option) => (
                <label className="choice" key={option.value}>
                  <input
                    type="checkbox"
                    checked={serviceTypes.includes(option.value)}
                    onChange={() => toggleService(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </Field>

          {serviceTypes.some((service) => service !== 'none') && (
            <>
              <div className="conditional-panel">
                <Upload label="Comprobante del servicio" fileKey="utility_bill" onFilesChange={handleFilesChange} resetKey={uploadResetKey} />

                <Field label="¿El servicio está a tu nombre?">
                  <div className="choice-list horizontal">
                    <label className="choice">
                      <input
                        type="radio"
                        name="service_owner"
                        value="yes"
                        checked={serviceOwner === 'yes'}
                        onChange={() => setServiceOwner('yes')}
                        required
                      />
                      <span>Sí</span>
                    </label>

                    <label className="choice">
                      <input
                        type="radio"
                        name="service_owner"
                        value="no"
                        checked={serviceOwner === 'no'}
                        onChange={() => setServiceOwner('no')}
                        required
                      />
                      <span>No</span>
                    </label>
                  </div>
                </Field>
              </div>

              {serviceOwner === 'no' && (
                <div className="conditional-panel">
                  <h3>Datos del titular del servicio</h3>

                  <div className="form-grid">
                    <Field label="Nombre y apellido del titular">
                      <input name="service_holder_name" required />
                    </Field>

                    <Field label="DNI del titular">
                      <input
                        name="service_holder_dni"
                        inputMode="text"
                        autoCapitalize="characters"
                        maxLength={16}
                        pattern="[A-Za-z]?[0-9. -]{7,15}"
                        title="Ingresá 7 u 8 números, con puntos opcionales; si el DNI empieza con una letra, también podés incluirla."
                        required
                      />
                    </Field>

                    <Field label="Vínculo con el titular">
                      <input name="service_holder_relationship" required />
                    </Field>
                  </div>

                  <div className="upload-grid">
                    <Upload label="Frente del DNI del titular" fileKey="service_holder_dni_front" onFilesChange={handleFilesChange} resetKey={uploadResetKey} />
                    <Upload label="Dorso del DNI del titular" fileKey="service_holder_dni_back" onFilesChange={handleFilesChange} resetKey={uploadResetKey} />
                  </div>
                </div>
              )}
            </>
          )}
        </Section>

        <Section number="04" title="Situación financiera">
          <Field label="¿Tenés deudas actualmente?">
            <div className="choice-list horizontal">
              <label className="choice">
                <input
                  type="radio"
                  name="has_debts"
                  value="no"
                  checked={hasDebts === 'no'}
                  onChange={() => setHasDebts('no')}
                  required
                />
                <span>No</span>
              </label>

              <label className="choice">
                <input
                  type="radio"
                  name="has_debts"
                  value="yes"
                  checked={hasDebts === 'yes'}
                  onChange={() => setHasDebts('yes')}
                  required
                />
                <span>Sí</span>
              </label>
            </div>
          </Field>

          {hasDebts === 'yes' && (
            <div className="conditional-panel">
              <div className="form-grid">
                <Field label="Motivo de la deuda">
                  <textarea name="debt_reason" rows={3} required />
                </Field>

                <Field label="Monto aproximado de la deuda">
                  <input
                    name="debt_amount"
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9.,]+"
                    title="Ingresá el monto entero en pesos; podés usar puntos como separadores de miles."
                    required
                  />
                </Field>
              </div>
            </div>
          )}
        </Section>

        <Section
          number="05"
          title="Trabajo e ingresos"
          description="Podés seleccionar varias fuentes de ingresos."
        >
          <div className="choice-grid required-choice-group">
            {incomeOptions.map((option) => (
              <label className="choice" key={option.value}>
                <input
                  type="checkbox"
                  checked={incomeTypes.includes(option.value)}
                  onChange={() => toggleIncome(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>

          {incomeTypes.length > 0 && (
            <div className="income-panels">
              {incomeTypes.map((type) => (
                <div className="conditional-panel" key={type}>
                  <h3>{incomeLabels[type]}</h3>

                  <Field label="Ingreso mensual aproximado">
                    <input
                      name={`income_${type}`}
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9.,]+"
                      title="Ingresá el monto entero en pesos; podés usar puntos como separadores de miles."
                      required
                    />
                  </Field>

                  {type === 'formal' && (
                    <Field label="¿A qué te dedicás en tu trabajo?"><input name="occupation_formal" required /></Field>
                  )}

                  {type === 'informal' && (
                    <Field label="¿A qué te dedicás en tu trabajo?"><input name="occupation_informal" required /></Field>
                  )}

                  {type === 'formal' && (
                    <Upload label="Recibo de sueldo" fileKey="salary_receipt" onFilesChange={handleFilesChange} resetKey={uploadResetKey} />
                  )}

                  {type === 'informal' && (
                    <>
                      <Field label="Billetera virtual utilizada">
                        <input name="wallet_provider" required />
                      </Field>
                      <Upload label="Balance mensual de la billetera virtual" fileKey="wallet_statement" onFilesChange={handleFilesChange} resetKey={uploadResetKey} />
                    </>
                  )}

                  {type === 'selfEmployed' && (
                    <>
                      <Field label="¿A qué actividad te dedicás?">
                        <input name="self_employed_activity" required />
                      </Field>
                      <Upload
                        label="Comprobante de ingresos"
                        fileKey="income_proof_selfEmployed"
                        onFilesChange={handleFilesChange} resetKey={uploadResetKey}
                        required={false}
                      />
                    </>
                  )}

                  {type === 'business' && (
                    <>
                      <Field label="Nombre del comercio">
                        <input name="business_name" required />
                      </Field>

                      <Field label="Actividad comercial">
                        <input name="business_activity" required />
                      </Field>

                      <Field label="Dirección del comercio">
                        <input name="business_address" required />
                      </Field>

                      <Field label="Antigüedad del comercio">
                        <input name="business_duration" required />
                      </Field>

                      <Field label="Facturación mensual aproximada">
                        <input
                          name="business_revenue"
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9.,]+"
                          title="Ingresá el monto entero en pesos; podés usar puntos como separadores de miles."
                          required
                        />
                      </Field>

                      <Field label="Ganancia mensual aproximada">
                        <input
                          name="business_profit"
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9.,]+"
                          title="Ingresá el monto entero en pesos; podés usar puntos como separadores de miles."
                          required
                        />
                      </Field>

                      <Upload
                        label="Fotografías del comercio"
                        fileKey="business_photos"
                        onFilesChange={handleFilesChange} resetKey={uploadResetKey}
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        required={false}
                      />

                      <Upload
                        label="Video del comercio"
                        fileKey="business_video"
                        onFilesChange={handleFilesChange} resetKey={uploadResetKey}
                        accept="video/mp4,video/quicktime"
                        required={false}
                      />
                    </>
                  )}

                  {(
                    ['allowance', 'retirement', 'pension', 'cooperative'] as IncomeType[]
                  ).includes(type) && (
                    <>
                      <Field label="Nombre del beneficio o institución">
                        <input name={`benefit_${type}`} required />
                      </Field>
                      <Upload
                         label="Comprobante del ingreso"
                         fileKey={`income_proof_${type}`}
                         onFilesChange={handleFilesChange} resetKey={uploadResetKey}
                       />
                    </>
                  )}

                  {type === 'other' && (
                    <>
                      <Field label="Origen del ingreso">
                        <input name="other_income_description" required />
                      </Field>
                      <Upload
                        label="Comprobante de ingresos"
                        fileKey="income_proof_selfEmployed"
                        onFilesChange={handleFilesChange} resetKey={uploadResetKey}
                        required={false}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section number="06" title="Tu préstamo">
          <div className="amount-card">
            <span className="amount-label">
              ¿Cuánto dinero necesitás?
            </span>

            <output className="amount-value" aria-live="polite">
              {formatMoney(loanAmount)}
            </output>

            <input
              className="amount-slider"
              type="range"
              min="100000"
              max="1000000"
              step="100000"
              value={loanAmount}
              onChange={(event) =>
                setLoanAmount(Number(event.target.value))
              }
              aria-label="Monto del préstamo"
            />

            <div className="slider-labels">
              <span>$100.000</span>
              <span>$1.000.000</span>
            </div>

            <p>
              Deslizá para elegir el monto, en incrementos de $100.000.
            </p>
          </div>

          <div className="conditional-panel">
            <h3>¿Cómo querés pagar?</h3>

            <div className="choice-list">
              <label className="choice">
                <input
                  type="radio"
                  name="loan_frequency"
                  value="weekly"
                  checked={loanFrequency === 'weekly'}
                  onChange={() => setLoanFrequency('weekly')}
                />
                <span>20 cuotas semanales</span>
              </label>

              <label className="choice">
                <input
                  type="radio"
                  name="loan_frequency"
                  value="fortnightly"
                  checked={loanFrequency === 'fortnightly'}
                  onChange={() => setLoanFrequency('fortnightly')}
                />
                <span>10 cuotas quincenales</span>
              </label>

              <label className="choice">
                <input
                  type="radio"
                  name="loan_frequency"
                  value="monthly"
                  checked={loanFrequency === 'monthly'}
                  onChange={() => setLoanFrequency('monthly')}
                />
                <span>5 cuotas mensuales</span>
              </label>
            </div>
          </div>

          <div className="conditional-panel">
            <span className="amount-label">VALOR DE CADA CUOTA</span>

            <output className="amount-value" aria-live="polite">
              {formatMoney(selectedPlan.amount)}
            </output>
          </div>

          <Field label="¿Para qué necesitás el préstamo?">
            <textarea
              name="loan_purpose"
              rows={3}
              placeholder="Contanos brevemente el motivo."
              required
            />
          </Field>
        </Section>

        <section className="privacy-section">
          <label className="privacy-choice">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(event) =>
                setPrivacyAccepted(event.target.checked)
              }
              required
            />
            <span>
              Declaro que la información proporcionada es verdadera y acepto
              el tratamiento de mis datos para evaluar mi solicitud. *
            </span>
          </label>
          <label className="remember-code-choice">
            <input
              type="checkbox"
              checked={rememberTrackingCode}
              onChange={(event) => setRememberTrackingCode(event.target.checked)}
            />
            <span>
              <b>Recordar el código de seguimiento en este dispositivo</b>
              <small>Es opcional y solo se guarda en este navegador. Desactivá esta opción si compartís el dispositivo.</small>
            </span>
          </label>

        </section>

        {submitError && <p className="form-error" role="alert">{submitError}</p>}
        {submitMessage && <div className="form-success tracking-success" role="status">
          <p>{submitMessage}</p>
          {trackingCode && <div className="tracking-code-card">
            <span>Código de seguimiento</span>
            <strong>{trackingCode}</strong>
            <button type="button" onClick={() => {
              void navigator.clipboard.writeText(trackingCode).then(() => setTrackingCodeCopied(true)).catch(() => setTrackingCodeCopied(false))
            }}>{trackingCodeCopied ? 'Copiado' : 'Copiar código'}</button>
            <small>Guardalo en un lugar privado. Cualquier persona que tenga el código podrá consultar el estado.</small>
            <a href="#consultar-estado">Consultar estado ahora ↓</a>
          </div>}
        </div>}

        <button className="submit-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Enviando solicitud…' : 'Enviar solicitud'}
          {!isSubmitting && <span aria-hidden="true"> →</span>}
        </button>

        <p className="form-footer">
          La presentación de la solicitud no garantiza la aprobación del préstamo.
        </p>
      </form>

      <StatusLookup
        initialCode={trackingCode}
        rememberedCode={rememberedTrackingCode}
        onForgetRememberedCode={() => {
          try { window.localStorage.removeItem(trackingCodeStorageKey) } catch { /* El borrado local no afecta la consulta manual. */ }
          setRememberedTrackingCode(null)
          setRememberTrackingCode(false)
          if (!submitMessage) setTrackingCode(null)
        }}
      />

      <footer className="site-footer">
        <span className="logo-frame footer-logo-frame">
          <img src={`${import.meta.env.BASE_URL}prestamos-variety-logo.jpg`} alt="Préstamos Variety" />
        </span>
        <span>Préstamos Variety · Solicitudes de préstamos personales</span>
      </footer>
    </main>
  )
}

export default App
