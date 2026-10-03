import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import { font } from '@/lib/design'

// THE LANDING PAGE, at /.
//
// Built from the "Home" screen in the Rootify design canvas, converted
// section by section with its styles kept as drawn. It is the only page with
// a marketing nav (no search field, no aisle bar).
//
// Differences from the mockup, on purpose:
//  - Verification copy. The mockup says "a person reads every line" and
//    "a person checks it". Rootify's verification is automated, so the copy
//    says what is true: every line is sourced and dated, and gets verified
//    against the original record. (The method is disclosed on the legal pages.)
//  - No "we archive the page" claim: archiving isn't built yet.
//  - The app and Rootify Plus don't exist yet, so those buttons show "Soon"
//    instead of linking anywhere; "Browse the database" goes to /search.
//  - No "Log in" (there are no accounts yet).
//  - Fixed section heights became minimum heights, so text never clips.
//
// The phone preview shows a real record: Kellanova's Frosted Cherry toaster
// pastries (6 ingredients with open research, 34 ingredients, no recalls,
// owned by Mars, read 2026-09-24). If that record changes, update the card.

export const metadata: Metadata = {
  title: { absolute: 'Rootify — before you buy' },
}

// The product the phone preview shows.
const EXAMPLE_PRODUCT = '/products/0825d8cc-4bb5-4898-afe4-6b701469d741'

const FONT_DISPLAY = font.display
const FONT_MONO = font.mono

// EVERY SECTION'S CONTENT SITS INSIDE THIS.
//
// Without it the sections are full-bleed: the text inside caps at ~640px, so
// on a wide monitor (the review was done at 2560px) everything hugs one edge
// with a third of the screen empty. The coloured bands — the green strip, the
// dark call-to-action, the footer — keep their background full width and get
// this on an inner wrapper instead, so the colour still reaches both edges.
const SHELL: CSSProperties = {
  maxWidth: "1320px",
  marginLeft: "auto",
  marginRight: "auto",
  width: "100%",
}

// The feature icons' animations, from the mockup. Turned off for anyone who
// has asked their system for reduced motion.
const ICON_CSS = `
/* ANIMATED FEATURE ICONS */
@keyframes rt-ring{0%,58%,100%{transform:rotate(0)}64%{transform:rotate(13deg)}71%{transform:rotate(-11deg)}78%{transform:rotate(7deg)}85%{transform:rotate(-4deg)}}
@keyframes rt-ping{0%,55%{transform:scale(.4);opacity:0}66%{transform:scale(1);opacity:1}100%{transform:scale(1.9);opacity:0}}
@keyframes rt-rise{0%{transform:translateY(3px);opacity:.25}45%{transform:translateY(0);opacity:1}100%{transform:translateY(0);opacity:1}}
@keyframes rt-spin{0%{transform:translateX(0)}100%{transform:translateX(-16px)}}
@keyframes rt-flow{to{stroke-dashoffset:-16}}
@keyframes rt-scanline{0%,100%{transform:translateY(-3.4px);opacity:.3}50%{transform:translateY(3.4px);opacity:1}}
.rt-bell{animation:rt-ring 3.4s ease-in-out infinite;transform-origin:12px 5px}
.rt-ping{animation:rt-ping 3.4s ease-in-out infinite;transform-origin:center;transform-box:fill-box}
.rt-sheet{animation:rt-rise 2.8s ease-in-out infinite}
.rt-sheet:nth-of-type(2){animation-delay:.22s}
.rt-sheet:nth-of-type(3){animation-delay:.44s}
.rt-merid{animation:rt-spin 4.4s linear infinite}
.rt-path{stroke-dasharray:4 4;animation:rt-flow 1.5s linear infinite}
.rt-scan{animation:rt-scanline 2.6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.rt-bell,.rt-ping,.rt-sheet,.rt-merid,.rt-path,.rt-scan{animation:none}}

/* THE SUBSCRIPTION ROWS SLIDING IN AS YOU SCROLL TO THEM.
   This is a scroll-driven CSS animation, which means no JavaScript and no
   client component — the row's own position in the viewport drives it, so
   they arrive one after another from the top without any staggered delays
   to maintain. Guarded twice on purpose: @supports means a browser without
   animation-timeline shows the rows normally rather than leaving them
   invisible, and the reduced-motion query means anyone who has asked their
   system to stop animations just sees them in place. */
@keyframes rt-slide-in{from{opacity:0;transform:translateX(56px)}to{opacity:1;transform:translateX(0)}}

/* The line sweeping down the second phone's viewfinder. */
@keyframes rt-sweep-big{0%,100%{transform:translateY(-62px);opacity:.3}50%{transform:translateY(62px);opacity:1}}
.rt-sweep-big{animation:rt-sweep-big 3s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.rt-sweep-big{animation:none}}
@supports (animation-timeline: view()){
  @media (prefers-reduced-motion: no-preference){
    .rt-slide{animation:rt-slide-in linear both;animation-timeline:view();animation-range:entry 0% cover 35%}
  }
}
`

export default function HomePage() {
  return (
    <>
      <style>{ICON_CSS}</style>
      <div style={{ boxSizing: "border-box", background: "#FAF8F3", display: "flex", flexDirection: "column" }}>

        {/* NAV */}
        <div style={{ minHeight: "72px", flexShrink: "0", boxSizing: "border-box", padding: "0 40px", background: "#222d27" }}>
          <div style={{ ...SHELL, minHeight: "72px", display: "flex", alignItems: "center", gap: "32px", flexWrap: "wrap" }}>
            <a href="/" style={{ fontFamily: FONT_DISPLAY, fontSize: "25px", fontWeight: "700", color: "#FAF8F3", letterSpacing: "-0.01em", textDecoration: "none" }}>Rootify</a>
            <div style={{ flexGrow: "1", display: "flex", alignItems: "center", gap: "26px", fontSize: "14px", flexWrap: "wrap" }}>
              <a href="#included" style={{ color: "#D3D9D4", textDecoration: "none" }}>What you get</a>
              <a href="#how" style={{ color: "#D3D9D4", textDecoration: "none" }}>How it works</a>
              <a href="#who" style={{ color: "#D3D9D4", textDecoration: "none" }}>Who we are</a>
              <a href="#pricing" style={{ color: "#D3D9D4", textDecoration: "none" }}>Pricing</a>
              <a href="/faq" style={{ color: "#D3D9D4", textDecoration: "none" }}>FAQ</a>
            </div>
            <a href="/search" style={{ display: "inline-flex", alignItems: "center", height: "40px", padding: "0 18px", boxSizing: "border-box", fontSize: "14px", fontWeight: "600", color: "#FFFFFF", background: "#B0502F", borderRadius: "6px", textDecoration: "none" }}>Browse the database</a>
          </div>
        </div>

        {/* HERO */}
        <div style={{ ...SHELL, minHeight: "600px", flexShrink: "0", boxSizing: "border-box", padding: "60px 40px 56px", display: "flex", gap: "40px", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ flexGrow: "1", flexBasis: "460px", maxWidth: "620px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11.5px", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", color: "#1D4D3C" }}>
              <span style={{ width: "22px", height: "2px", background: "#1D4D3C", display: "inline-block" }}></span>
              A family business · No ads · No brand money
            </div>
            <h1 style={{ margin: "18px 0 0", fontFamily: FONT_DISPLAY, fontSize: "60px", lineHeight: "1.04", fontWeight: "600", letterSpacing: "-0.025em" }}>Rootify,<br />&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;before you buy.</h1>
            <p style={{ margin: "22px 0 0", fontSize: "17.5px", lineHeight: "1.55", color: "#4F5A52", maxWidth: "570px" }}>Scan any barcode in the store. Rootify shows you the ingredients still under research, the recalls, the certificates, and who really owns the brand — each one with a link to the public record it came from and the date we read it.</p>
            <div style={{ display: "flex", gap: "12px", marginTop: "30px" }}>
              <span aria-disabled="true" title="The Rootify app is coming soon" style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "9px", height: "52px", padding: "0 22px", boxSizing: "border-box", fontSize: "15.5px", fontWeight: "600", color: "#FFFFFF", background: "#B0502F", borderRadius: "8px", textDecoration: "none" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 19h2" /></svg>
                Download for iPhone <span style={{ marginLeft: "4px", padding: "2px 7px", borderRadius: "99px", background: "rgba(0,0,0,0.12)", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase" }}>Soon</span>
              </span>
              <span aria-disabled="true" title="The Rootify app is coming soon" style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "9px", height: "52px", padding: "0 22px", boxSizing: "border-box", fontSize: "15.5px", fontWeight: "600", color: "#16201B", background: "#FFFFFF", border: "1px solid #C9C2B2", borderRadius: "8px", textDecoration: "none" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="2" /><path d="M10 19h4" /></svg>
                Download for Android <span style={{ marginLeft: "4px", padding: "2px 7px", borderRadius: "99px", background: "rgba(0,0,0,0.12)", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase" }}>Soon</span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "18px", marginTop: "22px", fontSize: "13.5px", color: "#4F5A52" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>Free to search and scan</span>
              <span style={{ color: "#C9C2B2" }} aria-hidden="true">|</span>
              <span><strong style={{ fontWeight: "600", color: "#16201B" }}>$2.99/month</strong> for everything else</span>
              <span style={{ color: "#C9C2B2" }} aria-hidden="true">|</span>
              <span>Cancel in two taps</span>
            </div>
            <div style={{ marginTop: "14px", fontSize: "14px" }}>
              <a href="/search" style={{ fontWeight: "600" }}>The apps are on their way. Browse the database now →</a>
            </div>
          </div>

          {/* The two phones: what a scan looks like, and what happens when
              there is no barcode to scan. */}
          <div style={{ display: "flex", gap: "16px", flexShrink: "0", flexWrap: "wrap", justifyContent: "center" }}>

          {/* phone 1 — a scan */}
          <div style={{ width: "296px", flexShrink: "0", height: "540px", boxSizing: "border-box", padding: "11px", background: "#222d27", borderRadius: "40px" }}>
            <div style={{ width: "100%", height: "100%", boxSizing: "border-box", background: "#FAF8F3", borderRadius: "30px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ flexShrink: "0", boxSizing: "border-box", padding: "20px 16px 0", display: "flex", gap: "11px" }}>
                <div style={{ width: "60px", height: "60px", flexShrink: "0", background: "#F3EEE3", border: "1px solid #E6E1D6", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#BDB49F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11h16v1a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7v-1z" /><path d="M15 8c0-2 2-2 2-4" /></svg>
                </div>
                <div style={{ minWidth: "0" }}>
                  <div style={{ fontSize: "9.5px", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase", color: "#656F67" }}>Kellanova</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: "15px", fontWeight: "600", lineHeight: "1.2", marginTop: "3px" }}>Frosted Cherry Toaster Pastries</div>
                </div>
              </div>
              <div style={{ flexGrow: "1", boxSizing: "border-box", padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: "7px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", boxSizing: "border-box", padding: "10px 11px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderLeft: "3px solid #8A5A0B", borderRadius: "8px" }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: "500", color: "#8A5A0B", width: "22px" }}>6</span>
                  <span style={{ fontSize: "11.5px", fontWeight: "600", lineHeight: "1.3" }}>ingredients with open research</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", boxSizing: "border-box", padding: "10px 11px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderLeft: "3px solid #1D4D3C", borderRadius: "8px" }}>
                  <span style={{ width: "22px", display: "flex", justifyContent: "center" }} aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg></span>
                  <span style={{ fontSize: "11.5px", fontWeight: "600", lineHeight: "1.3", color: "#1D4D3C" }}>No recalls on record</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", boxSizing: "border-box", padding: "10px 11px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderLeft: "3px solid #6B3F6E", borderRadius: "8px" }}>
                  <span style={{ width: "22px", display: "flex", justifyContent: "center" }} aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B3F6E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V9l5-3 5 3v11M14 20V13l6-3v10M3 20h18" /></svg></span>
                  <span style={{ fontSize: "11.5px", fontWeight: "600", lineHeight: "1.3" }}>Owned by Mars, Inc.</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", boxSizing: "border-box", padding: "10px 11px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderLeft: "3px solid #656F67", borderRadius: "8px" }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: "500", width: "22px" }}>34</span>
                  <span style={{ fontSize: "11.5px", fontWeight: "600", lineHeight: "1.3" }}>ingredients, in label order</span>
                </div>
                <div style={{ marginTop: "3px", boxSizing: "border-box", padding: "9px 11px", background: "#F0ECE1", border: "1px solid #E0DACB", borderRadius: "8px", fontSize: "10px", lineHeight: "1.45", color: "#4F5A52" }}>
                  Every line linked to its source · read <span style={{ fontFamily: FONT_MONO }}>2026-09-24</span>
                </div>
              </div>
              <div style={{ flexShrink: "0", boxSizing: "border-box", padding: "12px 16px 18px" }}>
                <a href={EXAMPLE_PRODUCT} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "40px", fontSize: "12.5px", fontWeight: "600", color: "#FFFFFF", background: "#B0502F", borderRadius: "8px", textDecoration: "none" }}>See every record</a>
              </div>
            </div>
          </div>

          {/* phone 2 — no barcode, so photograph the panel instead */}
          <div style={{ width: "296px", flexShrink: "0", height: "540px", boxSizing: "border-box", padding: "11px", background: "#222d27", borderRadius: "40px" }}>
            <div style={{ width: "100%", height: "100%", boxSizing: "border-box", background: "#FAF8F3", borderRadius: "30px", overflow: "hidden", display: "flex", flexDirection: "column" }}>

              <div style={{ flexShrink: "0", boxSizing: "border-box", padding: "18px 16px 0" }}>
                <div style={{ fontSize: "9.5px", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase", color: "#B0502F" }}>No barcode on the pack</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: "15px", fontWeight: "600", lineHeight: "1.2", marginTop: "4px" }}>Photograph the ingredient panel</div>
              </div>

              {/* the viewfinder */}
              <div style={{ flexShrink: "0", boxSizing: "border-box", margin: "13px 16px 0", height: "176px", position: "relative", overflow: "hidden", background: "#EFEADD", border: "1px solid #E0DACB", borderRadius: "10px", padding: "18px 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "7px" }}>
                <div style={{ fontSize: "8px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#A29A88", marginBottom: "2px" }}>Ingredients</div>
                <div style={{ height: "5px", width: "96%", background: "#D8D1BF", borderRadius: "3px" }}></div>
                <div style={{ height: "5px", width: "88%", background: "#D8D1BF", borderRadius: "3px" }}></div>
                <div style={{ height: "5px", width: "93%", background: "#D8D1BF", borderRadius: "3px" }}></div>
                <div style={{ height: "5px", width: "74%", background: "#D8D1BF", borderRadius: "3px" }}></div>
                <div style={{ height: "5px", width: "90%", background: "#D8D1BF", borderRadius: "3px" }}></div>
                <div style={{ height: "5px", width: "52%", background: "#D8D1BF", borderRadius: "3px" }}></div>

                {/* corner brackets */}
                <span aria-hidden="true" style={{ position: "absolute", top: "9px", left: "9px", width: "20px", height: "20px", borderTop: "2px solid #1D4D3C", borderLeft: "2px solid #1D4D3C", borderTopLeftRadius: "5px" }}></span>
                <span aria-hidden="true" style={{ position: "absolute", top: "9px", right: "9px", width: "20px", height: "20px", borderTop: "2px solid #1D4D3C", borderRight: "2px solid #1D4D3C", borderTopRightRadius: "5px" }}></span>
                <span aria-hidden="true" style={{ position: "absolute", bottom: "9px", left: "9px", width: "20px", height: "20px", borderBottom: "2px solid #1D4D3C", borderLeft: "2px solid #1D4D3C", borderBottomLeftRadius: "5px" }}></span>
                <span aria-hidden="true" style={{ position: "absolute", bottom: "9px", right: "9px", width: "20px", height: "20px", borderBottom: "2px solid #1D4D3C", borderRight: "2px solid #1D4D3C", borderBottomRightRadius: "5px" }}></span>

                {/* the sweep */}
                <span className="rt-sweep-big" aria-hidden="true" style={{ position: "absolute", left: "10px", right: "10px", top: "50%", height: "2px", background: "#1D4D3C", borderRadius: "2px" }}></span>
              </div>

              <div style={{ flexGrow: "1", boxSizing: "border-box", padding: "13px 16px 0", display: "flex", flexDirection: "column", gap: "7px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", boxSizing: "border-box", padding: "10px 11px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderLeft: "3px solid #656F67", borderRadius: "8px" }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: "500", width: "22px" }}>31</span>
                  <span style={{ fontSize: "11.5px", fontWeight: "600", lineHeight: "1.3" }}>ingredients read off the photo</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", boxSizing: "border-box", padding: "10px 11px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderLeft: "3px solid #8A5A0B", borderRadius: "8px" }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: "18px", fontWeight: "500", color: "#8A5A0B", width: "22px" }}>4</span>
                  <span style={{ fontSize: "11.5px", fontWeight: "600", lineHeight: "1.3" }}>have open research to read</span>
                </div>
                {/* The honest part. A photo read is OUR read of a label, not a
                    Rootify record — it has not been checked against anything
                    yet, and the card says so rather than implying otherwise. */}
                <div style={{ marginTop: "3px", boxSizing: "border-box", padding: "9px 11px", background: "#F1EEE6", border: "1px solid #E0DACB", borderRadius: "8px", fontSize: "10px", lineHeight: "1.45", color: "#4F5A52" }}>
                  Our read of your photo &mdash; not a Rootify record yet. It joins the queue to be checked against the original.
                </div>
              </div>

              <div style={{ flexShrink: "0", boxSizing: "border-box", padding: "12px 16px 18px" }}>
                <span aria-disabled="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "40px", fontSize: "12.5px", fontWeight: "600", color: "#FFFFFF", background: "#1D4D3C", borderRadius: "8px" }}>Add it to Rootify</span>
              </div>

            </div>
          </div>

          </div>
        </div>

        {/* INDEPENDENCE */}
        <div style={{ minHeight: "152px", flexShrink: "0", boxSizing: "border-box", padding: "26px 40px", background: "#1D4D3C" }}>
          <div style={{ ...SHELL, display: "flex", alignItems: "center", gap: "0", flexWrap: "wrap", rowGap: "22px" }}>
          <div style={{ flexGrow: "1", flexBasis: "220px", boxSizing: "border-box", paddingRight: "28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A8CDBB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 8.5h15M7 8.5V6a5 5 0 0 1 10 0v2.5" /><path d="M6 8.5h12l-1 11a2 2 0 0 1-2 1.8H9a2 2 0 0 1-2-1.8z" /></svg>
              <span style={{ fontSize: "14.5px", fontWeight: "700", color: "#FFFFFF" }}>No product ads</span>
            </div>
            <p style={{ margin: "7px 0 0", fontSize: "13px", lineHeight: "1.5", color: "#C3DACE" }}>You&apos;ll never see a brand&apos;s advertising on Rootify. That space isn&apos;t for sale.</p>
          </div>
          <span style={{ width: "1px", height: "62px", background: "#3A6957", flexShrink: "0" }} aria-hidden="true"></span>
          <div style={{ flexGrow: "1", flexBasis: "220px", boxSizing: "border-box", padding: "0 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A8CDBB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
              <span style={{ fontSize: "14.5px", fontWeight: "700", color: "#FFFFFF" }}>No brand money</span>
            </div>
            <p style={{ margin: "7px 0 0", fontSize: "13px", lineHeight: "1.5", color: "#C3DACE" }}>No company can pay to appear here, or to change, soften or remove what we publish.</p>
          </div>
          <span style={{ width: "1px", height: "62px", background: "#3A6957", flexShrink: "0" }} aria-hidden="true"></span>
          <div style={{ flexGrow: "1", flexBasis: "220px", boxSizing: "border-box", padding: "0 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A8CDBB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20.5c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" /></svg>
              <span style={{ fontSize: "14.5px", fontWeight: "700", color: "#FFFFFF" }}>Every line is sourced</span>
            </div>
            <p style={{ margin: "7px 0 0", fontSize: "13px", lineHeight: "1.5", color: "#C3DACE" }}>Each one links to the public record it came from, with the date we read it.</p>
          </div>
          <span style={{ width: "1px", height: "62px", background: "#3A6957", flexShrink: "0" }} aria-hidden="true"></span>
          <div style={{ flexGrow: "1", flexBasis: "220px", boxSizing: "border-box", paddingLeft: "28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A8CDBB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 4v5.5c0 4.6-3.3 8.4-8 9.5-4.7-1.1-8-4.9-8-9.5V7z" /></svg>
              <span style={{ fontSize: "14.5px", fontWeight: "700", color: "#FFFFFF" }}>Private by default</span>
            </div>
            <p style={{ margin: "7px 0 0", fontSize: "13px", lineHeight: "1.5", color: "#C3DACE" }}>We don&apos;t track your scans, sell your data, or need to know who you are.</p>
          </div>
          </div>
        </div>

        {/* WHAT A SUBSCRIPTION GIVES YOU */}
        <div id="included" style={{ ...SHELL, minHeight: "860px", flexShrink: "0", boxSizing: "border-box", padding: "56px 40px 0" }}>
          <h2 style={{ margin: "0", fontFamily: FONT_DISPLAY, fontSize: "36px", fontWeight: "600", letterSpacing: "-0.02em", textAlign: "center" }}>What a subscription gives you</h2>
          <p style={{ margin: "14px auto 0", fontSize: "16px", lineHeight: "1.55", color: "#4F5A52", maxWidth: "620px", textAlign: "center" }}>Five things, and every one of them on the shelf in front of you.</p>

          <div style={{ maxWidth: "880px", margin: "30px auto 0" }}>

            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: "4px", padding: "5px 13px", borderRadius: "99px", background: "#E2EDE7", flexShrink: "0" }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: "18px", fontWeight: "700", color: "#1D4D3C" }}>$2.99</span>
                <span style={{ fontSize: "12.5px", fontWeight: "600", color: "#1D4D3C" }}>/month</span>
              </span>
              <span style={{ flexGrow: "1", height: "1px", background: "#C3D8CB" }}></span>
              <a href="#pricing" style={{ fontSize: "13.5px", fontWeight: "600", flexShrink: "0" }}>Start Rootify Plus →</a>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "18px" }}>

              <div className="rt-slide" style={{ display: "flex", gap: "20px", alignItems: "center", boxSizing: "border-box", padding: "22px 26px", background: "#FFFFFF", border: "1px solid #C3D8CB", borderRadius: "13px" }}>
                <span style={{ width: "64px", height: "64px", flexShrink: "0", borderRadius: "14px", background: "#E2EDE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <g className="rt-bell"><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4.6 1.8 5.6 1.8 5.6H4.7S6.5 14.6 6.5 10z" /><path d="M10.1 18.6a2.1 2.1 0 0 0 3.8 0" /></g>
                    <circle className="rt-ping" cx="12" cy="5.2" r="2.4" fill="#1D4D3C" stroke="none" opacity="0" />
                  </svg>
                </span>
                <div style={{ flexGrow: "1", minWidth: "0" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: "22px", fontWeight: "600", lineHeight: "1.2", letterSpacing: "-0.01em" }}>Get Notified</div>
                  <p style={{ margin: "7px 0 0", fontSize: "15px", lineHeight: "1.5", color: "#4F5A52" }}>Subscribe to all the products you buy and get alerted if anything gets recalled or changed</p>
                </div>
              </div>

              <div className="rt-slide" style={{ display: "flex", gap: "20px", alignItems: "center", boxSizing: "border-box", padding: "22px 26px", background: "#FFFFFF", border: "1px solid #C3D8CB", borderRadius: "13px" }}>
                <span style={{ width: "64px", height: "64px", flexShrink: "0", borderRadius: "14px", background: "#E2EDE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect className="rt-sheet" x="3.6" y="15.4" width="16.8" height="5" rx="1.6" />
                    <rect className="rt-sheet" x="5.6" y="9.5" width="12.8" height="5" rx="1.6" />
                    <rect className="rt-sheet" x="7.6" y="3.6" width="8.8" height="5" rx="1.6" />
                  </svg>
                </span>
                <div style={{ flexGrow: "1", minWidth: "0" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: "22px", fontWeight: "600", lineHeight: "1.2", letterSpacing: "-0.01em" }}>Get Access</div>
                  <p style={{ margin: "7px 0 0", fontSize: "15px", lineHeight: "1.5", color: "#4F5A52" }}>The whole file: every study behind a flagged ingredient, every record we hold on a brand, and where the ingredients come from.</p>
                </div>
              </div>

              <div className="rt-slide" style={{ display: "flex", gap: "20px", alignItems: "center", boxSizing: "border-box", padding: "22px 26px", background: "#FFFFFF", border: "1px solid #C3D8CB", borderRadius: "13px" }}>
                <span style={{ width: "64px", height: "64px", flexShrink: "0", borderRadius: "14px", background: "#E2EDE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <defs><clipPath id="rtGlobeClip"><circle cx="12" cy="12" r="8.6" /></clipPath></defs>
                    <circle cx="12" cy="12" r="8.6" />
                    <g clipPath="url(#rtGlobeClip)"><g className="rt-merid">
                      <path d="M-4 3.4c2.4 2.3 3.6 5.2 3.6 8.6S-1.6 18.3-4 20.6" />
                      <path d="M4 3.4c2.4 2.3 3.6 5.2 3.6 8.6S6.4 18.3 4 20.6" />
                      <path d="M12 3.4c2.4 2.3 3.6 5.2 3.6 8.6S14.4 18.3 12 20.6" />
                      <path d="M20 3.4c2.4 2.3 3.6 5.2 3.6 8.6S22.4 18.3 20 20.6" />
                      <path d="M28 3.4c2.4 2.3 3.6 5.2 3.6 8.6S30.4 18.3 28 20.6" />
                      <path d="M36 3.4c2.4 2.3 3.6 5.2 3.6 8.6S38.4 18.3 36 20.6" />
                    </g></g>
                    <path d="M3.4 12h17.2" />
                  </svg>
                </span>
                <div style={{ flexGrow: "1", minWidth: "0" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: "22px", fontWeight: "600", lineHeight: "1.2", letterSpacing: "-0.01em" }}>Look Abroad</div>
                  <p style={{ margin: "7px 0 0", fontSize: "15px", lineHeight: "1.5", color: "#4F5A52" }}>Which countries make the same product carry a warning the US doesn&rsquo;t.</p>
                </div>
              </div>

              <div className="rt-slide" style={{ display: "flex", gap: "20px", alignItems: "center", boxSizing: "border-box", padding: "22px 26px", background: "#FFFFFF", border: "1px solid #C3D8CB", borderRadius: "13px" }}>
                <span style={{ width: "64px", height: "64px", flexShrink: "0", borderRadius: "14px", background: "#E2EDE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path className="rt-path" d="M6.4 17.6 10.5 13.5M13.5 10.5 17.6 6.4" />
                    <circle cx="4.8" cy="19.2" r="2.3" fill="#FFFFFF" />
                    <circle cx="12" cy="12" r="2.3" fill="#FFFFFF" />
                    <circle cx="19.2" cy="4.8" r="2.3" fill="#FFFFFF" />
                    <circle r="1.7" fill="#1D4D3C" stroke="none"><animateMotion dur="3.2s" repeatCount="indefinite" path="M4.8 19.2 19.2 4.8" /></circle>
                  </svg>
                </span>
                <div style={{ flexGrow: "1", minWidth: "0" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: "22px", fontWeight: "600", lineHeight: "1.2", letterSpacing: "-0.01em" }}>Trace the Owner</div>
                  <p style={{ margin: "7px 0 0", fontSize: "15px", lineHeight: "1.5", color: "#4F5A52" }}>The brand, the company that makes it, and the parent company that owns them both.</p>
                </div>
              </div>


              <div className="rt-slide" style={{ display: "flex", gap: "20px", alignItems: "center", boxSizing: "border-box", padding: "22px 26px", background: "#FFFFFF", border: "1px solid #C3D8CB", borderRadius: "13px" }}>
                <span style={{ width: "64px", height: "64px", flexShrink: "0", borderRadius: "14px", background: "#E2EDE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3.4 8.6V5.4a2 2 0 0 1 2-2h3.2M15.4 3.4h3.2a2 2 0 0 1 2 2v3.2M20.6 15.4v3.2a2 2 0 0 1-2 2h-3.2M8.6 20.6H5.4a2 2 0 0 1-2-2v-3.2" />
                    <path d="M7.8 10.1h8.4M7.8 13.9h5.6" opacity="0.38" />
                    <path className="rt-scan" d="M6.8 12h10.4" />
                  </svg>
                </span>
                <div style={{ flexGrow: "1", minWidth: "0" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: "22px", fontWeight: "600", lineHeight: "1.2", letterSpacing: "-0.01em" }}>Snap the Label</div>
                  <p style={{ margin: "7px 0 0", fontSize: "15px", lineHeight: "1.5", color: "#4F5A52" }}>Photograph the ingredient panel on anything we haven&rsquo;t read yet and get the list back in seconds.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* HOW IT WORKS */}
        <div id="how" style={{ ...SHELL, minHeight: "440px", flexShrink: "0", boxSizing: "border-box", padding: "54px 40px 0" }}>
          <h2 style={{ margin: "0", fontFamily: FONT_DISPLAY, fontSize: "34px", fontWeight: "600", letterSpacing: "-0.018em", textAlign: "center" }}>Three steps, in the aisle</h2>
          <p style={{ margin: "12px auto 0", fontSize: "15.5px", lineHeight: "1.55", color: "#4F5A52", maxWidth: "620px", textAlign: "center" }}>It takes about as long as reading the back of the box, and you get everything the box doesn&apos;t say.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "24px", marginTop: "36px" }}>

            <div style={{ boxSizing: "border-box", padding: "24px 24px 26px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderRadius: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", borderRadius: "99px", background: "#16201B", color: "#FAF8F3", fontFamily: FONT_MONO, fontSize: "15px", fontWeight: "500", flexShrink: "0" }}>1</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: "20px", fontWeight: "600" }}>Scan the barcode</span>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: "14px", lineHeight: "1.6", color: "#4F5A52" }}>Point your phone at the barcode. No barcode on the package? Photograph the ingredient panel instead and we&apos;ll read it.</p>
            </div>

            <div style={{ boxSizing: "border-box", padding: "24px 24px 26px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderRadius: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", borderRadius: "99px", background: "#16201B", color: "#FAF8F3", fontFamily: FONT_MONO, fontSize: "15px", fontWeight: "500", flexShrink: "0" }}>2</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: "20px", fontWeight: "600" }}>See what&apos;s on record</span>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: "14px", lineHeight: "1.6", color: "#4F5A52" }}>Certificates, recalls, ingredients with unsettled research, and the company behind the brand. Every line links to its source and carries the date we read it.</p>
            </div>

            <div style={{ boxSizing: "border-box", padding: "24px 24px 26px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderRadius: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", borderRadius: "99px", background: "#16201B", color: "#FAF8F3", fontFamily: FONT_MONO, fontSize: "15px", fontWeight: "500", flexShrink: "0" }}>3</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: "20px", fontWeight: "600" }}>Decide for yourself</span>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: "14px", lineHeight: "1.6", color: "#4F5A52" }}>There&apos;s no score and no grade. We don&apos;t think one number can carry a judgement we can&apos;t source. You get the records; the call is yours.</p>
            </div>

          </div>
        </div>

        {/* WHO WE ARE */}
        <div id="who" style={{ ...SHELL, minHeight: "400px", flexShrink: "0", boxSizing: "border-box", padding: "44px 40px 0", display: "flex", gap: "48px", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ width: "380px", flexShrink: "0", height: "300px", background: "#F0ECE1", border: "1px solid #E0DACB", borderRadius: "12px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
            <svg width="132" height="132" viewBox="0 0 120 120" fill="none" stroke="#1D4D3C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M60 14v44" strokeWidth="3" />
              <path d="M60 30c0-8 6-14 14-15 0 8-6 14-14 15zM60 30c0-8-6-14-14-15 0 8 6 14 14 15z" />
              <path d="M18 62h84" stroke="#C0B9A6" strokeWidth="1.6" strokeDasharray="4 5" />
              <path d="M60 62v30" strokeWidth="3" />
              <path d="M60 74c-7 3-11 9-13 17M60 74c7 3 11 9 13 17" />
              <path d="M60 86c-5 2-8 6-10 12M60 86c5 2 8 6 10 12" />
              <path d="M60 92v14" strokeWidth="2.6" />
            </svg>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: "16px", fontStyle: "italic", color: "#1D4D3C" }}>Rooted in the record.</span>
          </div>
          <div style={{ flexGrow: "1", minWidth: "0" }}>
            <div style={{ fontSize: "11.5px", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", color: "#B0502F" }}>Who we are</div>
            <h2 style={{ margin: "14px 0 0", fontFamily: FONT_DISPLAY, fontSize: "34px", lineHeight: "1.12", fontWeight: "600", letterSpacing: "-0.018em" }}>A family business. No investors,<br />no board, no advertisers.</h2>
            <p style={{ margin: "18px 0 0", fontSize: "15.5px", lineHeight: "1.6", color: "#4F5A52", maxWidth: "640px" }}>We are a mother and a father who wanted to put real food on the table for our family, and kept finding we could not tell what was real. Labels that said organic turned out to cover less than we had assumed. Small brands we had trusted for years were quietly bought by companies we would never have chosen. Recalls reached us months late, or never at all.</p>
            <p style={{ margin: "14px 0 0", fontSize: "15.5px", lineHeight: "1.6", color: "#4F5A52", maxWidth: "640px" }}>All of it was on the public record somewhere. Just nowhere a parent standing in an aisle with a toddler could reach in the time they actually have. So we started reading the records ourselves, one product at a time. That is Rootify.</p>
            <p style={{ margin: "14px 0 0", fontSize: "15.5px", lineHeight: "1.6", color: "#4F5A52", maxWidth: "640px" }}>Nobody owns a piece of this but us. There&apos;s no marketing department, no outside money and no advertiser to keep happy — which is the whole reason we can publish what the records actually say.</p>
            <a href="#pricing" style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "20px", fontSize: "14.5px", fontWeight: "600" }}>How we&apos;re funded <span aria-hidden="true">→</span></a>
          </div>
        </div>

        {/* HOW A LINE GETS PUBLISHED */}
        <div style={{ ...SHELL, minHeight: "340px", flexShrink: "0", boxSizing: "border-box", padding: "40px 40px 0" }}>
          <div style={{ boxSizing: "border-box", padding: "30px 34px 32px", background: "#F0ECE1", border: "1px solid #E0DACB", borderRadius: "12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "30px" }}>
              <h2 style={{ margin: "0", fontFamily: FONT_DISPLAY, fontSize: "27px", fontWeight: "600", letterSpacing: "-0.015em" }}>How a line gets onto a product page</h2>
              <span style={{ fontSize: "13px", color: "#656F67", flexShrink: "0" }}>Public records only · every claim dated</span>
            </div>
            <div style={{ display: "flex", alignItems: "stretch", gap: "0", marginTop: "24px", flexWrap: "wrap", rowGap: "20px" }}>
              <div style={{ flexGrow: "1", flexBasis: "0", minWidth: "170px", boxSizing: "border-box", paddingRight: "22px" }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: "12px", color: "#A29A88" }}>01</div>
                <div style={{ fontSize: "14.5px", fontWeight: "700", marginTop: "6px" }}>A public record</div>
                <p style={{ margin: "6px 0 0", fontSize: "12.5px", lineHeight: "1.5", color: "#4F5A52" }}>USDA, FDA, the product-safety commission, SEC filings, and the certifiers&apos; own registers.</p>
              </div>
              <span style={{ width: "22px", flexShrink: "0", display: "flex", alignItems: "center", justifyContent: "center", color: "#C0B9A6" }} aria-hidden="true">→</span>
              <div style={{ flexGrow: "1", flexBasis: "0", minWidth: "170px", boxSizing: "border-box", padding: "0 22px" }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: "12px", color: "#A29A88" }}>02</div>
                <div style={{ fontSize: "14.5px", fontWeight: "700", marginTop: "6px" }}>A machine drafts it</div>
                <p style={{ margin: "6px 0 0", fontSize: "12.5px", lineHeight: "1.5", color: "#4F5A52" }}>Software pulls the record and turns it into plain English. Nothing is published at this stage.</p>
              </div>
              <span style={{ width: "22px", flexShrink: "0", display: "flex", alignItems: "center", justifyContent: "center", color: "#C0B9A6" }} aria-hidden="true">→</span>
              <div style={{ flexGrow: "1", flexBasis: "0", minWidth: "170px", boxSizing: "border-box", padding: "0 22px" }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: "12px", color: "#1D4D3C" }}>03</div>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "6px" }}>
                  <span style={{ fontSize: "14.5px", fontWeight: "700", color: "#1D4D3C" }}>It gets verified</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: "12.5px", lineHeight: "1.5", color: "#4F5A52" }}>Matched back to the original document. Corrected, or thrown out if it doesn&apos;t hold up. This is the step that matters.</p>
              </div>
              <span style={{ width: "22px", flexShrink: "0", display: "flex", alignItems: "center", justifyContent: "center", color: "#C0B9A6" }} aria-hidden="true">→</span>
              <div style={{ flexGrow: "1", flexBasis: "0", minWidth: "170px", boxSizing: "border-box", paddingLeft: "22px" }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: "12px", color: "#A29A88" }}>04</div>
                <div style={{ fontSize: "14.5px", fontWeight: "700", marginTop: "6px" }}>Published with its date</div>
                <p style={{ margin: "6px 0 0", fontSize: "12.5px", lineHeight: "1.5", color: "#4F5A52" }}>Every claim is stored with its source and the date we read it, so anyone can check it against the same record.</p>
              </div>
            </div>
            <div style={{ marginTop: "22px", paddingTop: "18px", borderTop: "1px solid #E0DACB", fontSize: "13px", lineHeight: "1.55", color: "#4F5A52" }}>
              We get things wrong sometimes. When we do, the correction is dated and stays on the page — <a href="/corrections">read our corrections log</a>.
            </div>
          </div>
        </div>

        {/* PRICING */}
        <div id="pricing" style={{ ...SHELL, minHeight: "560px", flexShrink: "0", boxSizing: "border-box", padding: "58px 40px 0" }}>
          <h2 style={{ margin: "0", fontFamily: FONT_DISPLAY, fontSize: "40px", fontWeight: "600", letterSpacing: "-0.02em", textAlign: "center" }}>Subscription</h2>
          <p style={{ margin: "14px auto 0", fontSize: "16.5px", lineHeight: "1.55", color: "#4F5A52", maxWidth: "660px", textAlign: "center" }}>Our money comes from readers, not from the companies we write about. Here is the whole of it, in full, so you never have to go looking for what a tier actually includes.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "24px", marginTop: "36px", maxWidth: "1100px", marginLeft: "auto", marginRight: "auto" }}>

            <div style={{ boxSizing: "border-box", padding: "30px 32px 32px", background: "#FFFFFF", border: "1px solid #E6E1D6", borderRadius: "14px", display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: "12.5px", fontWeight: "700", letterSpacing: "0.09em", textTransform: "uppercase", color: "#656F67" }}>Free</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "7px", marginTop: "12px" }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: "46px", fontWeight: "600", lineHeight: "1" }}>$0</span>
                <span style={{ fontSize: "15px", color: "#656F67" }}>forever, no account needed</span>
              </div>
              <ul style={{ listStyle: "none", margin: "22px 0 0", padding: "0", display: "flex", flexDirection: "column", gap: "13px", fontSize: "14.5px", lineHeight: "1.55", color: "#4F5A52", flexGrow: 1 }}>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span>Search or scan any product in the database</span>
                </li>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span>The full ingredient list, in the order it appears on the label</span>
                </li>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span>Organic and Non-GMO status, straight from the registers</span>
                </li>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span>Recall history on anything you look up</span>
                </li>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span>Every line linked to the record it came from, with the date we read it</span>
                </li>
              </ul>
              <a href="/search" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50px", marginTop: "26px", fontSize: "15px", fontWeight: "600", color: "#16201B", background: "#FFFFFF", border: "1px solid #C9C2B2", borderRadius: "8px", textDecoration: "none" }}>Browse free</a>
            </div>

            <div style={{ boxSizing: "border-box", padding: "30px 32px 32px", background: "#FFFFFF", border: "2px solid #1D4D3C", borderRadius: "14px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "12.5px", fontWeight: "700", letterSpacing: "0.09em", textTransform: "uppercase", color: "#1D4D3C" }}>Rootify Plus</span>
                <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 9px", borderRadius: "99px", background: "#E2EDE7", color: "#1D4D3C" }}>Everything in Free, plus</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "7px", marginTop: "12px" }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: "46px", fontWeight: "600", lineHeight: "1" }}>$2.99</span>
                <span style={{ fontSize: "15px", color: "#656F67" }}>a month, or $29.99 a year</span>
              </div>
              <ul style={{ listStyle: "none", margin: "22px 0 0", padding: "0", display: "flex", flexDirection: "column", gap: "13px", fontSize: "14.5px", lineHeight: "1.55", color: "#4F5A52", flexGrow: 1 }}>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span><strong style={{ fontWeight: "600", color: "#16201B" }}>Get Notified</strong> — follow the products you buy, and we tell you the day one is recalled or the recipe changes</span>
                </li>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span><strong style={{ fontWeight: "600", color: "#16201B" }}>Get Access</strong> — every study behind a flagged ingredient, who funded it, and every record we hold on the brand</span>
                </li>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span><strong style={{ fontWeight: "600", color: "#16201B" }}>Look Abroad</strong> — which countries make the same product carry a warning the US doesn&rsquo;t</span>
                </li>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span><strong style={{ fontWeight: "600", color: "#16201B" }}>Trace the Owner</strong> — the brand, the company that makes it, and the parent company above them both</span>
                </li>
                <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D4D3C" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "3px" }} aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
                  <span><strong style={{ fontWeight: "600", color: "#16201B" }}>Snap the Label</strong> — photograph the ingredient panel on anything we haven&rsquo;t read yet and get the list back in seconds</span>
                </li>
              </ul>
              <span aria-disabled="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50px", marginTop: "26px", fontSize: "15px", fontWeight: "600", color: "#FFFFFF", background: "#1D4D3C", borderRadius: "8px" }}>Rootify Plus is coming soon</span>
            </div>

          </div>
          <p style={{ margin: "22px auto 0", fontSize: "13px", lineHeight: "1.55", color: "#656F67", maxWidth: "820px", textAlign: "center" }}>Cancel any time, in two taps. No trial that bills you by surprise, and no price that quietly goes up after a year. Recall history stays free for everyone, always &mdash; being told the day something is recalled is the part a subscription pays for.</p>
        </div>

        {/* FAQ (teaser — the full list lives at /faq) */}
        <div style={{ ...SHELL, minHeight: "320px", flexShrink: "0", boxSizing: "border-box", padding: "52px 40px 0" }}>
          <h2 style={{ margin: "0", fontFamily: FONT_DISPLAY, fontSize: "32px", fontWeight: "600", letterSpacing: "-0.018em", textAlign: "center" }}>Questions</h2>
          <p style={{ margin: "12px auto 26px", fontSize: "15.5px", lineHeight: "1.55", color: "#4F5A52", maxWidth: "620px", textAlign: "center" }}>The three we get asked most. <a href="/faq" style={{ fontWeight: "600" }}>The full list is on the FAQ page</a>.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "26px" }}>
            <div>
              <div style={{ fontSize: "15px", fontWeight: "700", lineHeight: "1.4" }}>Why isn&apos;t there a score?</div>
              <p style={{ margin: "9px 0 0", fontSize: "13.5px", lineHeight: "1.6", color: "#4F5A52" }}>Boiling a product down to one number means making a judgement we can&apos;t put a source against. We&apos;d rather hand you the records and let you weigh them yourself.</p>
            </div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: "700", lineHeight: "1.4" }}>How do you make money?</div>
              <p style={{ margin: "9px 0 0", fontSize: "13.5px", lineHeight: "1.6", color: "#4F5A52" }}>Subscriptions, and nothing else. No brand can buy ad space, a placement or a kinder write-up, and we don&apos;t sell your data.</p>
            </div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: "700", lineHeight: "1.4" }}>What if a brand says you&apos;re wrong?</div>
              <p style={{ margin: "9px 0 0", fontSize: "13.5px", lineHeight: "1.6", color: "#4F5A52" }}>Every claim carries its source and date, so anyone can check it against the same document. If we got it wrong, we correct it and date the correction. If we didn&apos;t, it stays.</p>
            </div>
          </div>
          <div style={{ marginTop: "28px", textAlign: "center" }}>
            <a href="/faq" style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "46px", padding: "0 22px", boxSizing: "border-box", fontSize: "15px", fontWeight: "600", color: "#16201B", background: "#FFFFFF", border: "1px solid #C9C2B2", borderRadius: "8px", textDecoration: "none" }}>Read every question <span aria-hidden="true">&rarr;</span></a>
          </div>
        </div>

        {/* FINAL CTA */}
        <div style={{ minHeight: "180px", flexShrink: "0", boxSizing: "border-box", padding: "34px 40px", background: "#222d27" }}>
          <div style={{ ...SHELL, display: "flex", alignItems: "center", gap: "40px", flexWrap: "wrap", rowGap: "20px" }}>
          <div style={{ flexGrow: "1", flexBasis: "380px" }}>
            <h2 style={{ margin: "0", fontFamily: FONT_DISPLAY, fontSize: "30px", lineHeight: "1.15", fontWeight: "600", color: "#FAF8F3", letterSpacing: "-0.015em" }}>Start with one thing in your cupboard.</h2>
            <p style={{ margin: "10px 0 0", fontSize: "14.5px", lineHeight: "1.5", color: "#A8B0A9", maxWidth: "560px" }}>Scan it tonight. If we haven&apos;t read it yet, we&apos;ll say so, add it to the queue, and tell you when it&apos;s done.</p>
          </div>
          <div style={{ display: "flex", gap: "12px", flexShrink: "0" }}>
            <span aria-disabled="true" title="The Rootify app is coming soon" style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", height: "50px", padding: "0 22px", boxSizing: "border-box", fontSize: "15px", fontWeight: "600", color: "#FFFFFF", background: "#B0502F", borderRadius: "8px", textDecoration: "none" }}>Download for iPhone <span style={{ marginLeft: "4px", padding: "2px 7px", borderRadius: "99px", background: "rgba(0,0,0,0.12)", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase" }}>Soon</span></span>
            <span aria-disabled="true" title="The Rootify app is coming soon" style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", height: "50px", padding: "0 22px", boxSizing: "border-box", fontSize: "15px", fontWeight: "600", color: "#FAF8F3", border: "1px solid #55605A", borderRadius: "8px", textDecoration: "none" }}>Download for Android <span style={{ marginLeft: "4px", padding: "2px 7px", borderRadius: "99px", background: "rgba(0,0,0,0.12)", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase" }}>Soon</span></span>
          </div>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ minHeight: "100px", flexShrink: "0", boxSizing: "border-box", padding: "24px 40px", background: "#F0ECE1", borderTop: "1px solid #E0DACB" }}>
          <div style={{ ...SHELL, display: "flex", alignItems: "center", gap: "36px", flexWrap: "wrap", rowGap: "16px" }}>
          <div style={{ flexGrow: "1", flexBasis: "320px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: "17px", fontWeight: "700" }}>Rootify</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: "13.5px", fontStyle: "italic", color: "#4F5A52" }}>Rooted in the record.</span>
            </div>
            <div style={{ fontSize: "12.5px", color: "#656F67", marginTop: "5px" }}>A family business. We report public records — not health advice.</div>
          </div>
          <div style={{ display: "flex", gap: "22px", fontSize: "12.5px" }}>
            <a href="/sourcing">How we source</a>
            <a href="/corrections">Corrections</a>
            <a href="#who">Our funding</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/faq">FAQ</a>
            <a href="/contact">Contact us</a>
          </div>
          </div>
        </div>

      </div>
    </>
  )
}
