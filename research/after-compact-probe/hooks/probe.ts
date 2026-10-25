import type { Register } from 'claude-code'

// Throwaway probe for issue #12: appends JSON lines to <plugin root>/probe.log
// recording what a Mod sees around a compaction.
//   /probe-dump            logs $.session.messages() in both forms
//   /probe-scroll [id]     scrolls the transcript to `id`, or to every prompt/reply row seen
const cut = (s: unknown, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\s]+/g, ' ').slice(0, n)
const rows = (ms: readonly { role: string; text: string; handle?: string }[]) =>
  ms.map(m => `${m.role}${m.handle ? '#' : ''}:${cut(m.text, 40)}`)
const api = (ms: readonly { role: string; content: readonly { type: string; [k: string]: unknown }[] }[]) =>
  ms.map(m => `${m.role}:${m.content.map(b => (b.type === 'text' ? cut(b.text, 30) : b.type)).join('|')}`)

// One writer at a time: hooks run concurrently and $.fs.write replaces the file.
let queue: Promise<void> = Promise.resolve()
let lines = ''
function log($: any, tag: string, data: unknown) {
  lines += JSON.stringify({ t: Date.now(), tag, data }) + '\n'
  const text = lines
  queue = queue.then(() => $.fs.write(`${$.plugin.root}/probe.log`, text)).catch(() => {})
  return queue
}

async function snapshot($: any, tag: string) {
  const m = await $.session.messages()
  const a = await $.session.messages({ as: 'api' })
  await log($, tag, { rows: m.length, rowsList: rows(m), api: a.length, apiList: api(a), turns: await $.session.turns() })
}

export const register: Register = on => {
  const seen = new Map<string, string>() // transcript requestId -> "<component> <text>", first-render order
  const lastOnScreen = new Map<string, string>()
  let compactions = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe-dump', description: 'probe: log messages()' })
    await $.command.register({ name: 'probe-scroll', description: 'probe: scroll to rows', argumentHint: '[requestId]' })
    await log($, 'session.start', { id: await $.session.id() })
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    await log($, 'compact.in', { trigger: e.trigger, agentId: e.agentId, n: e.messages.length, list: rows(e.messages) })
    const r = await next(e)
    compactions++
    await log($, 'compact.out', r.skip !== undefined ? { skip: r.skip } : { n: r.messages.length, list: rows(r.messages), tokensBefore: r.tokensBefore, tokensAfter: r.tokensAfter })
    await snapshot($, 'compact.after-next')
    return r
  })

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.door !== 'attachment' && e.door !== 'hook-context')
      await log($, 'append', { door: e.door, uuid: e.uuid, type: e.message.type, name: e.message.name, role: e.message.role, isMeta: e.message.isMeta, text: cut(e.message.content?.map((b: any) => b.text ?? b.type).join('|'), 60) })
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await snapshot($, 'turn.complete')
    return r
  })

  on('classic.PostCompact', async ($, e, next) => { await log($, 'classic.PostCompact', { trigger: (e as any).trigger }); return next(e) })
  on('classic.SessionStart', async ($, e, next) => { await log($, 'classic.SessionStart', { source: (e as any).source }); return next(e) })

  on('ui.render', { component: ['UserMessage', 'AssistantMessage'] }, async ($, e, next) => {
    const key = `${compactions}:${e.requestId}`
    if (e.requestId !== 'placeholder' && !seen.has(e.requestId)) seen.set(e.requestId, `${e.component} ${cut(e.props.text, 40)}`)
    const shown = JSON.stringify(e.props.onScreen)
    if (lastOnScreen.get(key) !== shown) {
      lastOnScreen.set(key, shown)
      await log($, 'render', { afterCompactions: compactions, component: e.component, requestId: e.requestId, text: cut(e.props.text, 40), onScreen: e.props.onScreen, surface: e.surface })
    }
    return next(e)
  })

  on('command.run', { command: 'probe-dump' }, async ($) => {
    await snapshot($, 'probe-dump')
    return { text: `probe: dumped (${seen.size} rows seen)` }
  })
  on('command.run', { command: 'probe-scroll' }, async ($, e) => {
    const arg = e.args.trim()
    const targets = arg === 'first' ? [...seen.keys()].slice(0, 1) : arg ? [arg] : [...seen.keys()]
    const out: string[] = []
    for (const id of targets) {
      const r = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
      await log($, 'probe-scroll', { requestId: id, row: seen.get(id), result: r })
      out.push(`${id.slice(0, 8)} ${seen.get(id) ?? ''} -> ${r.deny ?? 'ok'}`)
    }
    return { text: out.join('\n') || 'nothing seen' }
  })
}
