import { describe, expect, it } from "vitest";
import { isOnline, selectOffline, useConnectivity } from "../connectivity";

describe("connectivity", () => {
  it("treats unknown as online and only definite failures as offline", () => {
    expect(isOnline({ isConnected: null, isInternetReachable: null })).toBe(
      true,
    );
    expect(isOnline({ isConnected: true, isInternetReachable: null })).toBe(
      true,
    );
    expect(isOnline({ isConnected: false, isInternetReachable: null })).toBe(
      false,
    );
    expect(isOnline({ isConnected: true, isInternetReachable: false })).toBe(
      false,
    );
  });

  it("is offline when the network is down or a fetch fell back to saved data", () => {
    const { setOnline, setStale } = useConnectivity.getState();
    setOnline(true);
    setStale("a", false);
    expect(selectOffline(useConnectivity.getState())).toBe(false);
    setStale("a", true);
    expect(selectOffline(useConnectivity.getState())).toBe(true);
    // A neighbouring page refreshing fine must not clear another page's flag.
    setStale("b", false);
    expect(selectOffline(useConnectivity.getState())).toBe(true);
    setStale("a", false);
    setOnline(false);
    expect(selectOffline(useConnectivity.getState())).toBe(true);
    setOnline(true);
  });
});

describe("forced offline (dev toggle)", () => {
  it("overrides NetInfo and restores it when switched off", () => {
    const { setOnline, setForcedOffline } = useConnectivity.getState();
    setForcedOffline(false);
    setOnline(true);
    setForcedOffline(true);
    expect(useConnectivity.getState().online).toBe(false);
    setOnline(true); // NetInfo still says online: stays forced offline
    expect(useConnectivity.getState().online).toBe(false);
    setForcedOffline(false);
    expect(useConnectivity.getState().online).toBe(true);
    setOnline(false);
    setForcedOffline(true);
    setForcedOffline(false);
    expect(useConnectivity.getState().online).toBe(false); // really offline
    setOnline(true);
  });
});
