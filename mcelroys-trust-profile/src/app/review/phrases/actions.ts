'use server'

// THE FIRST MUTATION IN THIS APPLICATION. Everything else Rootify serves is
// read-only, which is why there was no server action and no route handler in
// src/app before this file.
//
// It is also the first thing a stranger could POST to, so it is gated twice:
// the page calls notFound() outside development, and this action refuses
// outside development on its own. A server action compiles to a POST
// endpoint whether or not a page renders it, so gating only the page would
// leave the endpoint live in production.
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { VERDICTS } from '@/lib/phraseSample'

function devOnly() {
  if (process.env.NODE_ENV === 'production') notFound()
}

export async function saveHumanVerdict(
  phrase: string,
  humanVerdict: string | null,
  humanNote: string | null
) {
  devOnly()

  // The vocabulary is closed. A typo here would write a verdict nothing
  // reads, and it would look like a scored row in every count.
  if (humanVerdict !== null && !(VERDICTS as readonly string[]).includes(humanVerdict)) {
    throw new Error(`refusing to write an unknown verdict: ${JSON.stringify(humanVerdict)}`)
  }

  // ⚠️ `verdict` IS NOT TOUCHED, and that is the r38 decision, not an
  // oversight: "keeping them apart holds three things true at once — a
  // correction is visible AS a correction, a re-run can never silently undo
  // one, and the model's accuracy stays measurable against the rows a person
  // actually checked." update(), never upsert(): a phrase with no verdict row
  // has never been judged, and inventing one here would fabricate the model
  // verdict this is supposed to be measuring.
  await prisma.droppedPhraseVerdict.update({
    where: { phrase },
    data: {
      humanVerdict,
      humanNote: humanNote === null || humanNote.trim() === '' ? null : humanNote.trim(),
      // Cleared together with the verdict, so an undo leaves no trace of a
      // score that is no longer there.
      humanAt: humanVerdict === null ? null : new Date(),
    },
  })

  revalidatePath('/review/phrases')
}
