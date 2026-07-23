"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type AuthActionState } from "@/lib/auth-actions";

const initialState: AuthActionState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className="mx-auto w-full max-w-sm px-6 py-16">
      <h1 className="mb-6 text-xl font-semibold">Log In</h1>
      <form action={formAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted">Email</label>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted">Password</label>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        {state.error && <p className="text-sm text-accent">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Logging in…" : "Log In"}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-accent hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
