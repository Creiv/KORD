import type { ReactNode } from "react";

export function SectionHeadLead({
  eyebrow,
  title,
  icon,
}: {
  eyebrow: string;
  title: string;
  icon?: ReactNode;
}) {
  if (icon) {
    return (
      <div className="section-head__lead">
        <span className="section-head__icon-wrap" aria-hidden>
          {icon}
        </span>
        <div className="section-head__text">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  );
}
