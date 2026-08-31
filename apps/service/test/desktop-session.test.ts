import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { DesktopSession } from "../src/http/desktop-session.js";

function request(cookie?: string): IncomingMessage {
  return { headers: cookie ? { cookie } : {} } as IncomingMessage;
}

test("exchanges a launch token once for an opaque expiring HttpOnly session", () => {
  let now = 1_000;
  const session = new DesktopSession("launch-secret", () => now, 60_000);
  assert.equal(session.exchange("wrong"), undefined);
  const headers = session.exchange("launch-secret");
  const header = headers?.[0] ?? "";
  const csrfHeader = headers?.[1] ?? "";
  assert.match(header, /^vraxis_code_session=[A-Za-z0-9_-]{43};/);
  assert.match(header, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=60/);
  assert.match(csrfHeader, /^vraxis_code_csrf=[A-Za-z0-9_-]{43}; SameSite=Strict/);
  assert.doesNotMatch(headers?.join(";") ?? "", /launch-secret|=desktop/);
  assert.equal(session.exchange("launch-secret"), undefined, "launch token must be one-time");

  const cookie = header?.split(";", 1)[0];
  assert.equal(session.authorize(request(cookie)), true);
  assert.equal(session.authorize(request("vraxis_code_session=desktop")), false);
  now += 60_000;
  assert.equal(session.authorize(request(cookie)), false);
});

test("requires a matching double-submit token for mutating desktop requests", () => {
  const session = new DesktopSession("launch-secret");
  const headers = session.exchange("launch-secret")!;
  const cookie = headers.map((value) => value.split(";", 1)[0]).join("; ");
  const csrf = headers[1]!.split("=", 2)[1]!.split(";", 1)[0]!;
  assert.equal(session.authorizeMutation({ method: "GET", headers: { cookie } } as IncomingMessage), true);
  assert.equal(session.authorizeMutation({ method: "POST", headers: { cookie } } as IncomingMessage), false);
  assert.equal(session.authorizeMutation({ method: "POST", headers: { cookie, "x-vraxis-csrf": "wrong" } } as IncomingMessage), false);
  assert.equal(session.authorizeMutation({ method: "POST", headers: { cookie, "x-vraxis-csrf": csrf } } as IncomingMessage), true);
});
