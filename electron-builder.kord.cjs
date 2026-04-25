/* eslint-disable @typescript-eslint/no-require-imports */
const pkg = require("./package.json")
const b = pkg.build || {}

const flavor = process.env.KORD_PACK_FLAVOR || "server"
const ver = process.env.KORD_APP_VERSION || pkg.version
const isClient = flavor === "client"

const serverFiles = b.files
const clientFiles = ["package.json", "electron/**", "node_modules/**", "!server", "!dist"]

module.exports = {
  ...b,
  appId: b.appId,
  productName: isClient ? "Kord Client" : "Kord Server",
  copyright: b.copyright,
  directories: b.directories,
  win: b.win,
  linux: b.linux,
  mac: b.mac,
  nsis: b.nsis,
  asar: b.asar,
  asarUnpack: isClient ? [] : b.asarUnpack,
  files: isClient ? clientFiles : serverFiles,
  extraMetadata: {
    version: String(ver),
    main: isClient ? "electron/main-client.mjs" : "electron/main.mjs",
  },
  artifactName: isClient
    ? "Kord-Client-${version}-${os}-${arch}.${ext}"
    : "Kord-Server-${version}-${os}-${arch}.${ext}",
}
