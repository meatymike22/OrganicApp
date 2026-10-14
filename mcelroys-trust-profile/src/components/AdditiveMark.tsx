import { additive, font, type AdditiveKey } from '@/lib/design'

// THE FAMILY MARK: a two-letter code on the family colour.
//
// WHY A CODE AND NOT JUST A COLOUR. Michael, 2026-10-13: "colors are too
// close together and its hard to see the colors when the text is
// highlighted. we have to take colorblind people into consideration here."
//
// Measuring that complaint is what produced this component. The numbers and
// the reasoning are in the `additive` block of design.ts; the short version
// is that eight categorical hues cannot be made colour-blind-safe inside
// this project’s own no-red, no-green, no-amber rule, so colour cannot be
// the channel that says which family a row belongs to. Two letters can.
//
// It also answers the second half of his comment directly. Dragging a
// selection across a coloured word replaces its colour with the selection
// colour, so a tinted ingredient name stops saying anything at all while it
// is highlighted. A letter inside a block does not have that failure.
//
// ONE DEFINITION, USED BY BOTH THE LEGEND AND THE ROWS. That is deliberate
// and it is the rule item 20 earned the hard way: a copy whose correctness
// depends on someone remembering to update both is a bug with a delay on it.
// The legend teaches the codes and the rows use them, so if these were two
// components the legend could end up teaching a code no row prints.
//
// userSelect: none because this mark is furniture, not content — a reader
// copying an ingredient list should get the ingredient names and not "EmFl".
export function AdditiveMark({ family, size = 'row' }: { family: AdditiveKey; size?: 'row' | 'legend' }) {
  const a = additive[family]
  const legend = size === 'legend'
  return (
    <span
      // The full family name on the hover, so the code is recoverable
      // without scrolling back up to the legend.
      title={a.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: legend ? 21 : 20,
        height: legend ? 14 : 13,
        boxSizing: 'border-box',
        borderRadius: 3,
        background: a.fg,
        color: '#FFFFFF',
        fontFamily: font.sans,
        // 9.5px is the floor for a two-letter code to stay legible at this
        // weight. Every family colour in design.ts carries at least 5.2:1
        // against white, which is what makes white text safe on all of them.
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '0.02em',
        lineHeight: 1,
        // An inline-flex box sits on the text baseline by default, which
        // pushes the line box of a 13px ingredient row down by a pixel or
        // two. text-bottom lines the mark up with the bottom of the text
        // instead. Ignored in the legend, where the parent is a flex
        // container and this is a flex item.
        verticalAlign: 'text-bottom',
        userSelect: 'none',
      }}
    >
      {a.code}
    </span>
  )
}
