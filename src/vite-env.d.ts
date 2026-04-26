/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KORD_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
