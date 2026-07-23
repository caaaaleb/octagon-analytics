import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = { title: "Log In — Octagon Analytics" };

export default function LoginPage() {
  return (
    <>
      <SiteHeader current="login" />
      <LoginForm />
    </>
  );
}
