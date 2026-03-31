import { renderFace, renderSprite } from '../../buddy/sprites.js'
import { RARITY_COLORS, RARITY_STARS, type Companion } from '../../buddy/types.js'

export function titleCase(value: string): string {
  return value[0]?.toUpperCase() + value.slice(1)
}

export function sortedStats(companion: Companion): Array<[string, number]> {
  return Object.entries(companion.stats).sort((a, b) => b[1] - a[1])
}

export function primaryStat(companion: Companion): string {
  return sortedStats(companion)[0]?.[0] ?? 'WISDOM'
}

export function secondaryStat(companion: Companion): string {
  return sortedStats(companion)[1]?.[0] ?? 'PATIENCE'
}

export function tagline(companion: Companion): string {
  const top = primaryStat(companion)
  const second = secondaryStat(companion)
  return `${titleCase(companion.species)} energy: ${top.toLowerCase()} first, ${second.toLowerCase()} second`
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(timestamp))
}

export function rarityLabel(companion: Companion): string {
  return `${RARITY_STARS[companion.rarity]} ${titleCase(companion.rarity)}`
}

export function statBar(value: number): string {
  const filled = Math.max(1, Math.round(value / 10))
  return `${'='.repeat(filled)}${'.'.repeat(10 - filled)}`
}

export function spriteBlock(companion: Companion): string {
  return renderSprite(companion, 0)
    .map(line => `  ${line}`)
    .join('\n')
}

export function rarityColor(companion: Companion) {
  return RARITY_COLORS[companion.rarity]
}

export function flavorLabel(companion: Companion): string {
  return companion.shiny ? 'Shiny aura active' : 'Standard aura'
}

export function formatCompanionCard(companion: Companion): string {
  const shiny = companion.shiny ? ' shiny' : ''
  const stats = sortedStats(companion)
    .map(
      ([name, value]) =>
        `${name.padEnd(10)} ${String(value).padStart(3)}  ${statBar(value)}`,
    )
    .join('\n')

  return [
    `${companion.name}  ${rarityLabel(companion)}${shiny}`,
    `${renderFace(companion)}  ${tagline(companion)}`,
    spriteBlock(companion),
    '',
    `${titleCase(companion.species)} with ${companion.eye} eyes and a ${companion.hat} hat`,
    `${flavorLabel(companion)}  |  Hatched ${formatDate(companion.hatchedAt)}  |  Accent ${rarityColor(companion)}`,
    companion.personality,
    '',
    stats,
  ].join('\n')
}
