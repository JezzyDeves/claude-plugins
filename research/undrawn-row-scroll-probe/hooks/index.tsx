import type { Register, EngineInterface } from 'claude-code'

// Probe for #19: can $.ui.scroll reach a transcript row the terminal has
// stopped mounting? Logs, per module load, to $URS_PROBE_DIR/load-<ts>.jsonl:
// main-conversation prompt/response appends (uuid), every UserMessage /
// AssistantMessage render (requestId, onScreen), and each scroll answer.
//   /probe first      scroll to the first prompt this load saw
//   /probe last       scroll to the newest prompt
//   /probe bogus      scroll to a uuid that was never stored
//   /probe scroll <id>
const LOAD = `${Date.now()}`
const lines: string[] = []
let logPath = ''
const prompts: string[] = []

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 50)

async function log($: EngineInterface, rec: Record<string, unknown>) {
  if (!logPath) {
    const dir = (await $.env.get('URS_PROBE_DIR')) ?? 'probe-out'
    logPath = `${dir}/load-${LOAD}.jsonl`
  }
  lines.push(JSON.stringify({ t: Date.now(), ...rec }))
  await $.fs.write(logPath, lines.join('\n') + '\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe', description: 'undrawn-row scroll probe' })
    await log($, { ev: 'session.start', id: await $.session.id() })
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && (e.door === 'prompt' || e.door === 'response')) {
      const text = e.message.content
        .map(b => (b.type === 'text' ? b.text : `[${b.type}]`))
        .join('|')
      if (e.door === 'prompt' && !e.message.isMeta) prompts.push(r.uuid ?? e.uuid)
      await log($, { ev: 'append', uuid: r.uuid ?? e.uuid, door: e.door, text: short(text) })
    }
    return r
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (prompts.includes(e.requestId)) {
      await log($, { ev: 'render', c: 'User', rid: e.requestId, onScreen: e.props.onScreen })
    }
    return next(e)
  })

  on('command.run', { command: 'probe' }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/)
    const target =
      verb === 'first' ? prompts[0]
      : verb === 'last' ? prompts.at(-1)
      : verb === 'bogus' ? '00000000-0000-4000-8000-000000000000'
      : verb === 'scroll' ? arg
      : undefined
    const fullscreen = e.presentation.isFullscreen
    if (!target) {
      const n = (await $.session.messages()).length
      await log($, { ev: 'status', fullscreen, prompts: prompts.length, messages: n })
      return { text: `probe: fullscreen=${fullscreen} prompts=${prompts.length} messages=${n}` }
    }
    const t0 = Date.now()
    const res = await $.ui.scroll({ to: { requestId: target }, block: 'start' })
    await log($, { ev: 'scroll', verb, rid: target, res, ms: Date.now() - t0, fullscreen })
    return { text: `probe ${verb}: ${JSON.stringify(res)} (${Date.now() - t0}ms, fullscreen=${fullscreen})` }
  })
}
