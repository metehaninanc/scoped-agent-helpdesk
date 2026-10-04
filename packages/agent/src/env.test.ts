import { describe, expect, it } from "vitest";

import { AGENT_AUTH_PATH_MISMATCH, agentSubprocessEnv, assertAgentAuthPath } from "./env.js";

describe("agentSubprocessEnv()", () => {
  it("leaves options.env unset by default, so the subprocess inherits process.env and the API key as it always has", () => {
    expect(agentSubprocessEnv({ ANTHROPIC_API_KEY: "sk-test", PATH: "/bin" })).toBeUndefined();
  });

  it("in session mode returns a full copy of the environment minus the API key, never a partial object", () => {
    const env = agentSubprocessEnv({ HELPDESK_AGENT_AUTH: "session", ANTHROPIC_API_KEY: "sk-test", PATH: "/bin", AZURE_TENANT_ID: "t" });
    expect(env).toEqual({ HELPDESK_AGENT_AUTH: "session", PATH: "/bin", AZURE_TENANT_ID: "t" });
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("treats any other value of the variable as the default, not as session", () => {
    expect(agentSubprocessEnv({ HELPDESK_AGENT_AUTH: "api-key", ANTHROPIC_API_KEY: "sk-test" })).toBeUndefined();
  });
});

describe("assertAgentAuthPath()", () => {
  const session = { HELPDESK_AGENT_AUTH: "session" };

  it("accepts the login session in session mode — the SDK reports it as no API key", () => {
    expect(() => assertAgentAuthPath("none", session)).not.toThrow();
  });

  it.each(["ANTHROPIC_API_KEY", "apiKeyHelper"])("refuses an API key arriving by another route in session mode: %s", (source) => {
    expect(() => assertAgentAuthPath(source, session)).toThrow(AGENT_AUTH_PATH_MISMATCH);
  });

  it("checks nothing outside session mode, where the API key is the intended credential", () => {
    expect(() => assertAgentAuthPath("ANTHROPIC_API_KEY", {})).not.toThrow();
  });
});
