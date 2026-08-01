import * as assert from 'node:assert/strict'
import { extractCommand, replaceBinary, type FileOps } from '../../src/binary/install'

/** In-memory file system that records every operation in order. */
function memoryOps(initial: string[] = []): FileOps & { files: Set<string>; log: string[] } {
  const files = new Set(initial)
  const log: string[] = []
  return {
    files,
    log,
    exists: (p) => files.has(p),
    rename(from, to) {
      log.push(`rename ${from} ${to}`)
      if (!files.has(from)) {
        throw new Error(`ENOENT ${from}`)
      }
      files.delete(from)
      files.add(to)
    },
    write(p) {
      log.push(`write ${p}`)
      files.add(p)
    },
    remove(p) {
      log.push(`remove ${p}`)
      files.delete(p)
    },
    chmod(p, mode) {
      log.push(`chmod ${p} ${mode.toString(8)}`)
    },
    mkdirp(p) {
      log.push(`mkdirp ${p}`)
    },
  }
}

const DATA = new Uint8Array([1, 2, 3])

describe('extractCommand', () => {
  it('uses tar for both archive formats', () => {
    assert.deepEqual(extractCommand('/tmp/a.tar.gz', '/out'), {
      command: 'tar',
      args: ['-xzf', '/tmp/a.tar.gz', '-C', '/out'],
    })
    assert.deepEqual(extractCommand('C:/tmp/a.zip', 'C:/out'), {
      command: 'tar',
      args: ['-xf', 'C:/tmp/a.zip', '-C', 'C:/out'],
    })
  })

  it('rejects an unknown archive format rather than guessing', () => {
    assert.throws(() => extractCommand('/tmp/a.rar', '/out'), /unsupported archive/i)
  })
})

describe('replaceBinary', () => {
  // Staged beside the target and renamed onto it: the destination is on PATH,
  // so a direct write would truncate the live binary and would follow a
  // symlink planted at that name.
  it('stages the download and renames it onto the target', () => {
    const ops = memoryOps()
    replaceBinary('/bin/cmm', DATA, 'linux', ops)
    assert.ok(ops.files.has('/bin/cmm'))
    assert.ok(!ops.files.has('/bin/cmm.new'))
    assert.ok(ops.log.includes('write /bin/cmm.new'))
    assert.ok(ops.log.includes('rename /bin/cmm.new /bin/cmm'))
    assert.ok(!ops.log.includes('write /bin/cmm'))
  })

  it('makes the binary executable on unix', () => {
    const ops = memoryOps()
    replaceBinary('/bin/cmm', DATA, 'linux', ops)
    // On the staged file, before it takes the live name: the mode travels
    // with the rename, and chmod on a live path would follow a symlink.
    assert.ok(ops.log.includes('chmod /bin/cmm.new 755'))
    assert.ok(!ops.log.includes('chmod /bin/cmm 755'))
  })

  it('does not chmod on Windows', () => {
    const ops = memoryOps()
    replaceBinary('C:/bin/cmm.exe', DATA, 'win32', ops)
    assert.ok(!ops.log.some((l) => l.startsWith('chmod')))
  })

  it('renames the running executable aside on Windows before writing', () => {
    const ops = memoryOps(['C:/bin/cmm.exe'])
    replaceBinary('C:/bin/cmm.exe', DATA, 'win32', ops)
    assert.deepEqual(ops.log, [
      'mkdirp C:/bin',
      'remove C:/bin/cmm.exe.new',
      'write C:/bin/cmm.exe.new',
      'rename C:/bin/cmm.exe C:/bin/cmm.exe.old',
      'rename C:/bin/cmm.exe.new C:/bin/cmm.exe',
      'remove C:/bin/cmm.exe.old',
    ])
  })

  // A symlink at the target would have had the release bytes written through
  // it and its target marked executable. A rename replaces the name itself.
  it('never writes to the live target path directly', () => {
    for (const [target, platform] of [
      ['/bin/cmm', 'linux'],
      ['C:/bin/cmm.exe', 'win32'],
    ] as const) {
      const ops = memoryOps([target])
      replaceBinary(target, DATA, platform, ops)
      assert.ok(!ops.log.includes(`write ${target}`), `${platform} wrote to the live path`)
      assert.ok(!ops.log.includes(`chmod ${target} 755`), `${platform} chmodded the live path`)
    }
  })

  it('restores the old executable when the write fails', () => {
    const ops = memoryOps(['C:/bin/cmm.exe'])
    const failing: FileOps = {
      ...ops,
      write() {
        throw new Error('EBUSY')
      },
    }
    assert.throws(() => replaceBinary('C:/bin/cmm.exe', DATA, 'win32', failing), /EBUSY/)
    assert.ok(ops.files.has('C:/bin/cmm.exe'), 'the old binary must be back in place')
    assert.ok(!ops.files.has('C:/bin/cmm.exe.old'))
  })

  // The failure now happens on the rename that puts the staged file in place,
  // which is the step that can hit a running executable.
  it('preserves the original failure as the cause when the rollback also fails', () => {
    const ops = memoryOps(['C:/bin/cmm.exe'])
    const writeFails = new Error('EBUSY')
    const doublyFailing: FileOps = {
      ...ops,
      rename(from, to) {
        if (from === 'C:/bin/cmm.exe.new') {
          throw writeFails
        }
        if (from === 'C:/bin/cmm.exe.old') {
          throw new Error('EPERM cannot restore')
        }
        ops.rename(from, to)
      },
    }
    assert.throws(
      () => replaceBinary('C:/bin/cmm.exe', DATA, 'win32', doublyFailing),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.equal(err.cause, writeFails)
        assert.match(err.message, /C:\/bin\/cmm\.exe\.old/)
        return true
      },
    )
  })

  it('clears a leftover .old file from an earlier interrupted update', () => {
    const ops = memoryOps(['C:/bin/cmm.exe', 'C:/bin/cmm.exe.old'])
    replaceBinary('C:/bin/cmm.exe', DATA, 'win32', ops)
    assert.ok(ops.log.includes('remove C:/bin/cmm.exe.old'))
    assert.ok(!ops.files.has('C:/bin/cmm.exe.old'))
  })

  it('tolerates a locked .old file, since the removal is best effort', () => {
    const ops = memoryOps(['C:/bin/cmm.exe'])
    const lockedRemove: FileOps = {
      ...ops,
      remove(p) {
        throw new Error(`EBUSY ${p}`)
      },
    }
    assert.doesNotThrow(() => replaceBinary('C:/bin/cmm.exe', DATA, 'win32', lockedRemove))
    assert.ok(ops.files.has('C:/bin/cmm.exe'))
  })
})
