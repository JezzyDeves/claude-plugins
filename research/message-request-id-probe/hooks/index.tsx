import type { Register, EngineInterface } from 'claude-code'

// Logs, per module load, every main-conversation row the engine appends
// (its uuid) and every UserMessage / AssistantMessage render (its
// requestId), so the two can be joined. `/probe` dumps $.session.messages()
// and $.ui.selection(); `/probe scroll <id>` tries $.ui.scroll to that id.
const LOAD = `${Date.now()}`
const lines: string[] = []
let logPath = ''

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 60)

async function log($: EngineInterface, rec: Record<string, unknown>) {
  if (!logPath) {
    const dir = (await $.env.get('RID_PROBE_DIR')) ?? 'probe-out'
    logPath = `${dir}/load-${LOAD}.jsonl`
  }
  lines.push(JSON.stringify({ t: Date.now(), ...rec }))
  await $.fs.write(logPath, lines.join('\n') + '\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe', description: 'rid probe' })
    await log($, { ev: 'session.start', id: await $.session.id() })
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      const text = e.message.content
        .map(b => (b.type === 'text' ? b.text : `[${b.type}]`))
        .join('|')
      await log($, {
        ev: 'append', uuid: e.uuid, storedUuid: r.uuid, door: e.door,
        type: e.message.type, role: e.message.role, isMeta: e.message.isMeta,
        text: short(text),
      })
    }
    return r
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await log($, {
      ev: 'render', c: 'User', surface: e.surface, rid: e.requestId,
      origin: e.props.origin.kind, onScreen: e.props.onScreen, text: short(e.props.text),
    })
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await log($, {
      ev: 'render', c: 'Asst', surface: e.surface, rid: e.requestId,
      first: e.props.isFirstOfReply, summary: e.props.isSummary,
      onScreen: e.props.onScreen, text: short(e.props.text),
    })
    return next(e)
  })

  on('command.run', { command: 'probe' }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/)
    if (verb === 'scroll' && arg) {
      const res = await $.ui.scroll({ to: { requestId: arg }, block: 'start' })
      await log($, { ev: 'scroll', rid: arg, res })
      return { text: `scroll ${arg}: ${JSON.stringify(res)}` }
    }
    const msgs = await $.session.messages()
    await log($, {
      ev: 'messages', n: msgs.length,
      rows: msgs.map(m => ({
        role: m.role, text: short(m.text), tools: m.toolUses.length,
        results: m.toolResults?.length ?? 0, keys: Object.keys(m),
      })),
    })
    const sel = await $.ui.selection()
    await log($, { ev: 'selection', sel })
    return { text: `probe: ${msgs.length} messages logged` }
  })
}
