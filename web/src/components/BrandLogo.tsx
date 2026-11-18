import type { LogoMap, SerializedLogo } from "@/lib/logos";
import { getBundledModelLogo, getBundledToolLogo, lookupModelLogo } from "@/lib/logos";

interface SvgIconProps {
  viewBox: string;
  body: string;
  size: number;
  className?: string;
}

function InlineSvgIcon({ viewBox, body, size, className }: SvgIconProps) {
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={className ? `brand-logo ${className}` : "brand-logo"}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

function FallbackGlyph({ kind, size, className }: { kind: "model" | "tool"; size: number; className?: string }) {
  // Subtle monochrome outline fallback keeps table/list columns aligned when an unknown tool or unbranded local model appears.
  const body =
    kind === "tool"
      ? '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.6"/><path d="M8 9.5l3 2.5-3 2.5M12.5 14.5h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M12 3.25l7.5 4.35v8.8L12 20.75 4.5 16.4V7.6L12 3.25Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.1" fill="currentColor"/>';
  return (
    <InlineSvgIcon
      viewBox="0 0 24 24"
      body={body}
      size={size}
      className={className ? `brand-logo-fallback ${className}` : "brand-logo-fallback"}
    />
  );
}

/** Monochrome theme-adaptive SVG logo for an AI model's creator lab or provider. */
export function ModelLogo({
  model,
  logo,
  logoMap,
  size = 14,
  className,
}: {
  model: string;
  logo?: SerializedLogo | null;
  logoMap?: LogoMap | null;
  size?: number;
  className?: string;
}) {
  const resolved = logo ?? lookupModelLogo(model, logoMap);
  const svg = resolved ? (resolved.svg ?? getBundledModelLogo(resolved.id)) : null;

  if (svg) {
    return <InlineSvgIcon viewBox={svg.viewBox} body={svg.body} size={size} className={className} />;
  }

  if (resolved?.id) {
    const url = `url("/api/logos/model/${encodeURIComponent(resolved.id)}")`;
    return (
      <span
        aria-hidden="true"
        className={className ? `brand-logo brand-logo-mask ${className}` : "brand-logo brand-logo-mask"}
        style={{
          width: size,
          height: size,
          ["--brand-logo-url" as string]: url,
        }}
      />
    );
  }

  return <FallbackGlyph kind="model" size={size} className={className} />;
}

/** Monochrome theme-adaptive SVG logo for a coding CLI / AI agent tool. */
export function ToolLogo({
  tool,
  size = 14,
  className,
}: {
  tool: string;
  size?: number;
  className?: string;
}) {
  const bundled = getBundledToolLogo(tool);
  if (bundled) {
    return (
      <InlineSvgIcon
        viewBox={bundled.svg.viewBox}
        body={bundled.svg.body}
        size={size}
        className={className}
      />
    );
  }
  return <FallbackGlyph kind="tool" size={size} className={className} />;
}

/** Inline model logo + text label aligned horizontally. */
export function ModelName({
  model,
  label,
  logo,
  logoMap,
  size = 14,
  className,
  labelClassName,
}: {
  model: string;
  label?: string;
  logo?: SerializedLogo | null;
  logoMap?: LogoMap | null;
  size?: number;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <span className={className ? `brand-item ${className}` : "brand-item"}>
      <ModelLogo model={model} logo={logo} logoMap={logoMap} size={size} />
      <span className={labelClassName ?? "brand-label"}>{label ?? model}</span>
    </span>
  );
}

/** Inline tool logo + text label aligned horizontally. */
export function ToolName({
  tool,
  label,
  size = 14,
  className,
  labelClassName,
}: {
  tool: string;
  label?: string;
  size?: number;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <span className={className ? `brand-item ${className}` : "brand-item"}>
      <ToolLogo tool={tool} size={size} />
      <span className={labelClassName ?? "brand-label"}>{label ?? tool}</span>
    </span>
  );
}
