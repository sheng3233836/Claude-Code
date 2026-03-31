import type { Command } from '../../commands.js'

const buddy = {
  type: 'local-jsx',
  name: 'buddy',
  description: 'Hatch and interact with your terminal companion',
  argumentHint: '[hatch|card|pet|mute|unmute|reset|reroll]',
  whenToUse:
    'Use this command when you want to hatch, inspect, pet, mute, unmute, reset, or reroll the BUDDY terminal companion.',
  immediate: true,
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
