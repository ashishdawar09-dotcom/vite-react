// Where the iOS "Install the app" hint may appear.
//
// Player-facing forms keep their main button in a bar pinned to the bottom
// of the screen, exactly where this hint sits, so it would cover it (Nov 4:
// iPhone players couldn't see Continue on the registration form). Players
// filling in a form have no use for the app anyway. /photo/ is the player
// photo page (Nov 10), whose Upload button sits low on a phone.
const FORM_PATHS = ["/register/", "/waiver/", "/photo/"];
export function hintAllowedOn(pathname: string): boolean {
  return !FORM_PATHS.some((p) => pathname.startsWith(p));
}
