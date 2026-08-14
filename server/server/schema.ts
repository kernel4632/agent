import { t } from 'elysia'

export const position = t.Object({ messageID: t.String(), partIndex: t.Integer({ minimum: 0 }) })
export const message = t.Object({
    id: t.String(), role: t.Union([t.Literal('user'), t.Literal('assistant'), t.Literal('system')]),
    parts: t.Array(t.Record(t.String(), t.Unknown())),
}, { additionalProperties: true })
