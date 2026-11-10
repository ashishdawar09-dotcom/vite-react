import { assertEquals } from "jsr:@std/assert@1";
import { decodePhotoDataUrl, firstName, imageKind, MAX_PHOTO_BYTES, selfPathFromUrl, selfPhotoPath } from "./photos.ts";

const PID = "dc0615e4-c2b6-437b-80da-1e712d2cc011";
const bytes = (head: number[], size = 200) => { const b = new Uint8Array(size); b.set(head); return b; };
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const JPEG = [0xff, 0xd8, 0xff, 0xe0], PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

Deno.test("knows a photo by its first bytes, not its name", () => {
  assertEquals(imageKind(bytes(JPEG)), "jpeg");
  assertEquals(imageKind(bytes(PNG)), "png");
  assertEquals(imageKind(bytes(WEBP)), "webp");
  assertEquals(imageKind(bytes([0x47, 0x49, 0x46, 0x38])), null); // GIF
  assertEquals(imageKind(bytes([0x3c, 0x73, 0x76, 0x67])), null); // <svg
  assertEquals(imageKind(new Uint8Array([0xff, 0xd8])), null);
});

Deno.test("decodes only image data URLs of a sensible size", () => {
  const ok = decodePhotoDataUrl(`data:image/jpeg;base64,${b64(bytes(JPEG, 300))}`);
  assertEquals(ok?.length, 300);
  assertEquals(imageKind(ok!), "jpeg");
  assertEquals(decodePhotoDataUrl(`data:image/svg+xml;base64,${b64(bytes(JPEG, 300))}`), null);
  assertEquals(decodePhotoDataUrl(`data:text/html;base64,${b64(bytes(JPEG, 300))}`), null);
  assertEquals(decodePhotoDataUrl("data:image/jpeg;base64,not*base64"), null);
  assertEquals(decodePhotoDataUrl(`data:image/jpeg;base64,${b64(bytes(JPEG, 30))}`), null); // too small to be a photo
  assertEquals(decodePhotoDataUrl(42), null);
  assertEquals(decodePhotoDataUrl(`data:image/jpeg;base64,${"A".repeat(Math.ceil((MAX_PHOTO_BYTES + 1000) / 3) * 4)}`), null);
});

Deno.test("keeps a player's own photos under their id, and only deletes those", () => {
  assertEquals(selfPhotoPath(PID, "jpeg", 1794330000000), `self/${PID}/1794330000000.jpg`);
  const url = `https://wdqooznwzesmjdvlcrxw.supabase.co/storage/v1/object/public/player-photos/self/${PID}/1794330000000.jpg`;
  assertEquals(selfPathFromUrl(url, PID), `self/${PID}/1794330000000.jpg`);
  assertEquals(selfPathFromUrl(`${url}?v=2`, PID), `self/${PID}/1794330000000.jpg`);
  assertEquals(selfPathFromUrl(url, "11111111-2222-3333-4444-555555555555"), null); // someone else's
  assertEquals(selfPathFromUrl(`https://wdqooznwzesmjdvlcrxw.supabase.co/storage/v1/object/public/player-photos/${PID}-1792903229930.jpeg`, PID), null); // an admin upload
  assertEquals(selfPathFromUrl(null, PID), null);
});

Deno.test("greets by first name", () => {
  assertEquals(firstName("  Gurmeet Singh Ghera "), "Gurmeet");
  assertEquals(firstName("Arif"), "Arif");
});
