import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json();
  console.log('New dumpsite request:', body);
  // TODO: Save to DB or send SMS/email notification here
  return NextResponse.json({ success: true });
}
