import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const API_BASE = process.env.ADMIN_GATEWAY_URL || 'https://prod-admin-gateway.onrender.com';
const FETCH_TIMEOUT = 60000; // 60 seconds — Render cold starts can take 30-45s

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

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Gateway timeout' }, { status: 504 });
    }
    console.error('Proxy GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Gateway timeout' }, { status: 504 });
    }
    console.error('Proxy POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Gateway timeout' }, { status: 504 });
    }
    console.error('Proxy PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
