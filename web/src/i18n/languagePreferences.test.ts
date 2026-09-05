import { describe, expect, it } from "vitest";
import {
  resolveLanguagePreferenceRecord,
  type AppLanguagePreferenceRecord,
} from "./index";

function record(
  preference: AppLanguagePreferenceRecord["preference"],
  updatedAtMs: number,
): AppLanguagePreferenceRecord {
  return { schemaVersion: 1, preference, updatedAtMs };
}

describe("resolveLanguagePreferenceRecord", () => {
  it("migrates a legacy WebView preference when SQLite is empty", () => {
    expect(
      resolveLanguagePreferenceRecord(record("en-US", 0), null, 100),
    ).toEqual({
      record: record("en-US", 100),
      shouldPersist: true,
    });
  });

  it("repairs SQLite from a newer startup mirror", () => {
    expect(
      resolveLanguagePreferenceRecord(
        record("zh-CN", 200),
        record("en-US", 100),
        300,
      ),
    ).toEqual({
      record: record("zh-CN", 200),
      shouldPersist: true,
    });
  });

  it("uses SQLite when it is at least as recent as the startup mirror", () => {
    expect(
      resolveLanguagePreferenceRecord(
        record("zh-CN", 100),
        record("en-US", 200),
        300,
      ),
    ).toEqual({
      record: record("en-US", 200),
      shouldPersist: false,
    });
  });
});
