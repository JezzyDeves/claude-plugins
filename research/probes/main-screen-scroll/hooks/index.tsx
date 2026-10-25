import type { Register, EngineInterface } from 'claude-code'

// Probe for #16: what $.ui.scroll({ to: { requestId } }) answers from a pane
// Button press (and from a typed command) on the terminal, fullscreen or not,
// and what the mod can read about the mode first.
//
// `/jump` logs command.run's presentation and opens a focused pane. In the
// pane, hotkey `f` scrolls to the first prompt and `l` to the last prompt.
// `/jump scroll first|last` does the same from the typed command.
// Everything is logged as JSON lines to $JUMP_PROBE_DIR/log.jsonl.
const PANE = 'jumpprobe'
const prompts: string[] = []
const lines: string[] = []
let answer = 'none yet'
let logPath = ''

async function log($: EngineInterface, rec: Record<string, unknown>) {
  if (!logPath) logPath = `${(await $.env.get('JUMP_PROBE_DIR')) ?? 'probe-out'}/log.jsonl`
  lines.push(JSON.stringify({ t: Date.now(), ...rec }))
  await $.fs.write(logPath, lines.join('\n') + '\n')
}

const target = (which: string) => (which === 'first' ? prompts[0] : prompts[prompts.length - 1])

async function jump($: EngineInterface, which: string, via: string) {
  const id = target(which)
  if (!id) {
    answer = `${via} ${which}: no prompt yet`
    await log($, { ev: 'scroll', via, which, res: 'no prompt yet' })
    return answer
  }
  try {
    const res = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
    answer = `${via} ${which}: ${JSON.stringify(res)}`
    await log($, { ev: 'scroll', via, which, id, res })
  } catch (err) {
    answer = `${via} ${which}: rejected ${String(err)}`
    await log($, { ev: 'scroll', via, which, id, rejected: String(err) })
  }
  return answer
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'jump', description: 'jump probe' })
    await log($, { ev: 'session.start', surfaces: await $.session.surfaces() })
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.door === 'prompt' && e.message.role === 'user') {
      prompts.push(r.uuid ?? e.uuid)
      await log($, { ev: 'append', uuid: r.uuid ?? e.uuid })
    }
    return r
  })

  on('command.run', { command: 'jump' }, async ($, e) => {
    await log($, { ev: 'command.run', args: e.args, presentation: e.presentation, origin: e.origin })
    const [verb, which] = e.args.trim().split(/\s+/)
    if (verb === 'scroll') return { text: await jump($, which ?? 'first', 'command') }
    const opened = await $.ui.open({ id: PANE, title: 'Jump probe', focus: true, closeOnEscape: true })
    await log($, { ev: 'open', opened })
    return { text: `jump probe: pane ${JSON.stringify(opened)}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await log($, { ev: 'render', surface: e.surface, viewport: e.viewport, placement: e.props.placement })
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Button
          key="first"
          hotkey="f"
          label="first prompt"
          onPress={async press => {
            await log($, { ev: 'press', element: press.element, surface: press.surface })
            await jump($, 'first', 'press')
            $.ui.invalidate('ui.render')
          }}
        />
        <Button
          key="last"
          hotkey="l"
          label="last prompt"
          onPress={async press => {
            await log($, { ev: 'press', element: press.element, surface: press.surface })
            await jump($, 'last', 'press')
            $.ui.invalidate('ui.render')
          }}
        />
        <Text>{`answer: ${answer}`}</Text>
        <Text>{`isFullscreen: ${String(e.viewport?.isFullscreen)}`}</Text>
      </Box>
    )
  })
}
