import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const isUserId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Admin service is not configured." }, 500);
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Authentication required." }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return jsonResponse({ error: "Authentication required." }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
    if (!isRecord(parsedBody) || typeof parsedBody.action !== "string") {
      return jsonResponse({ error: "A valid admin action is required." }, 400);
    }
    const body = parsedBody;

    if (body.action === "delete-own-account") {
      if (body.confirmation !== "DELETE") {
        return jsonResponse({ error: "Type DELETE to confirm account deletion." }, 400);
      }
      const { error } = await adminClient.auth.admin.deleteUser(caller.id);
      if (error) throw error;
      return jsonResponse({ message: "Your account and financial records were permanently deleted." });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== "admin") return jsonResponse({ error: "Administrator access required." }, 403);

    if (body.action === "list-users") {
      const page = typeof body.page === "number" && Number.isSafeInteger(body.page) && body.page > 0 ? body.page : 1;
      const fetchUserPage = async (targetPage: number, perPage: number) => {
        const { data, error } = await adminClient.auth.admin.listUsers({ page: targetPage, perPage });
        if (error) throw error;
        const profilesByUser = new Map<string, { display_name: string; role: string }>();
        if (data.users.length) {
          const { data: profiles, error: profilesError } = await adminClient
            .from("profiles")
            .select("user_id, display_name, role")
            .in("user_id", data.users.map((user) => user.id));
          if (profilesError) throw profilesError;
          for (const item of profiles ?? []) profilesByUser.set(item.user_id, item);
        }
        return {
          users: data.users.map((user): AdminUser => ({
            id: user.id,
            email: user.email ?? "",
            displayName: profilesByUser.get(user.id)?.display_name ?? "",
            role: profilesByUser.get(user.id)?.role ?? "user",
            createdAt: user.created_at,
            lastSignInAt: user.last_sign_in_at ?? null,
            bannedUntil: user.banned_until ?? null,
          })),
          nextPage: data.nextPage,
        };
      };
      const search = typeof body.search === "string" ? body.search.trim().toLowerCase().slice(0, 100) : "";
      if (search) {
        const matches: AdminUser[] = [];
        let scanPage = 1;
        let nextPage: number | null = 1;
        while (nextPage !== null) {
          const result = await fetchUserPage(scanPage, 1000);
          matches.push(...result.users.filter((user) =>
            `${user.displayName} ${user.email}`.toLowerCase().includes(search)));
          nextPage = result.nextPage;
          scanPage += 1;
        }
        const start = (page - 1) * 50;
        return jsonResponse({
          users: matches.slice(start, start + 50),
          page,
          hasMore: matches.length > start + 50,
        });
      }
      const result = await fetchUserPage(page, 50);
      return jsonResponse({ users: result.users, page, hasMore: result.nextPage !== null });
    }

    if (!isUserId(body.userId)) return jsonResponse({ error: "A valid user ID is required." }, 400);

    if (body.action === "update-name") {
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (!displayName || displayName.length > 80) {
        return jsonResponse({ error: "Display names must be between 1 and 80 characters." }, 400);
      }
      const { data: updatedProfile, error } = await adminClient
        .from("profiles")
        .update({ display_name: displayName })
        .eq("user_id", body.userId)
        .select("user_id")
        .maybeSingle();
      if (error) throw error;
      if (!updatedProfile) return jsonResponse({ error: "User profile not found." }, 404);
      return jsonResponse({ message: "Display name updated." });
    }

    if (body.action === "set-ban") {
      if (typeof body.banned !== "boolean") return jsonResponse({ error: "A valid account status is required." }, 400);
      if (body.userId === caller.id && body.banned) {
        return jsonResponse({ error: "You cannot disable your own administrator account." }, 400);
      }
      const { error } = await adminClient.auth.admin.updateUserById(body.userId, {
        ban_duration: body.banned ? "876000h" : "none",
      });
      if (error) throw error;
      return jsonResponse({ message: body.banned ? "User account disabled." : "User account reactivated." });
    }

    if (body.action === "delete-user") {
      if (body.userId === caller.id) return jsonResponse({ error: "You cannot delete your own administrator account." }, 400);
      const { error } = await adminClient.auth.admin.deleteUser(body.userId);
      if (error) throw error;
      return jsonResponse({ message: "User account deleted." });
    }

    if (body.action === "send-password-reset") {
      const { data, error } = await adminClient.auth.admin.getUserById(body.userId);
      if (error) throw error;
      if (!data.user?.email) return jsonResponse({ error: "This user does not have an email address." }, 400);
      const publicClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: resetError } = await publicClient.auth.resetPasswordForEmail(data.user.email);
      if (resetError) throw resetError;
      return jsonResponse({ message: "Password reset email sent." });
    }

    return jsonResponse({ error: "Unsupported admin action." }, 400);
  } catch (error) {
    console.error("Admin user operation failed.", error);
    return jsonResponse({ error: "The admin operation could not be completed." }, 500);
  }
});
