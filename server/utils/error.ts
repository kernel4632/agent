class HTTPError extends Error {
    constructor(public status: 404 | 409 | 422, public code: string, message: string) {
        super(message)
    }
}

const notFound = (message: string) => new HTTPError(404, 'NOT_FOUND', message)
const conflict = (message: string) => new HTTPError(409, 'CONFLICT', message)
const invalid = (message: string) => new HTTPError(422, 'INVALID_INPUT', message)

export { HTTPError }
export default { notFound, conflict, invalid }
