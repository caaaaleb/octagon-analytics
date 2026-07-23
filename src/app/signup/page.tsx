import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { SignupForm } from "@/components/SignupForm";

export const metadata: Metadata = { title: "Sign Up — Octagon Analytics" };

export default function SignupPage() {
  return (
    <>
      <SiteHeader current="signup" />
      <SignupForm />
    </>
  );
}
