#!/usr/bin/env node

const fsevents = require('fsevents')
const { resolve: resolvePath } = require('path')
const { spawn, execSync } = require('child_process')

const TMPDIR = `/tmp/${+new Date()}`
execSync(`mkdir -p ${TMPDIR}`)

const PATH = resolvePath(process.argv[2])
const SOCKET = '/dev/tty.usbserial-0001'
const LOGFILE = `/${TMPDIR}/screenlog.0`

if (!PATH) {
  console.error('Usage: arduino-build <path>')
  process.exit(1)
}

let tailProc = null
let building = false

process.on('unhandledRejection', (err) => {
  console.error(err)

  if (err?.output) {
    console.error(err.output.map(o => o?.toString()).join('\n'))
  }

  process.exit(1)
})

const build = path => new Promise((resolve, reject) => {
  console.log(`Building ${resolvePath(path)}`)

  const build = spawn('arduino-cli', ['compile', '--fqbn', 'esp32:esp32:nodemcu-32s', path])

  build.stdout.on('data', data => {
    process.stdout.write(data.toString())
  })

  build.stderr.on('data', data => {
    process.stderr.write(data.toString())
  })

  build.on('exit', code => {
    if (code === 0) {
      resolve()
    } else {
      reject()
    }
  })
})

const upload = (path, socket) => new Promise((resolve, reject) => {
  console.log(`Uploading ${path} to ${socket}`)

  const upload = spawn('arduino-cli', ['upload', '-p', socket, '--fqbn', 'esp32:esp32:nodemcu-32s', path])

  upload.stdout.on('data', data => {
    process.stdout.write(data.toString())
  })

  upload.stderr.on('data', data => {
    process.stderr.write(data.toString())
  })

  upload.on('exit', code => {
    if (code === 0) {
      resolve()
    } else {
      reject()
    }
  })
})

const createScreen = socket => {
  console.log(`Monitoring serial interface ${socket}`)

  execSync(`rm -rf ${LOGFILE}`)
  execSync(`touch ${LOGFILE}`)
  execSync(`screen -L -dmS arduino-logs ${socket} 9600`, { cwd: TMPDIR })
  execSync('screen -r arduino-logs -p0 -X logfile flush 0')

  const tail = spawn('tail', ['-f', LOGFILE])

  tail.stdout.on('data', data => {
    process.stdout.write(data.toString())
  })

  return tail
}

const killScreen = () => {
  let output

  try {
    output = execSync('screen -ls').toString()
  } catch (e) {
    // Do nothing
  }

  const line = output?.split(/\n/).find(l => l.match(/arduino-logs/))

  if (line) {
    const number = line.split(/\./)[0].trim()

    if (number) {
      execSync(`screen -XS ${number} quit`)
    }
  }
}

const exec = async (isReload = false) => {
  if (building) {
    return
  }

  building = true

  if (isReload) {
    console.log('Reloading...')
  }

  // Kill existing screen
  killScreen()

  if (tailProc) {
    tailProc.kill('SIGINT')
  }

  // Build
  await build(PATH)
  await upload(PATH, SOCKET)

  building = false

  // Create new screen
  tailProc = createScreen(SOCKET)
}

const stop = fsevents.watch(PATH, () => {
  exec(true)
})

exec()

process.on('SIGINT', () => {
  stop()
  killScreen()

  if (tailProc) {
    tailProc.kill('SIGINT')
  }

  execSync(`rm -rf ${TMPDIR}`)

  process.exit()
})
