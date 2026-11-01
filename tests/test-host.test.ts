// The "test database only" guard of the database-writing scripts compares the host, not a substring
import { describe, expect, it } from "vitest";
import { isTestHost } from "@/db/test-host";

const N = "ep-example-test-123456";

describe("isTestHost", () => {
  it("accepts the test database's direct host", () => {
    expect(isTestHost(`postgres://u:p@${N}.c-3.ap-southeast-1.aws.neon.tech/db?sslmode=require`, N)).toBe(true);
  });

  it("rejects a URL that only mentions the name somewhere else", () => {
    for (const url of [
      `postgres://qa:fake@127.0.0.1:1/qa?application_name=${N}`,
      `postgres://${N}:pw@ep-other-branch-123.c-3.ap-southeast-1.aws.neon.tech/db`,
      `postgres://u:p@ep-other-branch-123.c-3.ap-southeast-1.aws.neon.tech/${N}`,
      `postgres://u:p@ep-other-branch-123.c-3.ap-southeast-1.aws.neon.tech/db#${N}`,
      `postgres://u:p@x${N}.evil.example.com.attacker.test/db`,
      `postgres://u:p@prefix-${N}.c-3.ap-southeast-1.aws.neon.tech/db`,
      `postgres://u:p@${N}-pooler.c-3.ap-southeast-1.aws.neon.tech/db`,
    ]) {
      expect(isTestHost(url, N), url).toBe(false);
    }
  });

  it("rejects empty, unset and malformed input", () => {
    expect(isTestHost(undefined, N)).toBe(false);
    expect(isTestHost("", N)).toBe(false);
    expect(isTestHost("not a url", N)).toBe(false);
    expect(isTestHost(N, N)).toBe(false); // a bare name is not a URL
    expect(isTestHost(`postgres://u:p@${N}.c-3.aws.neon.tech/db`, "")).toBe(false); // no TEST_DB_HOST set
  });
});
