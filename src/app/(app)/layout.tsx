import type { ReactNode } from "react";
import Shell from "@/components/Shell";
import { THEME_INIT_SCRIPT, presetCss } from "@/lib/theme";

// Theme tokens and the pre-paint script are only emitted for the app shell, so /demo-target is left untouched.
const themeCss = presetCss();

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style href="rasq-theme" precedence="default">
        {themeCss}
      </style>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <Shell>{children}</Shell>
    </>
  );
}
