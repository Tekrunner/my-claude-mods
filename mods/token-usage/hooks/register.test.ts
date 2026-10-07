import { test, expect } from 'claude-code/testing'

import { findTurn, summarize } from './register'

const usage = { input_tokens: 500, output_tokens: 1234, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }

test('formats counts and hit rate', () => {
  expect(summarize(usage)).toBe('in 500 · cache write 500 · cache read 9.0k · out 1.2k · hit 90%')
})

test('matches the block that ends a turn, newest turn first', () => {
  const a = { answer: 'First part.\n\nDone.', usage }
  const b = { answer: 'Done.', usage: { ...usage, output_tokens: 7 } }
  expect(findTurn([a], 'Done.')).toBe(a)
  expect(findTurn([a], 'First part.')).toBeUndefined()
  expect(findTurn([a, b], 'Done.')).toBe(b)
  expect(findTurn([a], '   ')).toBeUndefined()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws the token line under the answer on ${surface}`, async ($, on) => {
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['answer'] }) as never)
    await $.turn.complete({
      answer: 'All set.',
      durationMs: 10,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
      usage: { model: 'claude-opus-5-5', ...usage },
    })
    const ui = await $.ui.mount({
      plugin: 'token-usage',
      surface,
      component: 'AssistantMessage',
      props: { text: 'All set.', isFirstOfReply: true },
    } as never)
    expect(await ui.find({ text: /hit 90%/ })).toBeTruthy()

    const other = await $.ui.mount({
      plugin: 'token-usage',
      surface,
      component: 'AssistantMessage',
      props: { text: 'Something else.', isFirstOfReply: true },
    } as never)
    expect(await other.findAll({ text: /hit 90%/ })).toEqual([])
  })
}
