// The canonical Verafy header, served from https://www.verafy.ai/header/v1/verafy-header.js.
// See verafy-website docs/HEADER.md.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type VerafyHeaderProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  product: string;
  links?: string;
  credits?: "shared" | "forecast" | "off";
  name?: string;
  mark?: string;
  home?: string;
  stage?: "alpha" | "beta" | "none";
};

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "verafy-header": VerafyHeaderProps;
    }
  }
}
