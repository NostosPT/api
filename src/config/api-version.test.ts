import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bumpSemver, bumpVersion } from "../../scripts/bump-version.js";
import { API_VERSION, CURRENT_API_VERSION } from "./api-version.js";

describe("api-version constants", () => {
	it("defines CURRENT_API_VERSION as v1", () => {
		expect(CURRENT_API_VERSION).toBe("v1");
	});

	it("defines API_VERSION in semver format", () => {
		expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});

describe("bumpSemver", () => {
	it("increments patch version by default", () => {
		expect(bumpSemver("1.0.0", "patch")).toBe("1.0.1");
		expect(bumpSemver("1.2.9", "patch")).toBe("1.2.10");
	});

	it("increments minor version and resets patch", () => {
		expect(bumpSemver("1.0.5", "minor")).toBe("1.1.0");
	});

	it("increments major version and resets minor and patch", () => {
		expect(bumpSemver("1.4.5", "major")).toBe("2.0.0");
	});

	it("accepts an explicit semver string", () => {
		expect(bumpSemver("1.0.0", "2.5.0")).toBe("2.5.0");
	});

	it("throws on invalid version or unsupported bump type", () => {
		expect(() => bumpSemver("invalid")).toThrow(/Invalid semver version/);
		expect(() => bumpSemver("1.0.0", "invalid")).toThrow(/Unsupported bump type/);
	});
});

describe("bumpVersion file updates", () => {
	it("updates package.json and api-version.ts in a temporary directory", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bump-version-test-"));
		const fakePkg = path.join(tempDir, "package.json");
		const fakeVer = path.join(tempDir, "api-version.ts");

		fs.writeFileSync(fakePkg, JSON.stringify({ name: "test", version: "1.2.3" }, null, "\t") + "\n");
		fs.writeFileSync(
			fakeVer,
			`export const CURRENT_API_VERSION = "v1";\nexport const API_VERSION = "1.2.3";\n`,
		);

		const result = bumpVersion("patch", {
			packageJsonPath: fakePkg,
			apiVersionPath: fakeVer,
		});

		expect(result.currentVersion).toBe("1.2.3");
		expect(result.newVersion).toBe("1.2.4");

		const updatedPkg = JSON.parse(fs.readFileSync(fakePkg, "utf-8"));
		expect(updatedPkg.version).toBe("1.2.4");

		const updatedVer = fs.readFileSync(fakeVer, "utf-8");
		expect(updatedVer).toContain('export const API_VERSION = "1.2.4";');
		expect(updatedVer).toContain('export const CURRENT_API_VERSION = "v1";');

		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
