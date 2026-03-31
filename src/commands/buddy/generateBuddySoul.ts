import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { queryHaiku } from '../../services/api/claude.js'
import type { CompanionBones } from '../../buddy/types.js'
import { extractTextContent } from '../../utils/messages.js'
import { safeParseJSON } from '../../utils/json.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

export type BuddySoul = {
  name: string
  personality: string
}

function summarizeStats(stats: CompanionBones['stats']): string {
  return Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => `${name}:${value}`)
    .join(', ')
}

export async function generateBuddySoul(
  bones: CompanionBones,
  signal: AbortSignal,
): Promise<BuddySoul | null> {
  const prompt = [
    `Species: ${bones.species}`,
    `Rarity: ${bones.rarity}`,
    `Hat: ${bones.hat}`,
    `Eye style: ${bones.eye}`,
    `Shiny: ${bones.shiny ? 'yes' : 'no'}`,
    `Stats: ${summarizeStats(bones.stats)}`,
  ].join('\n')

  const result = await queryHaiku({
    systemPrompt: asSystemPrompt([
      'You are naming a tiny terminal companion for a coding assistant.',
      'Return JSON with exactly two fields: "name" and "personality".',
      'Rules for "name": 1 to 3 short words, cute but not childish, easy to read in a terminal, no emojis.',
      'Rules for "personality": one single sentence under 90 characters, vivid and specific, describing how this companion feels beside a programmer.',
    ]),
    userPrompt: prompt,
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          personality: { type: 'string' },
        },
        required: ['name', 'personality'],
        additionalProperties: false,
      },
    },
    signal,
    options: {
      querySource: 'buddy_generate_soul',
      agents: [],
      isNonInteractiveSession: getIsNonInteractiveSession(),
      hasAppendSystemPrompt: false,
      mcpTools: [],
    },
  })

  const parsed = safeParseJSON(extractTextContent(result.message.content))
  if (!parsed || typeof parsed !== 'object') return null

  const name = 'name' in parsed ? parsed.name : undefined
  const personality = 'personality' in parsed ? parsed.personality : undefined

  if (typeof name !== 'string' || typeof personality !== 'string') {
    return null
  }

  const trimmedName = name.trim()
  const trimmedPersonality = personality.trim()
  if (!trimmedName || !trimmedPersonality) {
    return null
  }

  return {
    name: trimmedName,
    personality: trimmedPersonality,
  }
}
