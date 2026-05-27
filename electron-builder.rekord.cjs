const pkg = require("./package.json");
const b = pkg.build || {};

const flavor = process.env.REKORD_PACK_FLAVOR || "server";
const ver = process.env.REKORD_APP_VERSION || pkg.version;
const isClient = flavor === "client";

const serverFiles = b.files;
const clientFiles = [
  "package.json",
  "electron/**",
  "public/REKORDlogo.png",
  "node_modules/**",
  "!server",
  "!dist",
];

const isWinHost = process.platform === "win32";
const forceWinNsis = process.env.REKORD_WIN_INSTALLER === "1";
const useWinNsis = isWinHost || forceWinNsis;
const win = {
  ...b.win,
  signAndEditExecutable: isWinHost,
  target: useWinNsis ? b.win.target : [{ target: "7z", arch: ["x64"] }],
};

module.exports = {
  ...b,
  appId: b.appId,
  productName: isClient ? "RE-KORD Client" : "RE-KORD Server",
  copyright: b.copyright,
  directories: b.directories,
  win,
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
    ? "RE-KORD-Client-${version}-${os}-${arch}.${ext}"
    : "RE-KORD-Server-${version}-${os}-${arch}.${ext}",
};
