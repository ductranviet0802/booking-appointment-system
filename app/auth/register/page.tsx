"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { getClientErrorMessage, useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";

function validatePassword(value: string) {
  if (value.length < 8) return "Mật khẩu phải có ít nhất 8 ký tự";
  if (!/[A-Z]/.test(value)) return "Mật khẩu phải chứa ít nhất 1 chữ in hoa";
  if (!/[0-9]/.test(value)) return "Mật khẩu phải chứa ít nhất 1 chữ số";
  return "";
}

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const { pushToast } = useToast();

  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    phone: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const passwordError = validatePassword(form.password);

    if (passwordError) {
      setError(passwordError);
      return;
    }

    setSubmitting(true);

    try {
      await register(form);
      pushToast("Đăng ký thành công");
      router.push("/bookings/me");
    } catch (submitError) {
      setError(getClientErrorMessage(submitError));
      pushToast(getClientErrorMessage(submitError), "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md" data-testid="register-page">
      <Card className="animate-fade-up space-y-4" data-testid="register-card">
        <h1 className="text-2xl font-black" data-testid="register-title">
          Đăng ký tài khoản
        </h1>

        <form className="space-y-3" onSubmit={onSubmit} data-testid="register-form">
          <Input
            type="text"
            required
            placeholder="Họ và tên"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            data-testid="register-input-name"
          />
          <Input
            type="email"
            required
            placeholder="Email"
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            data-testid="register-input-email"
          />
          <Input
            type="password"
            required
            placeholder="Mật khẩu"
            value={form.password}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            data-testid="register-input-password"
          />
          <Input
            type="text"
            placeholder="Số điện thoại"
            value={form.phone}
            onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            data-testid="register-input-phone"
          />

          {error ? (
            <p className="text-sm text-rose-600" data-testid="register-error">
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={submitting} className="w-full" data-testid="register-submit-button">
            Tạo tài khoản
          </Button>
        </form>

        <p className="text-sm text-zinc-600" data-testid="register-login-prompt">
          Đã có tài khoản?{" "}
          <Link
            href="/auth/login"
            prefetch={false}
            className="font-semibold text-teal-700 hover:text-teal-800"
            data-testid="register-login-link"
          >
            Đăng nhập
          </Link>
        </p>
      </Card>
    </div>
  );
}
