import { sleep } from 'yootils';

export let packagesUrl = 'https://unpkg.com';

const fetch_cache = new Map();

async function fetch_if_uncached(url) {
	if (fetch_cache.has(url)) {
		return fetch_cache.get(url);
	}

	await sleep(200);

	const promise = fetch(url)
		.then(async (r) => {
			if (r.ok) {
				return {
					url: r.url,
					body: await r.text()
				};
			}

			throw new Error(await r.text());
		})
		.catch((err) => {
			fetch_cache.delete(url);
			throw err;
		});

	fetch_cache.set(url, promise);
	return promise;
}

async function follow_redirects(url) {
	const res = await fetch_if_uncached(url);
	return res.url;
}

const decoder = new TextDecoder();

export const plugin = (files) => ({
	name: 'loader',
	async resolveId(importee, importer) {
		// importing from provided data
		if (files.find((file) => file[0] == importee)) {
			return importee;
		}

		// remove trailing slash
		if (importee.endsWith('/')) importee = importee.slice(0, -1);

		// importing from a URL
		if (importee.startsWith('http:') || importee.startsWith('https:')) return importee;

		// importing from (probably) unpkg
		if (importee.startsWith('.')) {
			const url = new URL(importee, importer).href;
			return await follow_redirects(url);
		} else {
			// fetch from unpkg
			try {
				const pkg_url = await follow_redirects(`${packagesUrl}/${importee}/package.json`);
				const pkg_json = (await fetch_if_uncached(pkg_url)).body;
				const pkg = JSON.parse(pkg_json);

				if (pkg.svelte || pkg.module || pkg.main) {
					const url = pkg_url.replace(/\/package\.json$/, '');
					return new URL(pkg.svelte || pkg.module || pkg.main, `${url}/`).href;
				}
			} catch (err) {
				// ignore
			}

			return await follow_redirects(`${packagesUrl}/${importee}`);
		}

		return importee; // catch all
	},
	async load(id) {
		let match = files.find((file) => file[0] == id); // If no values satisfy the testing function, undefined is returned.
		if (match) {
			// check if it's a string
			if (typeof match[1] === 'string') return match[1];
			return decoder.decode(match[1]);
		}

		const res = await fetch_if_uncached(id);
		return res.body;
	},
	async transform(code, id) {
		// only transform the code if it's a `.js` file
		if (!id.endsWith('.js')) return;

		let matches = code.match(/new URL\((.*)/g);
		if (!matches || !matches.length) return;

		// for each match in matches, replace `new URL('./${fileName}', import.meta.url)` with a Blob URL of the bytes
		matches.forEach((match) => {
			let fileName = match.match(/'.\/(.*)'/)[1];
			if (!fileName.endsWith('.wasm')) return;

			let found = files.find((file) => file[0] == fileName); // If no values satisfy the testing function, undefined is returned.

			if (!found) return;

			// make a blob url of the bytes of the wasm file
			let wasmBlobUrl = URL.createObjectURL(new Blob([found[1]], { type: 'application/wasm' }));

			// return if undefined
			if (!wasmBlobUrl || wasmBlobUrl == 'undefined') return;

			// find and replace
			code = code.replace(`new URL('./${fileName}', import.meta.url)`, `'${wasmBlobUrl}'`);
		});

		return {
			code,
			map: { mappings: '' } // TODO: use https://github.com/Rich-Harris/magic-string
		};
	}
});

export default plugin;
