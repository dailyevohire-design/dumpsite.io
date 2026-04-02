import { NextRequest, NextResponse } from "next/server"
import { handleCustomerSMS } from "@/lib/services/customer-brain.service"
import twilio from "twilio"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const from = formData.get("From") as string || ""
    const body = formData.get("Body") as string || ""
    const messageSid = formData.get("MessageSid") as string || ""
    const numMedia = parseInt(formData.get("NumMedia") as string || "0")
    const mediaUrl = formData.get("MediaUrl0") as string || undefined

    const reply = await handleCustomerSMS({ from, body, messageSid, numMedia, mediaUrl })

    const twiml = new twilio.twiml.MessagingResponse()
    if (reply) twiml.message(reply)

    return new NextResponse(twiml.toString(), {
      headers: { "Content-Type": "text/xml" },
    })
  } catch (err) {
    console.error("[Customer webhook error]", err)
    const twiml = new twilio.twiml.MessagingResponse()
    twiml.message("Give me just a moment")
    return new NextResponse(twiml.toString(), {
      headers: { "Content-Type": "text/xml" },
    })
  }
}

export async function GET() {
  return NextResponse.json({ status: "Customer SMS webhook active" })
}
