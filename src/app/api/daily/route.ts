import { authed, parseMonth } from "@/server/route";
import { getDailyPerformance } from "@/server/store";

export const GET = authed(async (request) => getDailyPerformance(parseMonth(request.nextUrl.searchParams.get("month"))));
