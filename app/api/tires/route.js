// app/api/tires/route.js
import { NextResponse } from 'next/server';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': 'https://gcitires.com',  // Or '*' temp
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
    },
  });
}

export async function POST(request) {
  // Your main logic here
  // const body = await request.json();
  // ... process with Google AI Studio

  return NextResponse.json({ /* result */ }, {
    headers: {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': 'https://gcitires.com',
    },
  });
}// This is the lattest
