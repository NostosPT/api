export function int(min, max) {
	return min + Math.floor(Math.random() * (max - min + 1));
}

export function pick(items) {
	return items[Math.floor(Math.random() * items.length)];
}

export function chance(p) {
	return Math.random() < p;
}

// weighted([[weight, value], ...])
export function weighted(entries) {
	const total = entries.reduce((sum, [w]) => sum + w, 0);
	let roll = Math.random() * total;

	for (const [weight, value] of entries) {
		roll -= weight;

		if (roll <= 0) {
			return value;
		}
	}

	return entries[entries.length - 1][1];
}

export function uid() {
	return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function isoDaysFromNow(days) {
	return new Date(Date.now() + days * 86_400_000).toISOString();
}
