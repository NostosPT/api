// Seed fixtures (loadtest/.data/fixtures.json), loaded once and shared
// read-only across all VUs. One SharedArray per list: a SharedArray element
// is deserialized on every access, so big nested objects would be slow.
import { SharedArray } from "k6/data";

const PATH = __ENV.LT_FIXTURES ?? "../../.data/fixtures.json";

function list(name, select) {
	return new SharedArray(name, () => select(JSON.parse(open(PATH))));
}

const scalars = new SharedArray("scalars", () => {
	const f = JSON.parse(open(PATH));
	return [{ password: f.staff.password, accessCode: f.albumAccessCode }];
})[0];

export const fx = {
	password: scalars.password,
	accessCode: scalars.accessCode,
	staffAccounts: list("staffAccounts", (f) => f.staff.accounts),
	inviteTokens: list("inviteTokens", (f) => f.inviteTokens),
	gallerySlugs: list("gallerySlugs", (f) => f.public.gallerySlugs),
	photoNumbers: list("photoNumbers", (f) => f.public.photoNumbers),
	atlasSlugs: list("atlasSlugs", (f) => f.public.atlasSlugs),
	atlasCountries: list("atlasCountries", (f) => f.public.atlasCountries),
	categorySlugs: list("categorySlugs", (f) => f.public.categorySlugs),
	tagSlugs: list("tagSlugs", (f) => f.public.tagSlugs),
	serviceSlugs: list("serviceSlugs", (f) => f.public.serviceSlugs),
	searchWords: list("searchWords", (f) => f.public.searchWords),
	clientIds: list("clientIds", (f) => f.ids.clients),
	photoIds: list("photoIds", (f) => f.ids.photos),
	galleryIds: list("galleryIds", (f) => f.ids.galleries),
	requestIds: list("requestIds", (f) => f.ids.requests),
	purchaseIds: list("purchaseIds", (f) => f.ids.purchases),
	tagIds: list("tagIds", (f) => f.ids.tags),
	categoryIds: list("categoryIds", (f) => f.ids.categories),
	atlasIds: list("atlasIds", (f) => f.ids.atlas),
	userIds: list("userIds", (f) => f.ids.users),
	photographerIds: list("photographerIds", (f) => f.ids.photographers),
	albumSamples: list("albumSamples", (f) => f.albumSamples),
};
