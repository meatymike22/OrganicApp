'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// Reveals its children once, the first time it scrolls into view.
//
// WHY THIS EXISTS AS A CLIENT COMPONENT
// The subscription rows were animated with a scroll-driven CSS animation
// (animation-timeline: view()), which needs no JavaScript at all. But that
// kind of animation is driven by SCROLL POSITION, not by time: it advances
// only while you are scrolling and it is pinned to where the element sits in
// the viewport. There is no way to give it a delay or a fixed duration.
//
// Michael asked for the rows to arrive about two seconds AFTER you reach the
// section, slowly, and not tied to the bottom edge of the screen. That is a
// timed animation with a viewport trigger, and the web has no CSS-only
// primitive for "element entered the viewport, now run a timed animation".
// So: an IntersectionObserver sets a flag, and the CSS does the rest.
//
// HOW IT AVOIDS THE TWO WAYS THIS NORMALLY GOES WRONG
//
// 1. No flash of visible content. The hidden starting state lives behind
//    `@media (scripting: enabled)` in that same block, so the rows are already hidden
//    on the very first paint rather than being shown and then yanked away by
//    JavaScript a moment later.
//
// 2. Never permanently invisible. If the observer never fires — a browser
//    quirk, an error, the element already past — a timer reveals the rows
//    anyway. Content that is hidden until JavaScript succeeds is content that
//    can disappear for good, and these rows are the page's sales pitch.

const FAILSAFE_MS = 6000

export function ScrollReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    // Anyone who has asked their system to reduce motion gets the rows
    // straight away, with no animation.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const el = ref.current
    if (!el) {
      setShown(true)
      return
    }

    // Fires once the section is properly on screen rather than just peeking
    // over the bottom edge — which is what "it doesn't need to roll in at the
    // bottom of the screen" asked for.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    io.observe(el)

    const failsafe = window.setTimeout(() => {
      setShown(true)
      io.disconnect()
    }, FAILSAFE_MS)

    return () => {
      io.disconnect()
      window.clearTimeout(failsafe)
    }
  }, [])

  // The data attributes are what the animation rules in src/app/page.tsx key
  // off (the ICON_CSS block at the top of that file). Using attributes rather
  // than class names keeps all the motion in one readable block of CSS next
  // to the other animations, instead of split across this file.
  return (
    <div ref={ref} data-reveal="" {...(shown ? { 'data-in': '' } : {})}>
      {children}
    </div>
  )
}
