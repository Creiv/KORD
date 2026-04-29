import fs from "fs/promises"

const MAX_FULL_READ_BYTES = 8 * 1024 * 1024
const HEAD_READ_BYTES = 1024 * 1024
const TAIL_READ_BYTES = 256 * 1024

function finiteMs(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.round(seconds * 1000)
}

function readUInt64BE(buf, offset) {
  if (offset + 8 > buf.length) return null
  return Number(buf.readBigUInt64BE(offset))
}

function readUInt64LE(buf, offset) {
  if (offset + 8 > buf.length) return null
  return Number(buf.readBigUInt64LE(offset))
}

function syncsafe(buf, offset) {
  if (offset + 4 > buf.length) return 0
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  )
}

function parseFlacDuration(buf) {
  if (buf.length < 42 || buf.subarray(0, 4).toString("ascii") !== "fLaC") return null
  let offset = 4
  while (offset + 4 <= buf.length) {
    const header = buf[offset]
    const type = header & 0x7f
    const length = buf.readUIntBE(offset + 1, 3)
    const payload = offset + 4
    if (type === 0 && length >= 34 && payload + 34 <= buf.length) {
      const packed = buf.subarray(payload + 10, payload + 18)
      const bits = BigInt(`0x${packed.toString("hex")}`)
      const sampleRate = Number((bits >> 44n) & 0xfffffn)
      const totalSamples = Number(bits & 0xfffffffffn)
      if (sampleRate > 0 && totalSamples > 0) return finiteMs(totalSamples / sampleRate)
    }
    offset = payload + length
    if (header & 0x80) break
  }
  return null
}

function parseWavDuration(buf) {
  if (
    buf.length < 44 ||
    buf.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buf.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    return null
  }
  let offset = 12
  let byteRate = 0
  let dataBytes = 0
  while (offset + 8 <= buf.length) {
    const type = buf.subarray(offset, offset + 4).toString("ascii")
    const size = buf.readUInt32LE(offset + 4)
    const payload = offset + 8
    if (type === "fmt " && payload + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(payload + 8)
    } else if (type === "data") {
      dataBytes = size
      break
    }
    offset = payload + size + (size % 2)
  }
  if (byteRate > 0 && dataBytes > 0) return finiteMs(dataBytes / byteRate)
  return null
}

const MP3_BITRATES = {
  "1:1": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "1:2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1:3": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "2:1": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2:2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2:3": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
}

function mp3FrameInfo(buf, offset) {
  if (offset + 4 > buf.length) return null
  const h = buf.readUInt32BE(offset)
  if ((h & 0xffe00000) !== 0xffe00000) return null
  const versionBits = (h >> 19) & 0x3
  const layerBits = (h >> 17) & 0x3
  const bitrateIndex = (h >> 12) & 0xf
  const sampleRateIndex = (h >> 10) & 0x3
  const padding = (h >> 9) & 0x1
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null
  }
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5
  const layer = 4 - layerBits
  const versionGroup = version === 1 ? 1 : 2
  const bitrate = MP3_BITRATES[`${versionGroup}:${layer}`]?.[bitrateIndex]
  const sampleRates =
    version === 1 ? [44100, 48000, 32000] : version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000]
  const sampleRate = sampleRates[sampleRateIndex]
  if (!bitrate || !sampleRate) return null
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152
  const frameSize =
    layer === 1
      ? Math.floor((12 * bitrate * 1000) / sampleRate + padding) * 4
      : Math.floor(((layer === 3 && version !== 1 ? 72 : 144) * bitrate * 1000) / sampleRate + padding)
  if (frameSize <= 4) return null
  return { frameSize, samples, sampleRate, bitrateKbps: bitrate }
}

function parseMp3Duration(buf, fileSize = null) {
  let offset = 0
  if (buf.subarray(0, 3).toString("ascii") === "ID3") {
    offset = 10 + syncsafe(buf, 6)
  }
  if (fileSize && fileSize > buf.length) {
    for (let i = offset; i + 4 <= buf.length; i += 1) {
      const info = mp3FrameInfo(buf, i)
      if (!info?.bitrateKbps) continue
      return finiteMs(((fileSize - i) * 8) / (info.bitrateKbps * 1000))
    }
    return null
  }
  let totalSamples = 0
  let sampleRate = 0
  let frames = 0
  while (offset + 4 <= buf.length) {
    const info = mp3FrameInfo(buf, offset)
    if (!info) {
      offset += 1
      continue
    }
    totalSamples += info.samples
    sampleRate = info.sampleRate
    frames += 1
    offset += info.frameSize
  }
  if (frames > 0 && sampleRate > 0) return finiteMs(totalSamples / sampleRate)
  return null
}

async function readFileSample(filePath, size) {
  if (size <= MAX_FULL_READ_BYTES) return fs.readFile(filePath)
  const handle = await fs.open(filePath, "r")
  try {
    const headSize = Math.min(size, HEAD_READ_BYTES)
    const head = Buffer.alloc(headSize)
    await handle.read(head, 0, headSize, 0)
    const tailSize = Math.min(size - headSize, TAIL_READ_BYTES)
    if (tailSize <= 0) return head
    const tail = Buffer.alloc(tailSize)
    await handle.read(tail, 0, tailSize, size - tailSize)
    return Buffer.concat([head, tail])
  } finally {
    await handle.close()
  }
}

function parseMp4Mvhd(buf, offset, end) {
  if (offset + 20 > end) return null
  const version = buf[offset]
  if (version === 1) {
    if (offset + 32 > end) return null
    const timescale = buf.readUInt32BE(offset + 20)
    const duration = readUInt64BE(buf, offset + 24)
    if (timescale > 0 && duration) return finiteMs(duration / timescale)
  } else {
    if (offset + 20 > end) return null
    const timescale = buf.readUInt32BE(offset + 12)
    const duration = buf.readUInt32BE(offset + 16)
    if (timescale > 0 && duration > 0) return finiteMs(duration / timescale)
  }
  return null
}

function parseMp4Atoms(buf, start = 0, end = buf.length) {
  let offset = start
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset)
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii")
    let header = 8
    if (size === 1) {
      const large = readUInt64BE(buf, offset + 8)
      if (!large) return null
      size = large
      header = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) {
      offset += 1
      continue
    }
    const payload = offset + header
    const atomEnd = offset + size
    if (type === "mvhd") {
      const d = parseMp4Mvhd(buf, payload, atomEnd)
      if (d) return d
    }
    if (["moov", "trak", "mdia", "minf", "stbl", "edts"].includes(type)) {
      const d = parseMp4Atoms(buf, payload, atomEnd)
      if (d) return d
    }
    offset = atomEnd
  }
  return null
}

function readVintSize(buf, offset) {
  if (offset >= buf.length) return null
  const first = buf[offset]
  let mask = 0x80
  let length = 1
  while (length <= 8 && !(first & mask)) {
    mask >>= 1
    length += 1
  }
  if (length > 8 || offset + length > buf.length) return null
  let value = first & (mask - 1)
  for (let i = 1; i < length; i += 1) value = value * 256 + buf[offset + i]
  return { length, value }
}

function parseEbmlUnsigned(buf, offset, size) {
  if (size <= 0 || size > 6 || offset + size > buf.length) return null
  let value = 0
  for (let i = 0; i < size; i += 1) value = value * 256 + buf[offset + i]
  return value
}

function parseWebmDuration(buf) {
  let timecodeScale = 1000000
  const scaleId = Buffer.from([0x2a, 0xd7, 0xb1])
  const scaleAt = buf.indexOf(scaleId)
  if (scaleAt >= 0) {
    const size = readVintSize(buf, scaleAt + scaleId.length)
    if (size) {
      const v = parseEbmlUnsigned(buf, scaleAt + scaleId.length + size.length, size.value)
      if (v) timecodeScale = v
    }
  }
  const durationId = Buffer.from([0x44, 0x89])
  const durationAt = buf.indexOf(durationId)
  if (durationAt < 0) return null
  const size = readVintSize(buf, durationAt + durationId.length)
  if (!size) return null
  const payload = durationAt + durationId.length + size.length
  if (payload + size.value > buf.length) return null
  let duration = null
  if (size.value === 4) duration = buf.readFloatBE(payload)
  else if (size.value === 8) duration = buf.readDoubleBE(payload)
  if (!duration) return null
  return finiteMs((duration * timecodeScale) / 1000000000)
}

function parseOggOpusDuration(buf) {
  const head = buf.indexOf(Buffer.from("OpusHead", "ascii"))
  if (head < 0 || head + 12 > buf.length) return null
  const preSkip = buf.readUInt16LE(head + 10)
  let last = -1
  let search = 0
  const sig = Buffer.from("OggS", "ascii")
  while (true) {
    const i = buf.indexOf(sig, search)
    if (i < 0) break
    last = i
    search = i + 1
  }
  if (last < 0 || last + 14 > buf.length) return null
  const granule = readUInt64LE(buf, last + 6)
  if (!granule || granule <= preSkip) return null
  return finiteMs((granule - preSkip) / 48000)
}

export async function getAudioFileDurationMs(filePath) {
  let st
  try {
    st = await fs.stat(filePath)
  } catch {
    return null
  }
  if (!st.isFile() || st.size <= 0) return null
  let buf
  try {
    buf = await readFileSample(filePath, st.size)
  } catch {
    return null
  }
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".flac")) return parseFlacDuration(buf)
  if (lower.endsWith(".wav")) return parseWavDuration(buf)
  if (lower.endsWith(".mp3")) return parseMp3Duration(buf, st.size > buf.length ? st.size : null)
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4") || lower.endsWith(".aac")) return parseMp4Atoms(buf)
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return parseOggOpusDuration(buf)
  if (lower.endsWith(".webm")) return parseWebmDuration(buf)
  return parseMp4Atoms(buf) || parseOggOpusDuration(buf) || parseFlacDuration(buf) || parseWavDuration(buf) || parseMp3Duration(buf, st.size > buf.length ? st.size : null)
}
