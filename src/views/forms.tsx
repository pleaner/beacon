import type { Child, FC, PropsWithChildren } from 'hono/jsx'
import { COUNTRY_CODES } from '../lib/constants'
import { splitPhone } from '../lib/phone'
import { FlagZA, Icon, type IconName } from './icons'

// A text-like input with its icon inside. The label is visible unless `hideLabel` is set,
// in which case the icon carries the meaning and the label stays for screen readers.
export const IconInput: FC<{
  id: string; name: string; label: string; icon: IconName; type?: string; value?: string | number | null; placeholder?: string
  required?: boolean; hideLabel?: boolean; autocomplete?: string; inputmode?: 'numeric' | 'decimal' | 'tel' | 'email' | 'text'; min?: string; max?: string; pattern?: string
}> = ({ id, name, label, icon, type = 'text', value, placeholder, required, hideLabel, autocomplete, inputmode, min, max, pattern }) => (
  <div class="field">
    <label for={id} class={hideLabel ? 'sr' : undefined}>{label}</label>
    <div class="control has-icon">
      <Icon name={icon} />
      <input id={id} name={name} type={type} value={value ?? ''} placeholder={placeholder} required={required}
        autocomplete={autocomplete} inputmode={inputmode} min={min} max={max} pattern={pattern} />
    </div>
  </div>
)

export const IconTextarea: FC<{ id: string; name: string; label: string; icon: IconName; value?: string | null; placeholder?: string; hideLabel?: boolean }> = (
  { id, name, label, icon, value, placeholder, hideLabel },
) => (
  <div class="field">
    <label for={id} class={hideLabel ? 'sr' : undefined}>{label}</label>
    <div class="control has-icon">
      <Icon name={icon} />
      <textarea id={id} name={name} placeholder={placeholder}>{value ?? ''}</textarea>
    </div>
  </div>
)

export const SelectField: FC<{
  id: string; name: string; label: string; icon?: IconName; options: Array<{ value: string; label: string }>; value?: string | null
  placeholder?: string; hideLabel?: boolean; required?: boolean
}> = ({ id, name, label, icon, options, value, placeholder, hideLabel, required }) => (
  <div class="field">
    <label for={id} class={hideLabel ? 'sr' : undefined}>{label}</label>
    <div class={icon ? 'control has-icon' : 'control'}>
      {icon && <Icon name={icon} />}
      <select id={id} name={name} required={required}>
        {placeholder !== undefined && <option value="" selected={!value}>{placeholder}</option>}
        {options.map((o) => <option value={o.value} selected={value === o.value}>{o.label}</option>)}
      </select>
      <Icon name="down" size={20} class="chev" />
    </div>
  </div>
)

// Country code + national number. Posts `${name}_country` and `${name}`.
export const PhoneField: FC<{ id: string; name: string; label: string; value?: string | null; required?: boolean; hideLabel?: boolean }> = (
  { id, name, label, value, required, hideLabel },
) => {
  const { country, national } = splitPhone(value, COUNTRY_CODES)
  return (
    <div class="field">
      <label for={id} class={hideLabel ? 'sr' : undefined}>{label}</label>
      <PhoneInputs id={id} name={name} country={country} national={national} required={required} label={label} />
    </div>
  )
}

export const PhoneInputs: FC<{ id?: string; name: string; country?: string; national?: string; required?: boolean; label: string; placeholder?: string }> = (
  { id, name, country = '27', national = '', required, label, placeholder },
) => (
  <div class="phone">
    <div class="cc">
      {country === '27' && <FlagZA />}
      <select name={`${name}_country`} aria-label={`${label}: country code`} data-cc>
        {COUNTRY_CODES.map((c) => <option value={c.code} selected={c.code === country}>+{c.code}</option>)}
      </select>
      <Icon name="down" size={16} class="chev" />
    </div>
    <input id={id} name={name} type="tel" value={national} required={required} autocomplete="tel-national" inputmode="tel"
      placeholder={placeholder ?? '82 123 4567'} aria-label={id ? undefined : label} />
  </div>
)

// Header for multi-step flows: back, "2/6", optional slide-to-cancel, and the progress bar.
export const FlowHead: FC<{ total: number; backHref: string; cancelHref?: string }> = ({ total, backHref, cancelHref }) => (
  <header class="flow-head">
    <div class="bar">
      <a class="icon-btn" href={backHref} data-step-back aria-label="Back"><Icon name="back" size={24} /></a>
      <span class="count" data-step-count aria-live="polite">
        <span class="js-only">1/{total}</span>
      </span>
      {cancelHref ? (
        <div class="slide-cancel" data-slide-cancel={cancelHref}>
          <a href={cancelHref} aria-label="Cancel and go back home"></a>
          <input type="range" min="0" max="100" value="0" aria-label="Slide to cancel" class="js-only" />
          <span class="knob"><Icon name="x" size={18} stroke={2.4} /></span>
          <Icon name="chevs" size={18} />
        </div>
      ) : <span></span>}
    </div>
    <div class="progress js-only" data-step-progress>
      {Array.from({ length: total }, (_, i) => <span class={i === 0 ? 'on' : undefined}></span>)}
    </div>
  </header>
)

export const Step: FC<PropsWithChildren<{ title: string; lead?: Child; icon?: IconName; eyebrowLabel?: string; next?: string | false; skip?: boolean; submit?: Child }>> = (
  { title, lead, icon, eyebrowLabel, next = 'Next', skip, submit, children },
) => (
  <section class="step" data-step aria-label={title}>
    <div class="step-title">
      {icon && <span class="eyebrow" role="img" aria-label={eyebrowLabel ?? ''}><Icon name={icon} size={24} /></span>}
      <h1 class="display">{title}</h1>
      {lead && <p class="lead">{lead}</p>}
    </div>
    {children}
    <div class="spacer"></div>
    <div class="actions">
      {submit}
      {next !== false && !submit && (
        <button class="btn js-only" type="button" data-step-next aria-label={next === 'Next' ? next : undefined}>
          <Icon name="arrow" size={next === 'Next' ? 28 : 24} stroke={2.4} />
          {next !== 'Next' && next}
        </button>
      )}
      {skip && <button class="btn ghost js-only" type="button" data-step-next data-skip>Skip for now</button>}
    </div>
  </section>
)
