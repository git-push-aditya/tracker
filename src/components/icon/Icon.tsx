// Base for the icon set: 24×24 stroke icons that take their colour from the surrounding text (currentColor).
export type IconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & { size?: number };

export function Icon({ size = 16, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}
