// `expo-navigation-bar`'s `setButtonStyleAsync`/`setBackgroundColorAsync` are
// gone as of this SDK -- Android's edge-to-edge display is now mandatory
// (recent Android + Expo versions no longer let apps paint behind/color the
// system nav bar the old way), so there's no direct replacement API. This is
// now a no-op kept only so the (still-theme-aware) call sites below don't
// need touching; matching the nav bar's *look* to the app theme under
// edge-to-edge needs a real design pass (e.g. drawing your own scrim behind
// it), not a drop-in fix -- flagged for follow-up, not silently faked here.
export async function setAndroidNavigationBar(_theme: "light" | "dark") {
  return;
}
