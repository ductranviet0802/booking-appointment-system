import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";

const TONE = { grey: "eic-grey", red: "eic-red", amber: "eic-amber", blue: "eic-blue" } as const;

/** The centred block of every error frame: icon, title (item 28), message (29), links / buttons (30-32) */
export function ErrorBlock({
  icon,
  tone,
  title,
  message,
  children,
  testId,
  inFrame = false,
}: {
  icon: IconName;
  tone: keyof typeof TONE;
  title: string;
  message: string;
  children?: ReactNode;
  testId: string;
  /** inside a layout that already has <main> */
  inFrame?: boolean;
}) {
  const Tag = inFrame ? "div" : "main";
  return (
    <Tag className="eb" data-testid={testId}>
      <div className={`eic ${TONE[tone]}`}><Icon name={icon} size={30} /></div>
      <h1>{title}</h1>
      <p>{message}</p>
      {children}
    </Tag>
  );
}
