import type { Metadata } from 'next'
import type { CSSProperties, ReactNode } from 'react'
import { colors, font } from '@/lib/design'
import { TopNav } from '@/components/SiteChrome'

// THE FAQ, at /faq.
//
// Replaces the three-question "Fair questions" block that used to sit on the
// landing page. The landing page keeps a three-question teaser that links
// here.
//
// TWO THINGS TO KNOW BEFORE EDITING THIS FILE
//
// 1. This page carries the verification disclosure. Rootify's public copy says
//    "verified" without naming the method; the method is disclosed here,
//    plainly, because this is where someone comes to ask. Do not soften it
//    and do not move it somewhere less visible.
//
// 2. Answers follow the voice rule: state the record and the date, then stop.
//    No sentence here exists to reassure a brand. Where the honest answer is
//    "we don't know yet" or "that isn't built", it says so.

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'How Rootify gets its information, what it will and will not publish, what a subscription costs, and how to tell us we got something wrong.',
}

const SHELL: CSSProperties = {
  maxWidth: '1320px',
  marginLeft: 'auto',
  marginRight: 'auto',
  width: '100%',
}

type QA = { q: string; a: ReactNode }
type Group = { title: string; blurb?: string; items: QA[] }

const GROUPS: Group[] = [
  {
    title: 'The basics',
    items: [
      {
        q: 'What is Rootify?',
        a: 'A place to look up what the public record says about a grocery product: its ingredients, whether it is in the organic and Non-GMO registers, any government recalls, and which company actually owns the brand. Every line links to the record it came from and carries the date we read it.',
      },
      {
        q: 'Is there an app?',
        a: 'Not yet. The phone app with the barcode scanner is being built. The database is searchable on the web now, and the app-store buttons will light up when there is something behind them.',
      },
      {
        q: 'What does it cost?',
        a: 'Searching and scanning is free, along with the full ingredient list, organic and Non-GMO status, recall history and who owns the brand. Rootify Plus is $2.99 a month and adds alerts, the research behind flagged ingredients, every source we hold on a brand, the full ownership chain and label photos for products we have not read yet.',
      },
      {
        q: 'How many products are in it?',
        a: 'Fewer than are in a supermarket, and the number changes weekly. If a product is not there, the page says so rather than pretending the shelf is empty — that is our gap, not a finding about the product.',
      },
    ],
  },
  {
    title: 'Where the information comes from',
    blurb: 'Everything on a product page is a public record. These are the records, and this is what we do to them.',
    items: [
      {
        q: 'Which sources do you use?',
        a: 'The USDA Organic Integrity Database for organic certificates; the FDA, the USDA food-safety service and the Consumer Product Safety Commission for recalls and warning letters; US Customs for forced-labour orders; SEC filings for ownership and investors; the certification schemes’ own registers for marks like Non-GMO Project Verified; and the open product databases (Open Food Facts and its sister projects) plus USDA FoodData Central for ingredient lists and barcodes.',
      },
      {
        q: 'Does a person check every record?',
        a: 'No, and we would rather say so than imply otherwise. Verification is automated: software matches each record back to the original document, and re-checks company names against independent databases before any government notice is attached to a brand. Records that do not hold up are corrected or dropped. People come into it when something is disputed or reported to us — see the corrections question below.',
      },
      {
        q: 'What does it mean when something says "nothing on file"?',
        a: 'That we looked and the register has no entry. It is not a finding about the product. "Not organic" is a claim about how food was grown, which we cannot make; "not in the organic register" is a fact about a register, which we can.',
      },
      {
        q: 'And when it says "we couldn’t check"?',
        a: 'That nobody has looked yet, usually because the brand has not been confirmed as a company. Government notices are matched by company name, and an unconfirmed name is not reliable enough to attach a recall to — a wrong match would publish one company’s recall on another company’s page. So the page says the check has not happened instead of showing an empty result that looks like a clean one.',
      },
      {
        q: 'Why is a recall showing on a brand that did not issue it?',
        a: 'Because the notice names it. A recall lives on the page of the company that issued it, and appears beside a product only when the notice itself identifies that product — usually by barcode. A notice that names a brand but no product is shown as exactly that. A notice about how food was made that names no product at all is shown as a note, never as a recall of anything you are looking at.',
      },
      {
        q: 'How current is it?',
        a: 'Each line carries the date we read it, so you can judge for yourself. Some sources update daily and some are monthly files we download by hand; where a source is overdue a refresh, the page says so.',
      },
    ],
  },
  {
    title: 'What Rootify will not do',
    items: [
      {
        q: 'Why isn’t there a score?',
        a: 'Boiling a product down to one number means making a judgement we cannot put a source against. Scores also flatten the thing that actually matters — whether a claim is documented — into a colour. You get the records; the call is yours.',
      },
      {
        q: 'Why is nothing marked red?',
        a: 'Because a red badge is a verdict, and we publish records rather than verdicts. Colour on a Rootify page tells you the state of the record: checked and confirmed, checked with nothing on file, research still open, a recall on the record, or not checked yet. Green is not a reward and grey is not a penalty.',
      },
      {
        q: 'Does an ingredient being flagged mean it is harmful?',
        a: 'No. Flagged means there is research on file that is unsettled or that disagrees with itself. The ingredient page shows each study, what it found, and who paid for it, because nutrition research is heavily industry-funded and a conclusion cannot be weighed without knowing who funded it.',
      },
      {
        q: 'Do you tell me what to buy?',
        a: 'No. There are no recommendations, no "better alternatives" and no affiliate links to products. We are not dietitians and nothing here is health advice.',
      },
    ],
  },
  {
    title: 'Money',
    items: [
      {
        q: 'How do you make money?',
        a: 'Subscriptions. No brand can buy ad space, a placement, a badge or a kinder write-up, and no company can pay to change, soften or remove what we publish. We do not sell your data.',
      },
      {
        q: 'What does "no ads" actually mean?',
        a: 'Two things. Brands cannot pay to advertise their products inside Rootify, and we do not buy advertising ourselves. It does not mean nobody is ever paid: creators who recommend Rootify can earn a share of the subscriptions they bring in. That is money going out to them, never brand money coming in to us, and creators in that programme are required to disclose the relationship.',
      },
      {
        q: 'Why is being told about a recall a paid feature when recall history is free?',
        a: 'Looking up whether a product has ever been recalled is free for everyone and always will be. Being told the day it happens, without having to look, is the part a subscription pays for — it costs us something to run continuously, and it is the feature that keeps working after you have left the shop.',
      },
    ],
  },
  {
    title: 'When we get it wrong',
    items: [
      {
        q: 'What if a brand says you are wrong?',
        a: 'Every claim carries its source and its date, so anyone can check it against the same document we used. If we got it wrong, we correct it and the correction is dated and stays on the page. If we did not, it stays as published.',
      },
      {
        q: 'I found a mistake. How do I report it?',
        a: 'Tell us which product and which line, and we will check it against the source. Reports are read by a person — this is the part of the process people are in.',
      },
      {
        q: 'Do you delete things?',
        a: 'Corrections are additions, not deletions. A record that turns out to be wrong is corrected and the correction is dated, so the page shows that it changed rather than quietly reading differently than it did last week.',
      },
    ],
  },
  {
    title: 'Privacy',
    items: [
      {
        q: 'Do you track what I scan?',
        a: 'No. We do not need to know who you are to answer a barcode, and there is no account required to search. Products you choose to follow for alerts have to be stored against something, and that is the only reason an account will exist.',
      },
      {
        q: 'Do you sell data?',
        a: 'No.',
      },
    ],
  },
  {
    title: 'Who runs this',
    items: [
      {
        q: 'Who is behind Rootify?',
        a: 'A family, working on it themselves. There are no investors, no board and no advertisers, which is the whole reason we can publish what the records say. We keep our names and where we live off the site on purpose.',
      },
      {
        q: 'Can a company pay to be listed, or to be left out?',
        a: 'No, in both directions.',
      },
    ],
  },
]

export default function FaqPage() {
  return (
    <div style={{ boxSizing: 'border-box', background: colors.paper, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* THE SHARED SITE HEADER. Michael, 2026-10-08: "this should be the
          same despite which page we are on." This page and the landing page
          each hand-wrote their own dark bar, and the two had already drifted
          — the same button read "Search products" on one and "Browse the
          database" on the other. Both use TopNav now, which is the header
          every page that holds data has used since round 8. See
          SiteChrome.tsx for what moved out of it to make that possible. */}
      <TopNav active="faq" />

      {/* HEADER */}
      <div style={{ ...SHELL, boxSizing: 'border-box', padding: '54px clamp(18px, 4vw, 40px) 0' }}>
        <div style={{ maxWidth: '720px' }}>
          <div style={{ fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: colors.link }}>Questions</div>
          <h1 style={{ margin: '14px 0 0', fontFamily: font.display, fontSize: 'clamp(30px, 7.5vw, 46px)', lineHeight: '1.06', fontWeight: 600, letterSpacing: '-0.022em' }}>Everything people ask us.</h1>
          <p style={{ margin: '20px 0 0', fontSize: '17px', lineHeight: '1.6', color: colors.ink2 }}>
            Including the awkward ones. If something you want to know is not here,{' '}
            <a href="/contact" style={{ fontWeight: 600 }}>ask us</a> and we will add it.
          </p>
        </div>

        {/* Jump links. Plain anchors — the page works with JavaScript off. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px', marginTop: '30px' }}>
          {GROUPS.map((g) => (
            <a
              key={g.title}
              href={`#${slug(g.title)}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '7px 14px',
                boxSizing: 'border-box',
                fontSize: '13.5px',
                fontWeight: 600,
                color: colors.ink,
                background: '#FFFFFF',
                border: `1px solid ${colors.line}`,
                borderRadius: '99px',
                textDecoration: 'none',
              }}
            >
              {g.title}
            </a>
          ))}
        </div>
      </div>

      {/* THE QUESTIONS */}
      <div style={{ ...SHELL, flexGrow: 1, boxSizing: 'border-box', padding: '44px clamp(18px, 4vw, 40px) 0', display: 'flex', flexDirection: 'column', gap: '42px' }}>
        {GROUPS.map((group) => (
          <section key={group.title} id={slug(group.title)} style={{ scrollMarginTop: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', borderBottom: `2px solid ${colors.ink}`, paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontFamily: font.display, fontSize: '26px', fontWeight: 600, letterSpacing: '-0.015em' }}>{group.title}</h2>
              <span style={{ fontFamily: font.mono, fontSize: '12.5px', color: colors.ink4 }}>
                {group.items.length}
              </span>
            </div>

            {group.blurb && (
              <p style={{ margin: '14px 0 0', fontSize: '14.5px', lineHeight: '1.6', color: colors.ink2, maxWidth: '760px' }}>
                {group.blurb}
              </p>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))',
                gap: '16px',
                marginTop: '20px',
              }}
            >
              {group.items.map((item) => (
                <div
                  key={item.q}
                  style={{
                    boxSizing: 'border-box',
                    padding: '20px 22px 22px',
                    background: '#FFFFFF',
                    border: `1px solid ${colors.line}`,
                    borderRadius: '11px',
                  }}
                >
                  <div style={{ fontFamily: font.display, fontSize: '18px', fontWeight: 600, lineHeight: '1.3' }}>{item.q}</div>
                  <p style={{ margin: '10px 0 0', fontSize: '14.5px', lineHeight: '1.65', color: colors.ink2 }}>{item.a}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* FOOTER */}
      <div style={{ flexShrink: 0, boxSizing: 'border-box', marginTop: '52px', padding: '24px clamp(18px, 4vw, 40px)', background: colors.panel, borderTop: '1px solid #E0DACB' }}>
        <div style={{ ...SHELL, display: 'flex', alignItems: 'center', gap: '36px', flexWrap: 'wrap', rowGap: '16px' }}>
          <div style={{ flexGrow: 1, flexBasis: '320px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ fontFamily: font.display, fontSize: '17px', fontWeight: 700 }}>Rootify</span>
              <span style={{ fontFamily: font.display, fontSize: '13.5px', fontStyle: 'italic', color: colors.ink2 }}>Rooted in the record.</span>
            </div>
            <div style={{ fontSize: '12.5px', color: colors.ink3, marginTop: '5px' }}>A family business. We report public records — not health advice.</div>
          </div>
          <div style={{ display: 'flex', gap: '22px', fontSize: '12.5px', flexWrap: 'wrap' }}>
            <a href="/sourcing">How we source</a>
            <a href="/corrections">Corrections</a>
            <a href="/#pricing">Our funding</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/contact">Contact us</a>
          </div>
        </div>
      </div>

    </div>
  )
}

// Turns a group title into an anchor id, so the jump links and the section
// ids can never disagree.
function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
