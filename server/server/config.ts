import { Elysia, t } from 'elysia'
import Config from '../commands/config.ts'
import Plugin from '../features/plugin.ts'
import Store from '../store.ts'
import Error from '../utils/error.ts'
import Tool from '../utils/tool.ts'

const tools = async (sessionID: string) => {
    const session = Store.sessions[sessionID]
    const workspace = session && Store.workspaces[session.workspaceID]
    if (!workspace) throw Error.notFound('Session not found')
    return Tool.list(workspace.path, Plugin.tools())
}

export default new Elysia()
    .get('/config', () => Config.read())
    .patch('/config', ({ body }) => {
        if ('plugins' in body) throw Error.invalid('Update plugins through /plugin')
        return Config.save(body as any)
    }, { body: t.Record(t.String(), t.Unknown()) })
    .get('/tool', ({ query }) => tools(query.sessionID), { query: t.Object({ sessionID: t.String() }) })
    .get('/plugin', () => Plugin.list())
    .patch('/plugin', async ({ body }) => { await Plugin.setEnabled(body.name, body.enabled); return Plugin.list() }, {
        body: t.Object({ name: t.String(), enabled: t.Boolean() }),
    })
