/**
 * Request parameters, from wherever they arrive.
 *
 * Authorize parameters come from a query string, or from the consent form.
 * Token and revocation requests are form-encoded by the spec, and JSON is
 * accepted too because that is what every HTTP client reaches for first.
 * Everything is normalised to `URLSearchParams` so the rules below are written
 * once, and every value is kept: RFC 6749 §3.1 forbids repeating a parameter,
 * and noticing a repeat needs all of them.
 */

export type OAuthParams = URLSearchParams;

/** From Next's `searchParams`, which folds repeats into an array. */
export function oauthParamsFromRecord(record: Record<string, string | string[] | undefined>): OAuthParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item);
    }
  }
  return params;
}

/**
 * From a request body. Null when it is not parseable at all, which callers
 * answer with `invalid_request`.
 *
 * JSON values that are not strings are dropped rather than coerced: a number
 * where a code belongs is a malformed request, and treating it as absent gets
 * the right error without a second rule.
 */
export function oauthParamsFromBody(contentType: string | null, raw: string): OAuthParams | null {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();

  if (type === "application/json") {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

    const params = new URLSearchParams();
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") params.append(key, item);
    }
    return params;
  }

  // Form encoding is the spec's default, so anything else is read as that.
  return new URLSearchParams(raw);
}

/**
 * One parameter's value. `repeated` is set when it appeared more than once,
 * which is an error in its own right whatever the values were. An empty value
 * counts as absent, as RFC 6749 §3.1 says it must.
 */
export function oauthParam(params: OAuthParams, name: string): { value: string | null; repeated: boolean } {
  const all = params.getAll(name);
  const value = all.length === 1 && all[0] !== "" ? all[0]! : null;
  return { value, repeated: all.length > 1 };
}
