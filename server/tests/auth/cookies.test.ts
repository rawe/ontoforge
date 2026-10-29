import { describe, expect, it } from "vitest";

import { clearedCookie, cookieNames, loginCookie, newSessionId, sessionCookie } from "../../src/auth/cookies.js";
import { normalizeReturnTo } from "../../src/auth/router.js";

describe("cookie names", () => {
  it("carry the port of WEB_CLIENT_URL, the scheme's default when it names none", () => {
    expect(cookieNames("http://localhost:5173")).toEqual({
      session: "ontoforge_session_5173",
      login: "ontoforge_login_5173",
    });
    expect(cookieNames("https://ontoforge.example.com").session).toBe("ontoforge_session_443");
    expect(cookieNames("http://app.localhost").session).toBe("ontoforge_session_80");
  });
});

describe("cookie attributes", () => {
  it("make the session cookie a host-only browser-session cookie for every path", () => {
    expect(sessionCookie("ontoforge_session_5173", "abc")).toBe(
      "ontoforge_session_5173=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("keep the login cookie to the sign-in routes and its ten minutes", () => {
    expect(loginCookie("ontoforge_login_5173", "x", 600)).toBe(
      "ontoforge_login_5173=x; Path=/api/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax",
    );
    expect(clearedCookie("ontoforge_login_5173", "/api/auth")).toBe(
      "ontoforge_login_5173=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("make a session id of 32 random bytes", () => {
    const id = newSessionId();
    expect(Buffer.from(id, "base64url")).toHaveLength(32);
    expect(newSessionId()).not.toBe(id);
  });
});

describe("returnTo", () => {
  const base = "http://localhost:5173";

  it("keeps a path with its query on the deployment's origin", () => {
    expect(normalizeReturnTo("/studio/o/model?tab=lenses#top", base)).toBe("/studio/o/model?tab=lenses");
    expect(normalizeReturnTo("workbench", base)).toBe("/workbench");
    expect(normalizeReturnTo("http://localhost:5173/x?y=1", base)).toBe("/x?y=1");
  });

  it("becomes / for anything else", () => {
    for (const value of [
      undefined,
      "",
      "//evil.example.com/x",
      "https://evil.example.com/",
      "http://localhost:8000/x",
      "/\\evil.example.com",
      "\\\\evil.example.com",
      "/x\ny",
      "/\t/evil.example.com",
      "javascript:alert(1)",
      "http://[bad",
    ]) {
      expect(normalizeReturnTo(value, base), String(value)).toBe("/");
    }
  });
});
