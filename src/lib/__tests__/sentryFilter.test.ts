import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { isInjectedScriptError } from "../sentryFilter";

const REG = "https://badminton.adawar.org/register/e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb";

function event(frames: { filename?: string; function?: string }[], url = REG): ErrorEvent {
  return {
    type: undefined,
    request: { url: `${url}?utm_source=meta&fbclid=abc` },
    exception: { values: [{ type: "Error", value: "x", stacktrace: { frames } }] },
  };
}

describe("isInjectedScriptError", () => {
  it("drops the Instagram in-app browser bridge error", () => {
    // Frames as Sentry reported them on Oct 25 (outermost first).
    const e = event([
      { filename: REG, function: "None" },
      { filename: REG, function: "logSubmitButtonClicked" },
      { filename: REG, function: "sendPostMessage" },
      { filename: REG, function: "dispatchToBridge" },
    ]);
    expect(isInjectedScriptError(e)).toBe(true);
  });

  it("drops the bridge error when the frame names are qualified", () => {
    // Safari and Sentry sometimes report "Object.fn", "window.x.fn" or
    // "async fn" instead of the bare name. The file is a page URL, but the
    // one the script was injected into: after an in-app navigation it no
    // longer matches the event's page URL.
    const injectedInto = "https://badminton.adawar.org/register";
    for (const name of ["Object.dispatchToBridge", "window.__fbIAB.sendPostMessage", "async logSubmitButtonClicked"]) {
      expect(isInjectedScriptError(event([{ filename: injectedInto, function: name }]))).toBe(true);
    }
  });

  it("drops the bridge error even when Sentry has no page URL for the event", () => {
    const e: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: "InvalidAccessError", stacktrace: { frames: [
        { filename: REG, function: "logSubmitButtonClicked" },
        { filename: REG, function: "dispatchToBridge" },
      ] } }] },
    };
    expect(isInjectedScriptError(e)).toBe(true);
  });

  it("keeps our own functions whose names merely contain a bridge name", () => {
    const e = event([{ filename: "https://badminton.adawar.org/assets/index-abc123.js", function: "mySendPostMessageHelper" }]);
    expect(isInjectedScriptError(e)).toBe(false);
  });

  it("drops any error whose every frame is an inline script on the page", () => {
    expect(isInjectedScriptError(event([{ filename: REG, function: "somethingElse" }]))).toBe(true);
  });

  it("keeps errors from our bundled code", () => {
    const e = event([
      { filename: "https://badminton.adawar.org/assets/index-abc123.js", function: "submit" },
      { filename: REG, function: "inline" },
    ]);
    expect(isInjectedScriptError(e)).toBe(false);
  });

  it("keeps a stackless window error that Sentry pinned to the page URL", () => {
    // @sentry/browser's global handler adds { function: "?", filename: <page> }
    // when the browser gives no script URL.
    expect(isInjectedScriptError(event([{ filename: REG, function: "?" }]))).toBe(false);
  });

  it("keeps errors that have no stack trace", () => {
    expect(isInjectedScriptError(event([]))).toBe(false);
    expect(isInjectedScriptError({ type: undefined, message: "boom" })).toBe(false);
  });

  it("keeps inline-frame errors when the page URL is unknown", () => {
    const e: ErrorEvent = {
      type: undefined,
      exception: { values: [{ stacktrace: { frames: [{ filename: REG, function: "f" }] } }] },
    };
    expect(isInjectedScriptError(e)).toBe(false);
  });
});
