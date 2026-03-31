import { feature } from 'bun:bundle'
import * as React from 'react'
import type { ToolUseContext } from '../../Tool.js'
import { companionUserId, getCompanion, roll, rollWithSeed } from '../../buddy/companion.js'
import {
  type Companion,
  type Species,
} from '../../buddy/types.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { BuddyCard } from './BuddyCard.js'
import { generateBuddySoul } from './generateBuddySoul.js'
import {
  primaryStat,
  titleCase,
} from './presentation.js'

const HELP_TEXT = [
  'Usage: /buddy <hatch|card|pet|mute|unmute|reset|reroll>',
  '  hatch   Create your companion if you do not have one yet',
  '  card    Open the companion card UI',
  '  pet     Pet your companion and trigger the animation',
  '  mute    Hide reactions and companion UI',
  '  unmute  Show reactions and companion UI again',
  '  reset   Release your current companion and allow rehatching',
  '  reroll  Generate a different companion immediately',
].join('\n')

const NAME_PREFIXES = [
  'Byte',
  'Mochi',
  'Pebble',
  'Comet',
  'Pico',
  'Nori',
  'Biscuit',
  'Nova',
  'Puddle',
  'Sprocket',
] as const

const NAME_SUFFIXES = [
  'loop',
  'bean',
  'spark',
  'patch',
  'whisk',
  'dot',
  'wink',
  'zip',
  'moss',
  'gleam',
] as const

const PET_REACTIONS = [
  'leans into the attention',
  'does a delighted little wiggle',
  'looks extremely pleased with itself',
  'settles down with a smug expression',
  'makes a tiny happy noise',
] as const

const SPECIES_ACTIONS: Record<Species, readonly string[]> = {
  duck: ['flaps in a tight little circle', 'tilts its beak up like it solved the bug'],
  goose: ['stands taller with theatrical pride', 'lets out a very self-important honk'],
  blob: ['jiggles happily in place', 'briefly becomes almost perfectly round'],
  cat: ['arches into your hand', 'blinks like it is pretending not to enjoy this'],
  dragon: ['puffs out a proud ribbon of imaginary smoke', 'coils up with smug dignity'],
  octopus: ['waves several delighted arms at once', 'arranges its limbs into a pleased little fan'],
  owl: ['rotates its head with wise approval', 'puffs up its feathers and watches you closely'],
  penguin: ['does a proud side-to-side shuffle', 'straightens up like a tiny executive'],
  turtle: ['extends its head a little farther from the shell', 'settles into a calm, satisfied stance'],
  snail: ['raises its eyestalks with serene gratitude', 'slides in a tiny celebratory arc'],
  ghost: ['wobbles through the air with visible delight', 'glows faintly around the edges'],
  axolotl: ['fans its frills in a happy flutter', 'floats with an absurdly content expression'],
  capybara: ['radiates perfect capybara composure', 'looks calmer than the rest of the terminal'],
  cactus: ['somehow looks softer for a second', 'stands there, pleased in a prickly way'],
  robot: ['emits a tiny affirmative whirr', 'flashes a content little status pattern'],
  rabbit: ['thumps once and relaxes', 'flicks its ears and scoots closer'],
  mushroom: ['bobs gently like a tiny lantern', 'looks mysteriously delighted'],
  chonk: ['settles down with maximum gravity', 'vibrates with a low, satisfied purr'],
}

const TOP_STAT_REACTIONS: Record<string, readonly string[]> = {
  DEBUGGING: ['like it just found the exact failing line', 'with the confidence of a creature that debugs for sport'],
  PATIENCE: ['with deep and patient calm', 'like it could wait through any rebuild'],
  CHAOS: ['with suspiciously chaotic delight', 'like it is one nudge away from a glorious side quest'],
  WISDOM: ['with ancient little-creature wisdom', 'as if it understands the whole repo already'],
  SNARK: ['with a devastatingly smug look', 'like it has opinions about your last shortcut'],
}

function indexFromSeed(seed: number, length: number, salt: number): number {
  return Math.abs((seed ^ salt) % length)
}

function buildPersonality(companion: Companion, seed: number): string {
  const topStat = primaryStat(companion)
  const tonesByStat: Record<string, readonly string[]> = {
    DEBUGGING: [
      'sniffs out bugs before they hatch',
      'watches your stack traces like a hawk',
    ],
    PATIENCE: [
      'waits calmly through long builds',
      'keeps a steady vibe during slow refactors',
    ],
    CHAOS: [
      'encourages bold experiments at suspicious hours',
      'loves a little harmless terminal chaos',
    ],
    WISDOM: [
      'acts like an old soul in a tiny sprite body',
      'responds to messes with unnerving calm',
    ],
    SNARK: [
      'judges flaky scripts with surgical precision',
      'has a sharp tongue for questionable shortcuts',
    ],
  }
  const tones = tonesByStat[topStat] ?? tonesByStat.WISDOM
  return tones[indexFromSeed(seed, tones.length, 0x51)]
}

function buildName(species: Species, seed: number): string {
  const prefix = NAME_PREFIXES[indexFromSeed(seed, NAME_PREFIXES.length, 0x1f)]
  const suffix = NAME_SUFFIXES[indexFromSeed(seed, NAME_SUFFIXES.length, 0x2f)]
  const speciesHint = titleCase(species).slice(0, 2)
  return `${prefix}${speciesHint}${suffix}`
}

function ensureBuddyEnabled(onDone: LocalJSXCommandOnDone): boolean {
  if (feature('BUDDY')) return true
  onDone('BUDDY is not enabled. Launch with `bun --feature=BUDDY run ./src/entrypoints/cli.tsx`.', {
    display: 'system',
  })
  return false
}

function createRerollSeed(): string {
  return `reroll-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function hatchCompanion(
  signal: AbortSignal,
  storedSeed?: string,
): Promise<Companion> {
  const userId = companionUserId()
  const { bones, inspirationSeed } = storedSeed
    ? rollWithSeed(`${userId}:${storedSeed}`)
    : roll(userId)
  let soul = null

  try {
    soul = await generateBuddySoul(bones, signal)
  } catch (error) {
    logForDebugging(`generateBuddySoul failed: ${errorMessage(error)}`, {
      level: 'error',
    })
  }

  const name = soul?.name ?? buildName(bones.species, inspirationSeed)
  const fallbackCompanion: Companion = {
    ...bones,
    name,
    personality: buildPersonality(
      { ...bones, name, personality: '', hatchedAt: Date.now() },
      inspirationSeed,
    ),
    hatchedAt: Date.now(),
  }

  const companion: Companion = {
    ...fallbackCompanion,
    name: soul?.name ?? fallbackCompanion.name,
    personality: soul?.personality ?? fallbackCompanion.personality,
  }

  saveGlobalConfig(current => ({
    ...current,
    companion: {
      name: companion.name,
      personality: companion.personality,
      hatchedAt: companion.hatchedAt,
      seed: storedSeed,
    },
    companionMuted: false,
  }))

  return companion
}

function petReaction(companion: Companion): string {
  const seed = roll(companionUserId()).inspirationSeed
  const speciesAction =
    SPECIES_ACTIONS[companion.species][
      indexFromSeed(seed, SPECIES_ACTIONS[companion.species].length, 0x61)
    ] ?? 'looks pleased'
  const topStat = primaryStat(companion)
  const statFlavor =
    TOP_STAT_REACTIONS[topStat]?.[
      indexFromSeed(seed, TOP_STAT_REACTIONS[topStat].length, 0x71)
    ] ?? PET_REACTIONS[indexFromSeed(seed, PET_REACTIONS.length, 0x77)]
  const shinyTag = companion.shiny ? ' A faint shimmer trails behind it.' : ''
  return `${companion.name} ${speciesAction}, ${statFlavor}.${shinyTag}`
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
) : Promise<React.ReactNode | null> {
  if (!ensureBuddyEnabled(onDone)) return null

  const subcommand = args.trim().toLowerCase()

  if (!subcommand) {
    return <BuddyCard onDone={onDone} />
  }

  if (subcommand === 'hatch') {
    const existing = getCompanion()
    if (existing) {
      return (
        <BuddyCard
          onDone={onDone}
          companion={existing}
          title={existing.name}
          subtitle={`${existing.name} is already with you.`}
        />
      )
    }

    const companion = await hatchCompanion(context.abortController.signal)
    return (
      <BuddyCard
        onDone={onDone}
        companion={companion}
        title={`${companion.name} hatched`}
        subtitle="Your terminal companion just arrived."
      />
    )
  }

  const companion = getCompanion()
  if (!companion) {
    return <BuddyCard onDone={onDone} />
  }

  if (subcommand === 'card') {
    return <BuddyCard onDone={onDone} companion={companion} />
  }

  if (subcommand === 'pet') {
    const reaction = petReaction(companion)
    context.setAppState(prev => ({
      ...prev,
      companionPetAt: Date.now(),
      companionReaction: reaction,
    }))
    onDone(reaction, { display: 'system' })
    return null
  }

  if (subcommand === 'mute') {
    if (getGlobalConfig().companionMuted) {
      onDone(`${companion.name} is already muted.`, { display: 'system' })
      return null
    }
    saveGlobalConfig(current => ({
      ...current,
      companionMuted: true,
    }))
    context.setAppState(prev => ({
      ...prev,
      companionReaction: undefined,
    }))
    onDone(`${companion.name} is now muted.`, { display: 'system' })
    return null
  }

  if (subcommand === 'unmute') {
    if (!getGlobalConfig().companionMuted) {
      onDone(`${companion.name} is already unmuted.`, { display: 'system' })
      return null
    }
    saveGlobalConfig(current => ({
      ...current,
      companionMuted: false,
    }))
    onDone(`${companion.name} is visible again.`, { display: 'system' })
    return null
  }

  if (subcommand === 'reset') {
    const releasedName = companion.name
    saveGlobalConfig(current => ({
      ...current,
      companion: undefined,
      companionMuted: false,
    }))
    context.setAppState(prev => ({
      ...prev,
      companionPetAt: undefined,
      companionReaction: undefined,
    }))
    onDone(
      `${releasedName} has been released. Run \`/buddy hatch\` to adopt a new companion.`,
      { display: 'system' },
    )
    return null
  }

  if (subcommand === 'reroll') {
    const nextSeed = createRerollSeed()
    const rerolled = await hatchCompanion(context.abortController.signal, nextSeed)
    context.setAppState(prev => ({
      ...prev,
      companionPetAt: undefined,
      companionReaction: undefined,
    }))
    return (
      <BuddyCard
        onDone={onDone}
        companion={rerolled}
        title={`${rerolled.name} rerolled`}
        subtitle="A different terminal companion has taken over the perch."
      />
    )
  }

  onDone(`Unknown /buddy action: ${subcommand}\n\n${HELP_TEXT}`, {
    display: 'system',
  })
  return null
}
