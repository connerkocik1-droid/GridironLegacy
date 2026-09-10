import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: ["prototype/**", "design_handoff_pylon_home/**", "src/data/**", ".next/**", "node_modules/**"] },
  ...coreWebVitals,
  ...typescript,
];

export default config;
