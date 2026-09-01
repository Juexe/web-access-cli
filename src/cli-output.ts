import type { ExtractSuccessEnvelope } from "./core/types.ts";

export type CliOutputMode = "json" | "markdown";

function yamlScalar(value: string): string {
	return JSON.stringify(value);
}

export function formatExtractMarkdown(
	envelope: ExtractSuccessEnvelope,
): string {
	const { document } = envelope.data;
	const lines = [
		"---",
		`provider: ${yamlScalar(envelope.provider)}`,
		`url: ${yamlScalar(document.sourceUrl)}`,
	];
	const title = document.title.trim();
	if (title) lines.push(`title: ${yamlScalar(title)}`);
	lines.push("---", "", "");
	const content = document.content;
	return `${lines.join("\n")}${content.endsWith("\n") ? content : `${content}\n`}`;
}
