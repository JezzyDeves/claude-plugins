import { expect, test } from 'claude-code/testing'

// Probe for research/desktop-transcript-scroll.md. Run: claude plugin test <this folder>
//
// What it shows: a pane Button press reaches the mod the same way on terminal
// and desktop, and the test kit has no engine beneath a plugin's own
// `$.ui.scroll` call (it rejects on every surface, and no test hook sees it).
// What it cannot show: what the real engine answers in a desktop-hosted session,
// or any surface's paint. The findings file reads that from the engine's code.

const PANE = {
  plugin: 'scroll-probe',
  component: 'Pane',
  requestId: 'probe',
  props: {
    title: 'Probe',
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a press on ${surface} reaches the mod, and its $.ui.scroll has nothing beneath it in the kit`, async ($, on) => {
    const seen: string[] = []
    on('*', (_$, e, next) => {
      if ('element' in e || 'to' in e) seen.push(JSON.stringify(e))
      return next(e)
    })
    on('ui.scroll', () => ({ value: { deny: 'answered by the test' } }))

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'jump' })
    const answer = await ui.find({ type: 'Text', text: /^(answer|rejected):/ })
    console.log(`[${surface}] seen ${seen.join(' | ')}; mod drew: ${answer?.text}`)

    expect(seen).toEqual([
      JSON.stringify({ plugin: 'scroll-probe', element: 'jump', component: 'Pane', requestId: 'probe', surface }),
    ])
    expect(answer?.text).toMatch(/^rejected: .*no implementation for ui\.scroll/)
    await ui.unmount()
  })
}

test("the test's own $.ui.scroll does reach a test hook (the event exists; a plugin's call skips it)", async ($, on) => {
  const asked: unknown[] = []
  on('ui.scroll', (_$, e) => {
    asked.push(e)
    return { value: { deny: 'answered by the test' } }
  })
  await $.ui.scroll({ to: { requestId: 'msg-1' } } as never)
  expect(asked).toEqual([{ to: { requestId: 'msg-1' } }])
})
