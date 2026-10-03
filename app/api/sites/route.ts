import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/src/server/db";
import { listSites } from "@/src/server/manage";

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company") ?? process.env.COMPANY_SLUG ?? undefined;
  return NextResponse.json(await listSites(db(), company));
}
