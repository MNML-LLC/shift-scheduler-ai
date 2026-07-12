/**
 * Vercel Edge Middleware for Basic Authentication with Session Management
 *
 * This middleware runs on Vercel's Edge Network and provides Basic Authentication
 * for the entire application. It supports multiple user credentials and session management.
 *
 * Environment Variables:
 * - BASIC_AUTH_ENABLED: Set to 'true' to enable Basic Auth (defaults to false)
 * - BASIC_AUTH_CREDENTIALS: JSON array of user credentials
 *   Example: [{"username":"user1","password":"pass1"},{"username":"user2","password":"pass2"}]
 * - BASIC_AUTH_SESSION_DURATION: Session duration in milliseconds (default: 3600000 = 1 hour)
 * - BASIC_AUTH_SECRET: HMAC-SHA256 signing secret for session tokens (required, no fallback).
 *   Without it, no session token can be created or accepted as valid — a warning is logged
 *   and every request falls back to re-authenticating via the Authorization header.
 */

export const config = {
  matcher: ['/', '/:path*'],
};

const COOKIE_NAME = 'basic-auth-session';
const DEFAULT_SESSION_DURATION = 3600000; // 1 hour in ms

const textEncoder = new TextEncoder();
let secretMissingWarned = false;

/**
 * Base64 encode (Edge Runtime compatible)
 */
function base64Encode(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

/**
 * Base64 decode (Edge Runtime compatible)
 */
function base64Decode(str) {
  return Buffer.from(str, 'base64').toString('utf-8');
}

/**
 * Read the HMAC signing secret from the environment, warning (once) if it's missing.
 * There is no unsigned fallback: without a secret, tokens can be neither created nor verified.
 */
function getAuthSecret() {
  const secret = process.env.BASIC_AUTH_SECRET;
  if (!secret) {
    if (!secretMissingWarned) {
      console.warn(
        '[BasicAuth] BASIC_AUTH_SECRET is not set. Session tokens cannot be created or verified ' +
          'until it is configured; every request will require re-authentication.'
      );
      secretMissingWarned = true;
    }
    return null;
  }
  return secret;
}

/**
 * Import the raw secret as an HMAC-SHA256 CryptoKey (Web Crypto / SubtleCrypto, Edge-compatible)
 */
function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Sign a base64-encoded payload with HMAC-SHA256, returning a base64 signature
 */
async function signPayload(payloadB64, secret) {
  const key = await importHmacKey(secret);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payloadB64));
  return Buffer.from(signatureBuffer).toString('base64');
}

/**
 * Verify a base64-encoded payload against its base64 HMAC-SHA256 signature
 */
async function verifyPayloadSignature(payloadB64, signatureB64, secret) {
  const key = await importHmacKey(secret);
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signatureB64, 'base64');
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', key, signatureBytes, textEncoder.encode(payloadB64));
}

/**
 * Parse credentials from environment variable
 */
function parseCredentials() {
  const credentialsStr = process.env.BASIC_AUTH_CREDENTIALS;

  if (!credentialsStr) {
    return [];
  }

  try {
    const credentials = JSON.parse(credentialsStr);
    if (!Array.isArray(credentials)) {
      console.error('BASIC_AUTH_CREDENTIALS must be a JSON array');
      return [];
    }
    return credentials;
  } catch (error) {
    console.error('Failed to parse BASIC_AUTH_CREDENTIALS:', error);
    return [];
  }
}

/**
 * Verify if the provided username and password match any configured credentials
 */
function verifyCredentials(username, password, credentials) {
  return credentials.some(
    (cred) => cred.username === username && cred.password === password
  );
}

/**
 * Create an HMAC-SHA256 signed session token: "<base64 payload>.<base64 signature>"
 * Throws if no signing secret is configured — there is no unsigned fallback.
 */
export async function createSessionToken(username, secret = getAuthSecret()) {
  if (!secret) {
    throw new Error('BASIC_AUTH_SECRET is not configured; cannot create a session token');
  }

  const expiresAt = Date.now() + getSessionDuration();
  const payload = { username, expiresAt };
  const payloadB64 = base64Encode(JSON.stringify(payload));
  const signatureB64 = await signPayload(payloadB64, secret);
  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verify a signed session token. Rejects unsigned/legacy tokens, tampered signatures,
 * expired tokens, and any token if no signing secret is configured.
 */
export async function verifySessionToken(token, secret = getAuthSecret()) {
  if (!secret || typeof token !== 'string') {
    return false;
  }

  // Legacy unsigned tokens are plain base64 (no '.' separator) and are always rejected.
  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }
  const [payloadB64, signatureB64] = parts;

  try {
    const isSignatureValid = await verifyPayloadSignature(payloadB64, signatureB64, secret);
    if (!isSignatureValid) {
      return false;
    }

    const payload = JSON.parse(base64Decode(payloadB64));

    if (!payload.expiresAt || !payload.username) {
      return false;
    }

    // Check if token has expired
    if (Date.now() > payload.expiresAt) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get session duration from environment variable
 */
function getSessionDuration() {
  const duration = process.env.BASIC_AUTH_SESSION_DURATION;
  if (!duration) {
    return DEFAULT_SESSION_DURATION;
  }

  const parsed = parseInt(duration, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn('Invalid BASIC_AUTH_SESSION_DURATION, using default');
    return DEFAULT_SESSION_DURATION;
  }

  return parsed;
}

/**
 * Parse cookies from cookie header
 */
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};

  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
    return cookies;
  }, {});
}

/**
 * Create a Set-Cookie header value
 */
function createCookieHeader(name, value, options = {}) {
  const {
    maxAge,
    httpOnly = true,
    secure = false,
    sameSite = 'strict',
    path = '/',
  } = options;

  let cookie = `${name}=${encodeURIComponent(value)}`;

  if (maxAge) {
    cookie += `; Max-Age=${maxAge}`;
  }
  if (httpOnly) {
    cookie += '; HttpOnly';
  }
  if (secure) {
    cookie += '; Secure';
  }
  if (sameSite) {
    cookie += `; SameSite=${sameSite}`;
  }
  if (path) {
    cookie += `; Path=${path}`;
  }

  return cookie;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  console.log('[BasicAuth] Middleware triggered for:', pathname);

  // Skip authentication for static files
  const staticFileExtensions = [
    '.js', '.css', '.svg', '.png', '.jpg', '.jpeg',
    '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot',
    '.webp', '.avif', '.mp4', '.webm', '.json', '.xml'
  ];

  if (staticFileExtensions.some(ext => pathname.endsWith(ext))) {
    console.log('[BasicAuth] Skipping static file:', pathname);
    return;
  }

  // Skip /assets/ directory
  if (pathname.startsWith('/assets/')) {
    console.log('[BasicAuth] Skipping assets directory:', pathname);
    return;
  }

  // Check if Basic Auth is enabled
  const isEnabled = process.env.BASIC_AUTH_ENABLED === 'true';
  console.log('[BasicAuth] BASIC_AUTH_ENABLED:', isEnabled);

  if (!isEnabled) {
    console.log('[BasicAuth] Basic Auth disabled, allowing access');
    return;
  }

  // Get credentials from environment variables
  const credentials = parseCredentials();
  console.log('[BasicAuth] Credentials configured:', credentials.length, 'user(s)');

  // If credentials are not set, skip authentication
  if (credentials.length === 0) {
    console.warn('[BasicAuth] Basic Auth is enabled but no credentials are configured');
    return;
  }

  // Resolve the signing secret up front so a missing-secret warning is logged
  // as soon as Basic Auth is active, regardless of whether a session cookie is present.
  const authSecret = getAuthSecret();

  // Check for existing session
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const sessionToken = cookies[COOKIE_NAME];

  if (sessionToken) {
    const isValid = await verifySessionToken(sessionToken, authSecret);
    console.log('[BasicAuth] Session token found, valid:', isValid);
    if (isValid) {
      console.log('[BasicAuth] Valid session, allowing access');
      return;
    }
  } else {
    console.log('[BasicAuth] No session token found');
  }

  // Get the Authorization header
  const authHeader = request.headers.get('authorization');

  // Check if Authorization header exists
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    console.log('[BasicAuth] No valid Authorization header, requesting authentication');
    return new Response('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Area"',
      },
    });
  }

  // Extract and decode credentials
  const base64Credentials = authHeader.split(' ')[1];
  const decodedCredentials = base64Decode(base64Credentials);
  const [username, password] = decodedCredentials.split(':');

  console.log('[BasicAuth] Attempting authentication for user:', username);

  // Verify credentials
  if (verifyCredentials(username, password, credentials)) {
    console.log('[BasicAuth] Authentication successful for user:', username);

    if (!authSecret) {
      console.error('[BasicAuth] Cannot issue a session: BASIC_AUTH_SECRET is not configured');
      return new Response('Server misconfiguration: authentication secret not set', {
        status: 500,
      });
    }

    // Authentication successful, create session and set cookie
    const sessionToken = await createSessionToken(username, authSecret);

    // Create response with cookie
    const cookieValue = createCookieHeader(COOKIE_NAME, sessionToken, {
      maxAge: Math.floor(getSessionDuration() / 1000), // Convert to seconds
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: url.pathname + url.search,
        'Set-Cookie': cookieValue,
      },
    });
  }

  // Authentication failed
  console.log('[BasicAuth] Authentication failed for user:', username);
  return new Response('Invalid credentials', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  });
}
