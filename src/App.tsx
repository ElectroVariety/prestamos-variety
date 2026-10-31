
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
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSelectedNames([])
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }, [resetKey])
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
      setSelectedNames([])
      setError(
        invalid.size > maxFileSize
          ? `El archivo supera el límite de ${Math.floor(maxFileSize / (1024 * 1024))} MB.`
          : 'Formato no permitido o archivo vacío. Usá un formato admitido.',
      )
      event.target.value = ''
      onFilesChange(fileKey, [])
      return
    }

    setSelectedNames(selected.map((file) => file.name))
    onFilesChange(fileKey, selected)
  }

  return (
    <label className="upload">
      <span className="upload-icon" aria-hidden="true">＋</span>
      <span className="upload-copy">
        <strong>{label}{required ? ' *' : ''}</strong>
        <small>{multiple ? 'Podés seleccionar varios archivos' : 'Elegí un archivo de tu dispositivo'}</small>
        <small>Máximo {Math.floor(maxFileSize / (1024 * 1024))} MB por archivo.</small>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        required={required}
        onChange={handleChange}
      />
      {selectedNames.map((name) => (
        <small className="upload-success" key={name}>Archivo seleccionado: {name}</small>
      ))}
      {error && <small role="alert" className="upload-error">{error}</small>}
    </label>
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
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File[]>>({})
  const [uploadResetKey, setUploadResetKey] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showRequiredErrors, setShowRequiredErrors] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [trackingCode, setTrackingCode] = useState<string | null>(null)
  const [trackingCodeCopied, setTrackingCodeCopied] = useState(false)

  const selectedPlan = loanPlans[loanAmount][loanFrequency]

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
    const numeric = (name: string) => {
      const raw = value(name)
      return raw === '' ? null : Number(raw)
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
      setTrackingCode(data.tracking_code)
      setTrackingCodeCopied(false)
      setSubmitMessage('La solicitud se envió correctamente. Guardá este código para consultar su estado.')
      setShowRequiredErrors(false)
      form.reset()
      setSelectedFiles({})
      setUploadResetKey((current) => current + 1)
      setHousing('')
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
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{7,8}"
                title="Ingresá un DNI de 7 u 8 números"
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
            <Field label="Calle y número">
              <input name="address" autoComplete="street-address" required />
            </Field>

            <Field label="Entre calles">
              <input name="between_streets" required />
            </Field>

            <Field label="Localidad">
              <input name="locality" required />
            </Field>
          </div>

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
                        inputMode="numeric"
                        pattern="[0-9]{7,8}"
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
                    type="number"
                    min="0"
                    step="1000"
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
                      type="number"
                      min="0"
                      step="1000"
                      required
                    />
                  </Field>

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
                          type="number"
                          min="0"
                          required
                        />
                      </Field>

                      <Field label="Ganancia mensual aproximada">
                        <input
                          name="business_profit"
                          type="number"
                          min="0"
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
              el tratamiento de mis datos para evaluar mi solicitud, según la
              política de privacidad. *
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

      <StatusLookup initialCode={trackingCode} />

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
