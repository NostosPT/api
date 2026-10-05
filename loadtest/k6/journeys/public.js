// Anonymous website visitor. One iteration = one page view, i.e. the API calls
// the website makes to render that page. The page mix approximates browsing
// the public archive; visitor think time between pages is applied outside
// k6 (open model: page views arrive at a fixed rate whatever the latency),
// and converted to concurrent visitors in the report.
import { api, json } from "../lib/http.js";
import { fx } from "../lib/fixtures.js";
import { chance, int, pick, uid, weighted } from "../lib/random.js";

function photoListQuery() {
	const params = [`page=${weighted([[60, 1], [25, 2], [10, 3], [5, int(4, 20)]])}`, `pageSize=${pick([24, 24, 48])}`];

	if (chance(0.3)) {
		params.push(`category=${pick(fx.categorySlugs)}`);
	}

	if (chance(0.15)) {
		params.push(`tag=${pick(fx.tagSlugs)}`);
	}

	if (chance(0.1)) {
		params.push(`gallery=${pick(fx.gallerySlugs)}`);
	}

	if (chance(0.1)) {
		const year = int(2021, 2026);
		params.push(`takenFrom=${year}-01-01`, `takenTo=${year}-12-31`);
	}

	params.push(`sort=${weighted([[60, "newest"], [20, "oldest"], [20, "featured"]])}`);

	return params.join("&");
}

const PAGES = [
	[15, "home"],
	[10, "galleries"],
	[20, "gallery"],
	[18, "archive"],
	[5, "search"],
	[22, "photo"],
	[4, "atlas"],
	[3, "atlasLocation"],
	[2.5, "services"],
	[0.5, "requestForm"],
];

export function publicPageView(ctx) {
	const o = { ip: ctx.ip, kind: "public" };
	const page = weighted(PAGES);

	switch (page) {
		case "home":
			api("GET", "/public/galleries", "/public/galleries?pageSize=12", o);
			api("GET", "/public/photos", "/public/photos?sort=featured&pageSize=12", o);
			break;

		case "galleries":
			api("GET", "/public/galleries", `/public/galleries?page=${weighted([[80, 1], [15, 2], [5, 3]])}&pageSize=24`, o);
			break;

		case "gallery":
			api("GET", "/public/galleries/:slug", `/public/galleries/${pick(fx.gallerySlugs)}`, o);
			break;

		case "archive":
			api("GET", "/public/photos", `/public/photos?${photoListQuery()}`, o);
			break;

		case "search": {
			const q = chance(0.15) ? String(pick(fx.photoNumbers)) : pick(fx.searchWords);
			api("GET", "/public/photos", `/public/photos?q=${encodeURIComponent(q)}&pageSize=24`, o);
			break;
		}

		case "photo":
			api("GET", "/public/photos/:number", `/public/photos/${pick(fx.photoNumbers)}`, o);
			break;

		case "atlas": {
			const filter = weighted([
				[50, ""],
				[20, `&country=${pick(fx.atlasCountries)}`],
				[15, `&category=${pick(fx.categorySlugs)}`],
				[15, "&bbox=-9.6,37.0,-6.2,42.2"],
			]);
			api("GET", "/public/atlas/locations", `/public/atlas/locations?pageSize=50${filter}`, o);
			break;
		}

		case "atlasLocation":
			api("GET", "/public/atlas/locations/:slug", `/public/atlas/locations/${pick(fx.atlasSlugs)}`, o);
			break;

		case "services":
			api("GET", "/services", "/services", o);
			api("GET", "/services/:slug", `/services/${pick(fx.serviceSlugs)}`, o);
			break;

		case "requestForm": {
			const services = json(api("GET", "/services", "/services", o));
			const slug = services?.items?.[0] ? pick(services.items).slug : pick(fx.serviceSlugs);
			// Most submissions come from new contacts; some from returning clients.
			const email = `visitor-${uid()}@visitors.nostos.test`;
			api("POST", "/service-requests", "/service-requests", {
				...o,
				body: {
					service: slug,
					preferredDate: new Date(Date.now() + int(20, 300) * 86_400_000).toISOString(),
					location: "Lisboa",
					budgetMin: int(300, 1500),
					budgetMax: int(1500, 5000),
					contact: { name: "Load Test Visitor", email, phone: "+351910000000", preferredContact: "email" },
					answers: { guests: String(int(10, 200)), notes: "Load test submission" },
				},
			});
			break;
		}
	}
}
