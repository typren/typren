// CloudFront Function (viewer-request, cloudfront-js-2.0 runtime) for a
// static-export site built with Next's DEFAULT export shape (`trailingSlash:
// false`: `/about` serves the object `about.html`, only the root serves
// `index.html`) on an S3 REST origin. Bare-URL counterpart of
// redirects.function.js, the trailing-slash/directory-index shape; see that
// file's header for why a distribution's single viewer-request function must
// do all these jobs at once. `function-source.ts`'s readFunctionSource({
// trailingSlash: false }) selects this file instead at publish time. Mirrors
// @typren/core's static-host.ts `bareUrlDecision`, held to the same
// semantics by @typren/contract-tests' createBareUrlStaticHostRoutingContractSuite.
import cf from "cloudfront";

const kvs = cf.kvs();

// Extensionless routes Next.js's static export emits for its file-convention
// metadata APIs (opengraph-image, twitter-image, icon, apple-icon). These are
// real S3 objects, not pages, and must never be redirected or rewritten.
// Matched against the LAST path segment, see redirects.function.js.
var PASSTHROUGH = {
  "opengraph-image": true,
  "twitter-image": true,
  "icon": true,
  "apple-icon": true,
};

// Replaced at publish time by readFunctionSource()'s templating with
// validated --extra-passthrough segments, as a JSON object literal of
// {segment: true} pairs (see function-source.ts: JSON.stringify, never
// string concatenation, so an operator-supplied segment can't break out of
// this literal into surrounding code). Empty object when none configured.
var EXTRA_PASSTHROUGH = "__TYPREN_EXTRA_PASSTHROUGH__";

var STATUS_TEXT = {
  301: "Moved Permanently",
  302: "Found",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
};

// A KVS value may carry a status prefix: "<301|302|307|308> <target>", a
// bare value defaults to 301. See redirects.function.js for the full note;
// this is the same parser, duplicated because cloudfront-js has no bundler.
function parseRedirectValue(raw) {
  if (raw.length > 3 && raw.charAt(3) === " " && isThreeDigits(raw)) {
    var status = Number(raw.slice(0, 3));
    return STATUS_TEXT[status] && raw.length > 4 ? { status: status, target: raw.slice(4) } : null;
  }
  return { status: 301, target: raw };
}

function isThreeDigits(raw) {
  for (var i = 0; i < 3; i++) {
    var code = raw.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

// Same trust boundary as redirects.function.js: a redirect target arrives
// from the KeyValueStore, which anyone with UpdateKeys can write anything
// into. Refuse protocol-relative, backslash, and control-character targets.
function unsafeTarget(target) {
  if (target.charAt(0) === "/" && target.charAt(1) === "/") return true;
  if (target.indexOf("\\") !== -1) return true;
  for (var i = 0; i < target.length; i++) {
    var code = target.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// Whether `uri` names a page (as opposed to a real object) that may be
// canonicalized or rewritten. Never a uri whose second character is another
// "/": emitted as a Location it resolves as protocol-relative, which would
// turn canonicalization into an open redirect, so it falls through
// untouched instead (and 404s at origin). Real extensionless objects
// (PASSTHROUGH, EXTRA_PASSTHROUGH, `/.well-known/…`) and anything with a dot
// in its last segment are objects, not pages.
function isPagePath(uri) {
  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  return (
    uri.charAt(1) !== "/" &&
    uri.indexOf("/.well-known/") !== 0 &&
    !PASSTHROUGH[lastSegment] &&
    !EXTRA_PASSTHROUGH[lastSegment] &&
    lastSegment.indexOf(".") === -1
  );
}

async function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var key = uri.length > 1 && uri.charAt(uri.length - 1) === "/" ? uri.slice(0, -1) : uri;

  // Same fail-open contract as redirects.function.js: any KVS failure (not
  // just "key absent") degrades to "no redirect here", never breaks the
  // canonicalization below.
  var target = null;
  try {
    target = await kvs.get(key);
  } catch (e) {
    target = null;
  }
  if (target) {
    var parsed = parseRedirectValue(target);
    if (parsed && !unsafeTarget(parsed.target)) {
      return redirect(parsed.status, parsed.target, request.querystring);
    }
  }

  // The root is the one path this export shape still serves as "index.html",
  // regardless of the bare-URL convention everywhere else.
  if (uri === "/") {
    request.uri = "/index.html";
    return request;
  }

  // Slash form (`/about/`): 301 to the canonical bare form, the mirror image
  // of redirects.function.js's bare->slash canonicalization. Real
  // extensionless objects (and anything that would resolve protocol-relative,
  // see isPagePath) fall through untouched.
  if (uri.charAt(uri.length - 1) === "/") {
    var bare = uri.slice(0, -1);
    return isPagePath(bare) ? redirect(301, bare, request.querystring) : request;
  }

  // Bare form (`/about`): the canonical shape for this export, rewrite to
  // its `.html` object.
  if (isPagePath(uri)) {
    request.uri = uri + ".html";
    return request;
  }

  return request;
}

// Rebuild the query string the viewer sent; see redirects.function.js.
function queryStringOf(querystring) {
  var parts = [];
  for (var name in querystring) {
    var entry = querystring[name];
    if (entry.multiValue) {
      for (var i = 0; i < entry.multiValue.length; i++) {
        parts.push(name + "=" + entry.multiValue[i].value);
      }
    } else if (entry.value === "") {
      parts.push(name);
    } else {
      parts.push(name + "=" + entry.value);
    }
  }
  return parts.join("&");
}

function redirect(status, location, querystring) {
  var qs = querystring ? queryStringOf(querystring) : "";
  if (qs) {
    location = location + (location.indexOf("?") === -1 ? "?" : "&") + qs;
  }
  return {
    statusCode: status,
    statusDescription: STATUS_TEXT[status],
    headers: { location: { value: location } },
  };
}
