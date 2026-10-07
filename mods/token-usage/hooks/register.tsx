import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TurnRecord, Usage } from '../types'

const MAX_TURNS = 200

const turns = atom({ plugin: 'token-usage', key: 'turns' } as const, [] as TurnRecord[])

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`

export const hitRate = (u: Usage) => {
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return prompt === 0 ? 0 : Math.round((u.cache_read_input_tokens / prompt) * 100)
}

export const hitColor = (pct: number) => (pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red')

export const summarize =(u: Usage) =>
  `in ${fmt(u.input_tokens)} · cache write ${fmt(u.cache_creation_input_tokens)} · ` +
  `cache read ${fmt(u.cache_read_input_tokens)} · out ${fmt(u.output_tokens)} · hit ${hitRate(u)}%`

// The answer is the turn's final text; the block that closes it is the one whose text ends it.
// Newest first, so a block repeated across turns gets the latest turn's line.
export const findTurn = (list: readonly TurnRecord[], text: string) => {
  const block = text.trim()
  if (block === '') return undefined
  return list.findLast(t => t.answer.trim().endsWith(block))
}

export const register: Register = on => {
  // Clear the status entry an earlier version of this mod left behind.
  on('session.start', ($, e, next) => {
    $.ui.status(undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // Main loop only: subagent turns are folded into the parent's usage anyway.
    if (e.agentId !== undefined || e.usage === undefined || e.answer.trim() === '') return r

    const { model: _model, ...usage } = e.usage
    await update($, turns, list => [...list, { answer: e.answer, usage }].slice(-MAX_TURNS))
    return r
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const turn = findTurn(await read($, turns), e.props.text)
    if (turn === undefined) return drawn

    const { Box, Text } = $.ui.resolve(e)
    const u = turn.usage
    const hit = hitRate(u)
    const counts = [
      ['in', u.input_tokens],
      ['cache write', u.cache_creation_input_tokens],
      ['cache read', u.cache_read_input_tokens],
      ['out', u.output_tokens],
    ] as const

    // Dim labels, plain numbers; only the hit rate gets a color.
    return (
      <Box flexDirection="column">
        {drawn}
        {/* Desktop: a bit more air than one line, and nudged right to line up with the reply's text. */}
        <Box
          marginTop={e.surface === 'desktop' ? 1.5 : 1}
          marginLeft={e.surface === 'desktop' ? 0.5 : 0}
        >
          <Text>
            {counts.map(([label, n]) => (
              <Text key={label}>
                <Text dimColor>{label} </Text>
                <Text>{fmt(n)}</Text>
                <Text dimColor> · </Text>
              </Text>
            ))}
            <Text dimColor>hit </Text>
            <Text color={hitColor(hit)}>{hit}%</Text>
          </Text>
        </Box>
      </Box>
    )
  })
}
