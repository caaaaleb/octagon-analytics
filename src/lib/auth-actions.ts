"use server";

// Email/password auth via Supabase — signUp() returns a session immediately
// if the project's "Confirm email" setting is off, or null if it requires
// clicking a confirmation link first. Handling both branches here means
// this works correctly either way, without assuming which mode the Supabase
// project is configured for.
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export type AuthActionState = { error?: string; message?: string };

export async function signup(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  if (data.session) redirect("/picks");
  return { message: "Check your email to confirm your account, then log in." };
}

export async function login(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect("/picks");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
