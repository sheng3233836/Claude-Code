import * as React from 'react'
import { Pane } from '../../components/design-system/Pane.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getCompanion } from '../../buddy/companion.js'
import { renderSprite } from '../../buddy/sprites.js'
import type { Companion } from '../../buddy/types.js'
import {
  flavorLabel,
  formatDate,
  primaryStat,
  rarityColor,
  rarityLabel,
  secondaryStat,
  sortedStats,
  statBar,
  tagline,
  titleCase,
} from './presentation.js'

type Props = {
  onDone: LocalJSXCommandOnDone
  companion?: Companion
  title?: string
  subtitle?: string
}

function Sparkline({ companion }: { companion: Companion }) {
  const color = companion.shiny ? 'autoAccept' : rarityColor(companion)
  const text = companion.shiny
    ? '✦  shimmering variant  ✦'
    : companion.rarity === 'legendary'
      ? 'legendary presence in terminal'
      : companion.rarity === 'epic'
        ? 'rare signal detected'
        : `${primaryStat(companion).toLowerCase()}-leaning companion`

  return (
    <Text color={color} bold>
      {text}
    </Text>
  )
}

function AuraLine({ companion }: { companion: Companion }) {
  const color = companion.shiny ? 'autoAccept' : rarityColor(companion)
  const text = companion.shiny
    ? 'A thin starfield follows every step.'
    : companion.rarity === 'legendary'
      ? 'Legendary aura: the terminal feels slightly more ceremonial.'
      : companion.rarity === 'epic'
        ? 'Epic aura: rare signal, steady glow.'
        : companion.rarity === 'rare'
          ? 'Rare aura: a light pulse hums around it.'
          : 'Common aura: soft and stable.'

  return <Text color={color}>{text}</Text>
}

function CompanionSpriteCard({ companion }: { companion: Companion }) {
  const color = rarityColor(companion)
  const sprite = renderCardSprite(companion)

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {sprite.map((line, index) => (
        <Text key={index} color={line.trim() ? color : undefined}>
          {line}
        </Text>
      ))}
    </Box>
  )
}

function renderCardSprite(companion: Companion): string[] {
  const base = getCompanionSprite(companion)
  if (companion.shiny) {
    return ['   ✦      ✦   ', ...base, '      ✦       ']
  }
  if (companion.rarity === 'legendary') {
    return ['   *  *  *    ', ...base]
  }
  if (companion.rarity === 'epic') {
    return ['    .  .      ', ...base]
  }
  if (companion.rarity === 'rare') {
    return ['     . .      ', ...base]
  }
  return base
}

function getCompanionSprite(companion: Companion): string[] {
  return renderSprite(companion, 0).map(line => `  ${line}`)
}

function EmptyBuddyCard({ onDone }: { onDone: LocalJSXCommandOnDone }) {
  useKeybinding('confirm:no', () =>
    onDone('Buddy card dismissed', { display: 'system' }), {
    context: 'Confirmation',
  })

  return (
    <Pane color="professionalBlue">
      <Box flexDirection="column" gap={1}>
        <Text bold color="claude">
          BUDDY
        </Text>
        <Text>Terminal companion mode is enabled.</Text>
        <Text dimColor>
          Run `/buddy hatch` to generate your companion. After hatching, use
          `/buddy pet`, `/buddy card`, `/buddy mute`, `/buddy unmute`, and
          `/buddy reset` or `/buddy reroll`.
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
      </Box>
    </Pane>
  )
}

export function BuddyCard({
  onDone,
  companion = getCompanion(),
  title,
  subtitle,
}: Props): React.ReactNode {
  useKeybinding('confirm:no', () =>
    onDone('Buddy card dismissed', { display: 'system' }), {
    context: 'Confirmation',
  })

  if (!companion) {
    return <EmptyBuddyCard onDone={onDone} />
  }

  const top = primaryStat(companion)
  const secondary = secondaryStat(companion)
  const color = rarityColor(companion)

  return (
    <Pane color={color}>
      <Box flexDirection="column">
        <Text bold color={color}>
          {title ?? companion.name}
        </Text>
        {subtitle ? (
          <Box marginTop={1}>
            <Text>{subtitle}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text>
            {rarityLabel(companion)}
            {companion.shiny ? '  shiny' : ''}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Sparkline companion={companion} />
        </Box>
        <Box marginTop={1}>
          <Text italic>{tagline(companion)}</Text>
        </Box>
        <Box marginTop={1}>
          <AuraLine companion={companion} />
        </Box>
        <CompanionSpriteCard companion={companion} />
        <Text>
          {titleCase(companion.species)} with {companion.eye} eyes and a{' '}
          {companion.hat} hat
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            {flavorLabel(companion)} | hatched {formatDate(companion.hatchedAt)}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>{companion.personality}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Stats</Text>
          {sortedStats(companion).map(([name, value]) => (
            <Text key={name}>
              {name.padEnd(10)} {String(value).padStart(3)} {statBar(value)}{' '}
              {name === top ? '<- top' : name === secondary ? '<- support' : ''}
            </Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Bonding</Text>
          <Text dimColor>
            `/buddy pet` makes it react in the footer with a short animation.
          </Text>
          <Text dimColor>
            `/buddy mute` hides it. `/buddy unmute` brings it back.
          </Text>
          <Text dimColor>
            `/buddy reset` releases it and lets you hatch again.
          </Text>
          <Text dimColor>
            `/buddy reroll` swaps it for a different companion immediately.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            Actions: `/buddy pet` `/buddy mute` `/buddy unmute` `/buddy reset` `/buddy reroll`
          </Text>
          <Text dimColor>Esc to cancel</Text>
        </Box>
      </Box>
    </Pane>
  )
}
