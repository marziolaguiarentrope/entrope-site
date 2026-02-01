import { NextRequest, NextResponse } from 'next/server';

const API_BASE = 'https://staging-admin-gateway.onrender.com';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = '/' + path.join('/');
  const url = new URL(request.url);
  const queryString = url.search;

  const response = await fetch(`${API_BASE}${targetPath}${queryString}`, {
    headers: {
      'Authorization': 'Bearer mock-token',
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = '/' + path.join('/');
  const body = await request.text();

  const response = await fetch(`${API_BASE}${targetPath}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token',
      'Content-Type': 'application/json',
    },
    body,
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
