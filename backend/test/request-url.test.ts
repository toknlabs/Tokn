import assert from "node:assert/strict";
import test from "node:test";
import { requestUrl } from "../src/request-url.ts";

/**
 * Next's route handlers get a NextRequest whose `url` is normalised: the first
 * `127.x.x.x` anywhere in the URL becomes `localhost`. This stands in for it,
 * overriding `url` the same way, so the test does not need Next installed.
 */
class NormalisingRequest extends Request {
  override get url(): string {
    return super.url.replace(/127(?:\.\d{1,3}){3}/, "localhost");
  }
}

const AUTHORIZE =
  "https://toknhq.com/oauth/authorize?client_id=eaon-desktop&redirect_uri=http%3A%2F%2F127.0.0.1%3A60802%2Fcallback";

test("requestUrl reads the URL as sent, not Next's normalised one", () => {
  const request = new NormalisingRequest(AUTHORIZE);
  // The trap, as it happens in production.
  assert.equal(new URL(request.url).searchParams.get("redirect_uri"), "http://localhost:60802/callback");
  // What the routes read instead.
  assert.equal(requestUrl(request).searchParams.get("redirect_uri"), "http://127.0.0.1:60802/callback");
});

test("requestUrl works on a plain Request too", () => {
  assert.equal(
    requestUrl(new Request(AUTHORIZE)).searchParams.get("redirect_uri"),
    "http://127.0.0.1:60802/callback",
  );
});
