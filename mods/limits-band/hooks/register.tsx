import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'limits-band', key: 'limits' } as const, [] as Limit[])

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'Week', spend_limit: 'Spend' }
const ORDER = ['five_hour', 'seven_day', 'spend_limit']
const WIDTH = 12

const colorFor = (pct: number) => (pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green')

const bar = (pct: number) => {
  const filled = Math.round((Math.min(pct, 100) / 100) * WIDTH)
  return '█'.repeat(filled) + '░'.repeat(WIDTH - filled)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')

// Local wall-clock time of the reset: "14:30", "tomorrow 09:00" or "Fri 09:00".
export const resetsAtLabel = (at: Date, now: Date) => {
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000,
  )
  if (days <= 0) return time
  if (days === 1) return `tomorrow ${time}`
  return `${DAYS[at.getDay()]} ${time}`
}

export const resetsIn = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const at = Date.parse(resetsAt)
  const mins = Math.max(0, Math.round((at - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const delta = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  return `resets in ${delta} (${resetsAtLabel(new Date(at), new Date(now))})`
}

const sorted = (list: readonly Limit[]) =>
  [...list].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    if (usage.rateLimits.length > 0) await update($, limits, () => sorted(usage.rateLimits))
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limits, () => sorted(e.rateLimits))
    return next(e)
  })

  // session.measure only fires on whole-point moves; refresh the decimals after each turn too.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    if (usage.rateLimits.length > 0) await update($, limits, () => sorted(usage.rateLimits))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, limits)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={3}>
        {list.map(l => (
          <Text key={l.kind}>
            <Text bold>{LABELS[l.kind] ?? l.kind} </Text>
            <Text color={colorFor(l.percentUsed)}>{bar(l.percentUsed)}</Text>
            <Text> {Math.round(l.percentUsed)}% </Text>
            <Text dimColor>{resetsIn(l.resetsAt, now)}</Text>
          </Text>
        ))}
      </Box>
    )
  })
}
