/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react"

type Prog = { current: number; total: number } | null

type Ctx = {
  log: string
  setLog: Dispatch<SetStateAction<string>>
  metaLog: string
  setMetaLog: Dispatch<SetStateAction<string>>
  dlBusy: boolean
  setDlBusy: Dispatch<SetStateAction<boolean>>
  dlProg: Prog
  setDlProg: Dispatch<SetStateAction<Prog>>
  mkBusy: boolean
  setMkBusy: Dispatch<SetStateAction<boolean>>
  artBusy: boolean
  setArtBusy: Dispatch<SetStateAction<boolean>>
  metaBusy: boolean
  setMetaBusy: Dispatch<SetStateAction<boolean>>
  metaAllBusy: boolean
  setMetaAllBusy: Dispatch<SetStateAction<boolean>>
  metaScanProg: Prog
  setMetaScanProg: Dispatch<SetStateAction<Prog>>
  trackMetaBusy: boolean
  setTrackMetaBusy: Dispatch<SetStateAction<boolean>>
  trackAllBusy: boolean
  setTrackAllBusy: Dispatch<SetStateAction<boolean>>
  trackScanProg: Prog
  setTrackScanProg: Dispatch<SetStateAction<Prog>>
  titleSanBusy: boolean
  setTitleSanBusy: Dispatch<SetStateAction<boolean>>
  stopMetaAll: MutableRefObject<boolean>
  stopTrackAll: MutableRefObject<boolean>
  toolsAnyBusy: boolean
}

const ToolsActivityContext = createContext<Ctx | null>(null)

export function ToolsActivityProvider({ children }: { children: ReactNode }) {
  const [log, setLog] = useState("")
  const [metaLog, setMetaLog] = useState("")
  const [dlBusy, setDlBusy] = useState(false)
  const [dlProg, setDlProg] = useState<Prog>(null)
  const [mkBusy, setMkBusy] = useState(false)
  const [artBusy, setArtBusy] = useState(false)
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaAllBusy, setMetaAllBusy] = useState(false)
  const [metaScanProg, setMetaScanProg] = useState<Prog>(null)
  const [trackMetaBusy, setTrackMetaBusy] = useState(false)
  const [trackAllBusy, setTrackAllBusy] = useState(false)
  const [trackScanProg, setTrackScanProg] = useState<Prog>(null)
  const [titleSanBusy, setTitleSanBusy] = useState(false)
  const stopMetaAll = useRef(false)
  const stopTrackAll = useRef(false)

  const toolsAnyBusy = useMemo(
    () =>
      dlBusy ||
      mkBusy ||
      artBusy ||
      metaBusy ||
      metaAllBusy ||
      trackMetaBusy ||
      trackAllBusy ||
      titleSanBusy,
    [
      dlBusy,
      mkBusy,
      artBusy,
      metaBusy,
      metaAllBusy,
      trackMetaBusy,
      trackAllBusy,
      titleSanBusy,
    ],
  )

  const value = useMemo(
    () => ({
      log,
      setLog,
      metaLog,
      setMetaLog,
      dlBusy,
      setDlBusy,
      dlProg,
      setDlProg,
      mkBusy,
      setMkBusy,
      artBusy,
      setArtBusy,
      metaBusy,
      setMetaBusy,
      metaAllBusy,
      setMetaAllBusy,
      metaScanProg,
      setMetaScanProg,
      trackMetaBusy,
      setTrackMetaBusy,
      trackAllBusy,
      setTrackAllBusy,
      trackScanProg,
      setTrackScanProg,
      titleSanBusy,
      setTitleSanBusy,
      stopMetaAll,
      stopTrackAll,
      toolsAnyBusy,
    }),
    [
      log,
      metaLog,
      dlBusy,
      dlProg,
      mkBusy,
      artBusy,
      metaBusy,
      metaAllBusy,
      metaScanProg,
      trackMetaBusy,
      trackAllBusy,
      trackScanProg,
      titleSanBusy,
      toolsAnyBusy,
    ],
  )

  return (
    <ToolsActivityContext.Provider value={value}>
      {children}
    </ToolsActivityContext.Provider>
  )
}

export function useToolsActivity() {
  const c = useContext(ToolsActivityContext)
  if (!c) throw new Error("useToolsActivity: missing ToolsActivityProvider")
  return c
}
