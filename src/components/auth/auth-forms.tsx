"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loginAction,
  registerAction,
  type ActionResult,
} from "@/lib/auth/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {state && !state.ok ? (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    registerAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <Input
        label="Name"
        name="name"
        type="text"
        autoComplete="name"
        required
        error={state?.ok === false ? state.fieldErrors?.name?.[0] : undefined}
      />
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state?.ok === false ? state.fieldErrors?.email?.[0] : undefined}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        error={
          state?.ok === false ? state.fieldErrors?.password?.[0] : undefined
        }
      />
      {state && !state.ok && !state.fieldErrors ? (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
