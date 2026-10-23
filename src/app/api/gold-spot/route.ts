import { authed } from "@/server/route";
import { getGoldSpot } from "@/server/store";

export const GET = authed(() => getGoldSpot());
