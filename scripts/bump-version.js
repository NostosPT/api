import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");
const apiVersionPath = path.join(rootDir, "src/config/api-version.ts");

export function bumpSemver(version, type = "patch") {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
	if (!match) {
		throw new Error(`Invalid semver version: ${version}`);
	}

	let major = Number(match[1]);
	let minor = Number(match[2]);
	let patch = Number(match[3]);

	if (type === "major") {
		major += 1;
		minor = 0;
		patch = 0;
	} else if (type === "minor") {
		minor += 1;
		patch = 0;
	} else if (type === "patch") {
		patch += 1;
	} else if (/^\d+\.\d+\.\d+/.test(type)) {
		return type;
	} else {
		throw new Error(`Unsupported bump type: ${type}`);
	}

	return `${major}.${minor}.${patch}`;
}

export function bumpVersion(bumpType = "patch", options = {}) {
	const pkgPath = options.packageJsonPath || packageJsonPath;
	const verPath = options.apiVersionPath || apiVersionPath;

	const rawPkg = fs.readFileSync(pkgPath, "utf-8");
	const pkg = JSON.parse(rawPkg);
	const currentVersion = pkg.version;
	const newVersion = bumpSemver(currentVersion, bumpType);

	pkg.version = newVersion;
	fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n", "utf-8");

	if (fs.existsSync(verPath)) {
		let apiVersionContent = fs.readFileSync(verPath, "utf-8");
		const versionRegex = /export const API_VERSION = "([^"]+)";/;
		if (versionRegex.test(apiVersionContent)) {
			apiVersionContent = apiVersionContent.replace(
				versionRegex,
				`export const API_VERSION = "${newVersion}";`,
			);
		} else {
			apiVersionContent += `\n/**\n * Semantic version of the API, updated automatically by CI on PR merges.\n */\nexport const API_VERSION = "${newVersion}";\n`;
		}
		fs.writeFileSync(verPath, apiVersionContent, "utf-8");
	}

	return { currentVersion, newVersion };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	const bumpType = process.argv[2] || "patch";
	const { currentVersion, newVersion } = bumpVersion(bumpType);
	console.log(`Bumped version from ${currentVersion} to ${newVersion}`);
	if (process.env.GITHUB_OUTPUT) {
		fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${newVersion}\n`);
	}
}
