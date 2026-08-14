import { dlopen, FFIType, ptr } from 'bun:ffi'

const platforms = {
    x64: { audit: 0xc000003e, blocked: [62, 129, 200, 234, 297, 424] },
    arm64: { audit: 0xc00000b7, blocked: [129, 138, 130, 131, 240, 424] },
} as const
const platform = platforms[process.arch as keyof typeof platforms]
if (!platform) throw new Error(`Unsupported tool sandbox architecture: ${process.arch}`)
const filter = new Uint8Array((platform.blocked.length * 2 + 5) * 8)
const view = new DataView(filter.buffer)
const instruction = (index: number, code: number, jt: number, jf: number, value: number) => {
    const offset = index * 8
    view.setUint16(offset, code, true)
    view.setUint8(offset + 2, jt)
    view.setUint8(offset + 3, jf)
    view.setUint32(offset + 4, value, true)
}

instruction(0, 0x20, 0, 0, 4)
instruction(1, 0x15, 1, 0, platform.audit)
instruction(2, 0x06, 0, 0, 0x80000000)
instruction(3, 0x20, 0, 0, 0)
platform.blocked.forEach((syscall, index) => {
    instruction(index * 2 + 4, 0x15, 0, 1, syscall)
    instruction(index * 2 + 5, 0x06, 0, 0, 0x00050001)
})
instruction(platform.blocked.length * 2 + 4, 0x06, 0, 0, 0x7fff0000)

const program = new Uint8Array(16)
const programView = new DataView(program.buffer)
programView.setUint16(0, platform.blocked.length * 2 + 5, true)
programView.setBigUint64(8, BigInt(ptr(filter)), true)
const libc = dlopen('libc.so.6', { prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 } })

const install = () => {
    if (libc.symbols.prctl(38, 1, 0, 0, 0) !== 0 || libc.symbols.prctl(22, 2, ptr(program), 0, 0) !== 0) throw new Error('Failed to install tool seccomp filter')
}

export default { install }
