import { AppConfirmProvider } from "./context/AppConfirmContext";
import { PlayerProvider } from "./context/PlayerContext";
import { ToolsActivityProvider } from "./context/ToolsActivityContext";
import { UserStateProvider } from "./context/UserStateContext";
import { AppShell } from "./components/AppShell/AppShell";
import { LibraryRootGate } from "./components/LibraryRootGate/LibraryRootGate";
import "./App.css";
import "./responsive.css";

export default function App() {
  return (
    <LibraryRootGate>
      <UserStateProvider>
        <AppConfirmProvider>
          <PlayerProvider>
            <ToolsActivityProvider>
              <AppShell />
            </ToolsActivityProvider>
          </PlayerProvider>
        </AppConfirmProvider>
      </UserStateProvider>
    </LibraryRootGate>
  );
}
