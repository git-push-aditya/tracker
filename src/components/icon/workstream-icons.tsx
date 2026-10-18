import { Icon, type IconProps } from "./Icon";

/** Product: a cube (something you build and ship) */
export const ProductIcon = (p: IconProps) => (
  <Icon {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></Icon>
);
/** Tech integrations: a plug */
export const TechIcon = (p: IconProps) => (
  <Icon {...p}><path d="M9 2v6M15 2v6" /><path d="M6 8h12v4a6 6 0 0 1-12 0V8z" /><path d="M12 18v4" /></Icon>
);
/** Growth & CRM: rising line */
export const GrowthIcon = (p: IconProps) => (
  <Icon {...p}><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></Icon>
);
/** Sales: a dollar coin */
export const SalesIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><path d="M15 9.5c0-1.4-1.3-2-3-2s-3 .7-3 2 1.3 1.9 3 2.5 3 1.1 3 2.5-1.3 2-3 2-3-.6-3-2" /><path d="M12 6v1.5M12 16.5V18" /></Icon>
);
/** Social media: connected nodes (sharing) */
export const SocialIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></Icon>
);
/** Media planner: a calendar with a play mark */
export const MediaIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M10 13.5v4l3.5-2z" /></Icon>
);
/** Hiring: a person with a plus */
export const HiringIcon = (p: IconProps) => (
  <Icon {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M16 11h6" /></Icon>
);
/** Anything else (new workstreams): a folder */
export const FolderIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>
);

const BY_KEY = { product: ProductIcon, tech: TechIcon, growth: GrowthIcon, sales: SalesIcon, social: SocialIcon, media: MediaIcon, hiring: HiringIcon };

/** Picks an icon for a workstream: by its seeded id, then by a keyword in its name, else a folder. */
export function WorkstreamIcon({ id, name, ...props }: IconProps & { id: string; name: string }) {
  const key = (Object.keys(BY_KEY) as (keyof typeof BY_KEY)[]).find((k) => k === id || name.toLowerCase().includes(k));
  const C = key ? BY_KEY[key] : FolderIcon;
  return <C {...props} />;
}
