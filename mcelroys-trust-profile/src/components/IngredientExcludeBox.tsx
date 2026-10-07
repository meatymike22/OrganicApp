'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { colors, font } from '@/lib/design'
import { suggestIngredients } from '@/lib/ingredientSuggestions'

// "WITHOUT THIS INGREDIENT" — a typeahead over a comma-separated list.
//
// Michael: "even something more specific that i can input like red 40 or
// sucralose... and they should be able to tab complete, so if i start typing
// in asp it should give me suggestions like aspartame, etc".
//
// IT IS A PLAIN GET FORM, and that is the important part. The field is named
// `without` and holds the whole comma-separated list, the other search
// parameters ride along as hidden inputs, and submitting it navigates. So
// with JavaScript off this still works completely: type "red 40, sucralose",
// press Enter, get the filtered list. The suggestions are the only thing
// JavaScript adds, and they are a convenience rather than the mechanism.
//
// Suggestions come from a static list filtered in the browser, so there is no
// request per keystroke. The list is a shortlist of common additives; the
// FILTER accepts anything, matched as a substring against every ingredient
// name in the database. See ingredientSuggestions.ts for why it is static.
export function IngredientExcludeBox({
  terms,
  hidden,
}: {
  // The terms already applied, which prefill the field.
  terms: string[]
  // Every other search parameter, so submitting keeps the query and aisle.
  hidden: Record<string, string>
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(terms.join(', '))
  const [open, setOpen] = useState(false)

  // Only the fragment after the last comma is being typed; everything before
  // it is already-entered terms.
  const fragment = useMemo(() => {
    const parts = value.split(',')
    return (parts[parts.length - 1] ?? '').trim()
  }, [value])

  const suggestions = useMemo(() => (open ? suggestIngredients(fragment) : []), [open, fragment])

  function choose(name: string) {
    const parts = value.split(',')
    parts[parts.length - 1] = ` ${name}`
    // Trailing comma and space, so the next one can be typed straight away.
    const next = parts.join(',').replace(/^[,\s]+/, '') + ', '
    setValue(next)
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <form method="get" action="/search" style={{ marginTop: 10, position: 'relative' }}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <input
        ref={inputRef}
        type="text"
        name="without"
        value={value}
        autoComplete="off"
        placeholder="red 40, sucralose…"
        aria-label="Exclude products containing these ingredients"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        onChange={(e) => {
          setValue(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // A click on a suggestion would otherwise be lost to the blur that
        // precedes it, so closing is deferred past the click.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          // Tab completes to the best match, which is what "tab complete"
          // means and what was asked for. Enter still submits the form.
          if (e.key === 'Tab' && suggestions.length > 0) {
            e.preventDefault()
            choose(suggestions[0].name)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          padding: '8px 10px',
          fontFamily: 'inherit',
          fontSize: 13,
          color: colors.ink,
          background: colors.card,
          border: `1px solid ${colors.line}`,
          borderRadius: 6,
        }}
      />

      {suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          style={{
            listStyle: 'none',
            margin: '4px 0 0',
            padding: 4,
            position: 'absolute',
            zIndex: 5,
            left: 0,
            right: 0,
            background: colors.card,
            border: `1px solid ${colors.line}`,
            borderRadius: 6,
            boxShadow: '0 6px 18px rgba(22, 32, 27, 0.12)',
          }}
        >
          {suggestions.map((s, i) => (
            <li key={s.name}>
              <button
                type="button"
                role="option"
                aria-selected={i === 0}
                onClick={() => choose(s.name)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '6px 7px',
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  textAlign: 'left',
                  color: colors.ink,
                  background: i === 0 ? colors.panel : 'transparent',
                  border: 0,
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                <span>{s.name}</span>
                {/* The product count, because excluding an ingredient on
                    12,000 products and one on 20 are different decisions. */}
                <span style={{ fontFamily: font.mono, fontSize: 11, color: colors.ink4 }}>
                  {s.products.toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        style={{
          marginTop: 7,
          padding: '6px 12px',
          fontFamily: 'inherit',
          fontSize: 12.5,
          fontWeight: 600,
          color: colors.paper,
          background: colors.dark,
          border: 0,
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Apply
      </button>
    </form>
  )
}
