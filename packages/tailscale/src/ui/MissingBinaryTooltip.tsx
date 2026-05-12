// Tooltip wrapper rendered around the pill when the host has no `tailscale`
// binary on PATH. Explains *why* the pill is greyed out and points the user
// at install steps for the distros most likely to be Felafel hosts.
//
// Extracted out of Pill.tsx so the pill component stays focused on
// stateful click-flow logic and the missing-binary branch can grow its
// own remediation copy without bloating the parent file.
import { ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@felafel/ui/components/ui/tooltip";

const INSTALL_URL = "https://tailscale.com/download/linux";

/**
 * Wrap the given pill in a tooltip that explains the missing-binary state
 * and surfaces install hints. Used only when {@link TailscaleStatus.kind}
 * is `"missing-binary"`.
 *
 * @param children - the pill JSX to anchor the tooltip on
 * @returns the wrapped pill
 */
export function MissingBinaryTooltip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- tooltip trigger needs to be focusable for keyboard a11y */}
          <span tabIndex={0}>{children}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm space-y-2 text-xs">
          <p>
            Felafel couldn&apos;t find the <code>tailscale</code> binary on <code>PATH</code>.
            Install it via your distro&apos;s package manager — <code>rpm-ostree install tailscale</code>{" "}
            on Bluefin/Silverblue, <code>sudo apt install tailscale</code> on Debian/Ubuntu.
            Tailscale runs as a system service so installation needs <code>sudo</code>.
          </p>
          <a
            href={INSTALL_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            Install instructions <ExternalLink className="size-3" />
          </a>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
