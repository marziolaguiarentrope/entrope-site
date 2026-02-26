import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const API_BASE = process.env.ADMIN_GATEWAY_URL || 'https://prod-admin-gateway.onrender.com';
const FETCH_TIMEOUT = 60000; // 60 seconds — Render cold starts can take 30-45s

// Tell Vercel to allow this serverless function to run up to 60s
// (default is ~30s which kills the function before our fetch timeout fires)
export const maxDuration = 60;

async function getIdToken(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.idToken ?? null;
}

/**
 * Fetch with an AbortController timeout to prevent hanging requests
 * to the backend gateway (e.g. Render cold starts).
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Safely parse the backend response, handling non-JSON bodies (HTML error pages, etc.)
 * instead of letting response.json() throw and lose the real error.
 */
async function safeParseResponse(response: Response): Promise<NextResponse> {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: response.status });
  } catch {
    // Backend returned non-JSON (HTML error page, plain text, etc.)
    // Forward the raw text so callers can see the actual error
    return NextResponse.json(
      { error: text.slice(0, 500) || `Backend returned ${response.status} with empty body` },
      { status: response.status }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const idToken = await getIdToken();
  if (!idToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path } = await params;
  const targetPath = '/' + path.join('/');
  const url = new URL(request.url);
  const queryString = url.search;

  try {
    const response = await fetchWithTimeout(`${API_BASE}${targetPath}${queryString}`, {
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
    });

    return await safeParseResponse(response);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Gateway timeout — backend did not respond in time' }, { status: 504 });
    }
    console.error('Proxy GET error:', error);
    return NextResponse.json({ error: 'Proxy error: ' + (error instanceof Error ? error.message : 'unknown') }, { status: 502 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const idToken = await getIdToken();
  if (!idToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path } = await params;
  const targetPath = '/' + path.join('/');
  const body = await request.text();

  try {
    const response = await fetchWithTimeout(`${API_BASE}${targetPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    return await safeParseResponse(response);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Gateway timeout — backend did not respond in time' }, { status: 504 });
    }
    console.error('Proxy POST error:', error);
    return NextResponse.json({ error: 'Proxy error: ' + (error instanceof Error ? error.message : 'unknown') }, { status: 502 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const idToken = await getIdToken();
  if (!idToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path } = await params;
  const targetPath = '/' + path.join('/');
  const body = await request.text();

  try {
    const response = await fetchWithTimeout(`${API_BASE}${targetPath}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    return await safeParseResponse(response);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Gateway timeout — backend did not respond in time' }, { status: 504 });
    }
    console.error('Proxy PATCH error:', error);
    return NextResponse.json({ error: 'Proxy error: ' + (error instanceof Error ? error.message : 'unknown') }, { status: 502 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const idToken = await getIdToken();
  if (!idToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path } = await params;
  const targetPath = '/' + path.join('/');

  try {
    const response = await fetchWithTimeout(`${API_BASE}${targetPath}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
    });

    return await safeParseResponse(response);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Gateway timeout — backend did not respond in time' }, { status: 504 });
    }
    console.error('Proxy DELETE error:', error);
    return NextResponse.json({ error: 'Proxy error: ' + (error instanceof Error ? error.message : 'unknown') }, { status: 502 });
  }
}
