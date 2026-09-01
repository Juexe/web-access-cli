import assert from "node:assert/strict";
import test from "node:test";
import { formatExtractMarkdown } from "../src/cli-output.ts";
import type { ExtractSuccessEnvelope } from "../src/core/types.ts";

function envelope(
	provider: string,
	sourceUrl: string,
	title: string,
	content: string,
): ExtractSuccessEnvelope {
	return {
		schemaVersion: 2,
		ok: true,
		provider,
		data: {
			document: {
				sourceUrl,
				title,
				content,
				contentType: "text/markdown",
			},
		},
	};
}

test("extract Markdown formatter uses ordered JSON-encoded front matter", () => {
	const output = formatExtractMarkdown(
		envelope(
			"local_http",
			'https://example.com/a"b\n---\\c',
			'  A "title"\nnext: value  ',
			"# Article content",
		),
	);
	assert.equal(
		output,
		`---\nprovider: "local_http"\nurl: ${JSON.stringify('https://example.com/a"b\n---\\c')}\ntitle: ${JSON.stringify('A "title"\nnext: value')}\n---\n\n# Article content\n`,
	);
});

test("extract Markdown formatter omits an empty title and preserves content", () => {
	assert.equal(
		formatExtractMarkdown(
			envelope("http", "https://example.com", " \n\t", "body\n\n"),
		),
		'---\nprovider: "http"\nurl: "https://example.com"\n---\n\nbody\n\n',
	);
});
