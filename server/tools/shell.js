/* shell 输出边产生边发送，abort signal 直接停止子进程。 */
export default {
    name: 'shell',
    description: 'Run a shell command and return stdout and stderr.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            directory: { type: 'string' },
        },
        required: ['command'],

    },

    async execute({ command, directory }) {
    },
}
