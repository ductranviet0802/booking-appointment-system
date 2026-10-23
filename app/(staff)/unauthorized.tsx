// spec-screen: ER-05 (inside the staff layout, which draws CF-01 without a session)
import { Er05 } from "@/components/frame/ErrorScreens";

export default function Unauthorized() {
  return <Er05 header={false} />;
}
