// PREPARATION ONLY: no scheduler or credentials configured by this code.
// Owner must approve activation and application of migrations 0013-0014.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createUnattendedNbaHandler } from "../_shared/nba-worker-handler.ts";

Deno.serve(createUnattendedNbaHandler({ env: name => Deno.env.get(name) }));
