export function bumpSemver(version: string, type?: string): string;

export function bumpVersion(
	bumpType?: string,
	options?: { packageJsonPath?: string; apiVersionPath?: string },
): { currentVersion: string; newVersion: string };
