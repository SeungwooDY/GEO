import { useState } from 'react'

const FIELDS = [
  { key: 'name', label: 'Business name', ev: 'name', wide: true },
  { key: 'phone', label: 'Phone', ev: 'phone' },
  { key: 'street', label: 'Street address', ev: 'address' },
  { key: 'city', label: 'City', ev: 'address' },
  { key: 'region', label: 'State / region', ev: 'address' },
  { key: 'postalCode', label: 'Postal code', ev: 'address' },
  { key: 'services', label: 'Services (one per line)', ev: 'services', wide: true, optional: true, multi: true },
  { key: 'areaServed', label: 'Areas served (one per line)', ev: 'areaServed', wide: true, optional: true, multi: true },
]

// One item per line, not comma separated: place names like "Riverside, CA" contain commas.
const list = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean)

/** Turns the server's partial profile into flat form values. */
function toForm(p = {}) {
  return {
    name: p.name ?? '', phone: p.phone ?? '',
    street: p.address?.street ?? '', city: p.address?.city ?? '', region: p.address?.region ?? '', postalCode: p.address?.postalCode ?? '',
    services: (p.services ?? []).join('\n'), areaServed: (p.areaServed ?? []).join('\n'),
  }
}

// Business facts the page didn't state. Pre-filled from what the site itself publishes; the user confirms or fills the
// rest. Nothing is guessed: an empty field stays empty, and the files that need it stay locked.
export default function BusinessForm({ prefill, evidence, missing, busy, defaultOpen, onApply }) {
  const [form, setForm] = useState(() => toForm(prefill))
  const [open, setOpen] = useState(defaultOpen)
  const found = FIELDS.filter((f) => !f.optional && form[f.key]).length
  const required = FIELDS.filter((f) => !f.optional).length

  const submit = (e) => {
    e.preventDefault()
    onApply({
      name: form.name.trim(), phone: form.phone.trim(),
      address: { street: form.street.trim(), city: form.city.trim(), region: form.region.trim(), postalCode: form.postalCode.trim() },
      services: list(form.services), areaServed: list(form.areaServed),
    })
  }

  return (
    <section className="bf">
      <button className="bf-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>
          <span className="bf-title">Your business details</span>
          <span className="bf-sub">
            {missing.length === 0
              ? 'All required details found. Edit them if anything is out of date.'
              : `${found} of ${required} required details found on your site. Add the rest to unlock the locked files.`}
          </span>
        </span>
        <span className="cc-chev" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <form className="bf-body" onSubmit={submit}>
          <div className="bf-grid">
            {FIELDS.map((f) => (
              <label className={`bf-field${f.wide ? ' wide' : ''}`} key={f.key}>
                <span>{f.label}{f.optional ? ' (optional)' : ''}</span>
                {f.multi
                  ? <textarea rows={3} value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
                  : <input value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} autoComplete="off" />}
                <em className={form[f.key] && evidence[f.ev] ? 'found' : ''}>
                  {form[f.key] && evidence[f.ev] ? `Found on your site (${evidence[f.ev]})` : f.optional ? 'Not found on your site' : 'Not found on your site: required'}
                </em>
              </label>
            ))}
          </div>
          <div className="bf-actions">
            <button className="sg-btn" type="submit" disabled={busy}>{busy ? 'Building…' : 'Update files'}</button>
            <span className="bf-note">Hours and ratings are only included if your page already publishes them.</span>
          </div>
        </form>
      )}
    </section>
  )
}
