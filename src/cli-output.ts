import type { ExtractSuccessEnvelope, OutputEnvelope } from "./core/types.ts";

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

export function formatMarkdown(envelope: OutputEnvelope): string {
	if ("document" in (envelope as any).data) return formatExtractMarkdown(envelope as ExtractSuccessEnvelope);
	if ("results" in (envelope as any).data) {
		const e = envelope as any;
		return `---\nprovider: ${JSON.stringify(e.provider)}\nquery: ${JSON.stringify(e.data.query ?? "")}\n---\n\n${e.data.results.map((r: any, i: number) => `${i + 1}. [${r.title}](${r.url})${r.snippet ? `\n   ${r.snippet}` : ""}`).join("\n") || "无搜索结果"}\n`;
	}
	const e = envelope as any;
	return `# ${e.command ?? "结果"}\n\n${JSON.stringify(e.data, null, 2)}\n`;
}
