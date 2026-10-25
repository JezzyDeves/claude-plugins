import type { Register } from 'claude-code'

const PANE = 'probe'
// What the last press's $.ui.scroll answered, per surface, drawn back into the pane.
const answers: Record<string, string> = {}

export const register: Register = on => {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Button
          key="jump"
          label="Jump"
          onPress={async press => {
            try {
              const r = await $.ui.scroll({ to: { requestId: 'msg-1' }, block: 'start' })
              answers[press.surface] = `answer: ${r.deny ?? 'moved'}`
            } catch (err) {
              answers[press.surface] = `rejected: ${String(err)}`
            }
            $.ui.invalidate('ui.render')
          }}
        />
        <Text>{answers[e.surface] ?? 'answer: none yet'}</Text>
      </Box>
    )
  })
}
