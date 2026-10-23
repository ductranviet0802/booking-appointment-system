"use client";

// spec-screen: ER-02
// Last-resort boundary (errors thrown by a route-group layout). The group boundaries in (patient)/ and (staff)/ keep their header.
import { Er02 } from "@/components/frame/Er02";

export default function ErrorPage() {
  return <Er02 />;
}
