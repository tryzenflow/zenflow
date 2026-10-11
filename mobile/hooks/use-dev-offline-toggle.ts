import { useConnectivity } from "@/lib/connectivity";
import { useEffect } from "react";
import { DevSettings } from "react-native";

/** Dev builds: a "Toggle offline" item in the dev menu (Cmd+D iOS, Cmd+M Android). */
export function useDevOfflineToggle(): void {
  useEffect(() => {
    if (!__DEV__) return;
    DevSettings.addMenuItem("Toggle offline", () => {
      const { forcedOffline, setForcedOffline } = useConnectivity.getState();
      setForcedOffline(!forcedOffline);
    });
  }, []);
}
