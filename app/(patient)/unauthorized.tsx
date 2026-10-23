// spec-screen: ER-05 (inside the patient layout, which draws CF-01; no valid session, so no patient name)
import { Er05 } from "@/components/frame/ErrorScreens";

export default function Unauthorized() {
  return <Er05 header={false} />;
}
