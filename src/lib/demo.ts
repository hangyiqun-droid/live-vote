// Demo mode (DEMO_MODE=1): a public showcase deployment with made-up data. Read on the server only;
// screens learn about it from `demo` in the event state, so the flag never needs a NEXT_PUBLIC_ twin.
export const isDemo = () => process.env.DEMO_MODE === "1";
