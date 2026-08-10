"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { getClientErrorMessage, useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { pushToast } = useToast();

  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await login(form);
      pushToast("Đăng nhập thành công");
      router.refresh();
      router.push("/bookings/me");
    } catch (submitError) {
      const message = getClientErrorMessage(submitError);
      setError(message);
      pushToast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="login-page" className="mx-auto w-full max-w-md">
      <Card data-testid="login-card" className="animate-fade-up space-y-4">
        <h1 data-testid="login-title" className="text-2xl font-black">
          Đăng nhập
        </h1>

        <form data-testid="login-form" className="space-y-3" onSubmit={onSubmit}>
          <Input
            data-testid="login-email-input"
            type="text"
            required
            placeholder="Email hoặc username"
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          />
          <Input
            data-testid="login-password-input"
            type="password"
            required
            placeholder="Mật khẩu"
            value={form.password}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
          />

          {error ? (
            <p data-testid="login-error" className="text-sm text-rose-600">
              {error}
            </p>
          ) : null}

          <Button data-testid="login-submit-button" type="submit" loading={submitting} className="w-full">
            Đăng nhập
          </Button>
        </form>

        <p data-testid="login-register-hint" className="text-sm text-zinc-600">
          Chưa có tài khoản?{" "}
          <Link
            data-testid="login-register-link"
            href="/auth/register"
            prefetch={false}
            className="font-semibold text-teal-700 hover:text-teal-800"
          >
            Đăng ký
          </Link>
        </p>
      </Card>
    </div>
  );
}
