const COOKIE_NAME = 'basic-auth-session'
const DEFAULT_SESSION_DURATION = 3600000 // 1 hour in ms

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64Decode(str) {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function parseCredentials(env) {
  const credentialsStr = env.BASIC_AUTH_CREDENTIALS
  if (!credentialsStr) return []
  try {
    const credentials = JSON.parse(credentialsStr)
    if (!Array.isArray(credentials)) return []
    return credentials
  } catch {
    return []
  }
}

function verifyCredentials(username, password, credentials) {
  return credentials.some(
    (cred) => cred.username === username && cred.password === password
  )
}

function getSessionDuration(env) {
  const duration = env.BASIC_AUTH_SESSION_DURATION
  if (!duration) return DEFAULT_SESSION_DURATION
  const parsed = parseInt(duration, 10)
  return isNaN(parsed) || parsed <= 0 ? DEFAULT_SESSION_DURATION : parsed
}

function createSessionToken(username, env) {
  const expiresAt = Date.now() + getSessionDuration(env)
  return base64Encode(JSON.stringify({ username, expiresAt }))
}

function verifySessionToken(token) {
  try {
    const payload = JSON.parse(base64Decode(token))
    if (!payload.expiresAt || !payload.username) return false
    return Date.now() <= payload.expiresAt
  } catch {
    return false
  }
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {}
  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const eqIdx = cookie.indexOf('=')
    if (eqIdx === -1) return cookies
    const name = cookie.slice(0, eqIdx).trim()
    const value = cookie.slice(eqIdx + 1).trim()
    if (name) cookies[name] = decodeURIComponent(value)
    return cookies
  }, {})
}

function buildCookieHeader(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict; Path=/`
}

export async function onRequest(context) {
  const { request, env, next } = context
  const url = new URL(request.url)
  const pathname = url.pathname

  const staticExts = [
    '.js', '.css', '.svg', '.png', '.jpg', '.jpeg',
    '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot',
    '.webp', '.avif', '.mp4', '.webm', '.json', '.xml',
  ]
  if (
    staticExts.some((ext) => pathname.endsWith(ext)) ||
    pathname.startsWith('/assets/')
  ) {
    return next()
  }

  if (env.BASIC_AUTH_ENABLED !== 'true') {
    return next()
  }

  const credentials = parseCredentials(env)
  if (credentials.length === 0) {
    return next()
  }

  const cookies = parseCookies(request.headers.get('cookie'))
  if (cookies[COOKIE_NAME] && verifySessionToken(cookies[COOKIE_NAME])) {
    return next()
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Secure Area"' },
    })
  }

  const decoded = base64Decode(authHeader.slice(6))
  const colonIdx = decoded.indexOf(':')
  if (colonIdx === -1) {
    return new Response('Invalid credentials', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Secure Area"' },
    })
  }
  const username = decoded.slice(0, colonIdx)
  const password = decoded.slice(colonIdx + 1)

  if (!verifyCredentials(username, password, credentials)) {
    return new Response('Invalid credentials', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Secure Area"' },
    })
  }

  const sessionToken = createSessionToken(username, env)
  const maxAge = Math.floor(getSessionDuration(env) / 1000)
  const pageResponse = await next()
  const headers = new Headers(pageResponse.headers)
  headers.append('Set-Cookie', buildCookieHeader(COOKIE_NAME, sessionToken, maxAge))
  return new Response(pageResponse.body, {
    status: pageResponse.status,
    statusText: pageResponse.statusText,
    headers,
  })
}
