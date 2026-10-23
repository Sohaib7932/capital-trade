import { authed } from "@/server/route";
import { getMonths } from "@/server/store";

/** Months that have data, newest first. */
export const GET = authed(() => getMonths());
