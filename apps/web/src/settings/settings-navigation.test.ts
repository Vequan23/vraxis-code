import assert from "node:assert/strict";
import test from "node:test";
import { isSettingsSectionId, settingsNavItem } from "./settings-navigation.js";

test("resolves settings navigation metadata", () => {
  assert.equal(settingsNavItem("harnesses").label, "Harnesses");
  assert.equal(isSettingsSectionId("metrics"), true);
  assert.equal(isSettingsSectionId("unknown"), false);
});
