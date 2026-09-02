#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
	Command,
	CommanderError,
	InvalidArgumentError,
	Option,
} from "commander";
import { type CliOutputMode, formatExtractMarkdown } from "./cli-output.ts";
import { loadConfig } from "./config/config.ts";
import { executeConfigEdit } from "./config/edit.ts";
import { createProviderOrderWriter } from "./config/provider-order.ts";
import { executeDoctor, executeProviders } from "./core/diagnostics.ts";
import { asWebAccessError, WebAccessError } from "./core/errors.ts";
import { errorEnvelope, executeExtract, executeSearch } from "./core/router.ts";
import type {
	Command as EnvelopeCommand,
	ExtractRequest,
	ExtractSuccessEnvelope,
	OutputEnvelope,
	SearchFreshness,
	SearchRequest,
} from "./core/types.ts";
import { COMMANDS } from "./core/types.ts";
import { normalizeDomains } from "./providers/common.ts";
import { VERSION } from "./version.ts";

interface GlobalOptions {
	config?: string;
	pretty?: boolean;
}

interface CliDependencies {
	executeConfigEdit?: typeof executeConfigEdit;
}

function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}

function integer(value: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		throw new InvalidArgumentError("必须是大于 0 的整数");
	return parsed;
}

function httpUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new WebAccessError("invalid_input", "url 必须是合法的绝对 URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new WebAccessError("invalid_input", "url 必须使用 http 或 https");
	return url.toString();
}

function exitCode(envelope: OutputEnvelope): number {
	if (envelope.ok) return 0;
	if (envelope.error.code === "aborted") return 130;
	if (
		[
			"invalid_input",
			"config_error",
			"provider_unknown",
			"provider_disabled",
		].includes(envelope.error.code)
	)
		return 2;
	return 1;
}

function writeEnvelope(envelope: OutputEnvelope, pretty: boolean): void {
	process.stdout.write(
		`${JSON.stringify(envelope, null, pretty ? 2 : undefined)}\n`,
	);
}

function writeOutput(
	envelope: OutputEnvelope,
	mode: CliOutputMode,
	pretty: boolean,
): void {
	if (mode === "markdown" && isExtractSuccessEnvelope(envelope)) {
		process.stdout.write(formatExtractMarkdown(envelope));
		return;
	}
	writeEnvelope(envelope, pretty);
}

function isExtractSuccessEnvelope(
	envelope: OutputEnvelope,
): envelope is ExtractSuccessEnvelope {
	return (
		envelope.ok &&
		"provider" in envelope &&
		typeof envelope.provider === "string" &&
		"data" in envelope &&
		typeof envelope.data === "object" &&
		envelope.data !== null &&
		"document" in envelope.data &&
		typeof envelope.data.document === "object" &&
		envelope.data.document !== null &&
		"sourceUrl" in envelope.data.document &&
		typeof envelope.data.document.sourceUrl === "string" &&
		"title" in envelope.data.document &&
		typeof envelope.data.document.title === "string" &&
		"content" in envelope.data.document &&
		typeof envelope.data.document.content === "string" &&
		"contentType" in envelope.data.document &&
		envelope.data.document.contentType === "text/markdown"
	);
}

export function createProgram(
	run: (
		task: () => Promise<OutputEnvelope> | OutputEnvelope,
		mode?: CliOutputMode,
	) => void,
	dependencies: CliDependencies = {},
): Command {
	const program = new Command();
	const runConfigEdit = dependencies.executeConfigEdit ?? executeConfigEdit;
	program
		.name("web-access")
		.description("Agent-neutral 的网页搜索与内容提取 CLI")
		.version(VERSION)
		.option("--config <path>", "指定 JSON 配置文件")
		.option("--pretty", "格式化 JSON 输出；extract 同时选择 JSON 模式", false)
		.showSuggestionAfterError();
	program.configureOutput({ writeErr: () => {}, outputError: () => {} });
	program.exitOverride();

	program
		.command("search")
		.description("搜索网页")
		.argument("<query>", "搜索关键词")
		.option("-p, --provider <id>", "provider instance id，或 auto", "auto")
		.option("-l, --limit <number>", "结果数量（1-20）", integer)
		.addOption(
			new Option("--freshness <window>", "时间范围").choices([
				"day",
				"month",
				"year",
			]),
		)
		.option("--include-domain <domain>", "仅包含域名，可重复", collect, [])
		.option("--exclude-domain <domain>", "排除域名，可重复", collect, [])
		.option("--timeout <milliseconds>", "总超时毫秒数", integer)
		.option("--debug", "输出完整路由和脱敏原始响应", false)
		.action(
			(
				query: string,
				options: {
					provider: string;
					limit?: number;
					freshness?: SearchFreshness;
					includeDomain: string[];
					excludeDomain: string[];
					timeout?: number;
					debug: boolean;
				},
			) => {
				run(async () => {
					const globals = program.opts<GlobalOptions>();
					const loaded = loadConfig(globals.config);
					const request: SearchRequest = {
						query: query.trim(),
						provider: options.provider.toLowerCase(),
						limit: options.limit ?? loaded.app.search.limit,
						freshness: options.freshness,
						includeDomains: normalizeDomains(options.includeDomain),
						excludeDomains: normalizeDomains(options.excludeDomain),
						timeoutMs: options.timeout,
					};
					if (!request.query)
						throw new WebAccessError("invalid_input", "query 不能为空");
					if (request.limit > 20)
						throw new WebAccessError("invalid_input", "limit 不能超过 20");
					return executeSearch(request, {
						loaded,
						signal: processSignal.signal,
						debug: options.debug,
						persistProviderOrder: createProviderOrderWriter(loaded),
					});
				});
			},
		);

	program
		.command("extract")
		.description(
			"提取网页正文并转换为 Markdown（--json/--pretty/--debug 输出 JSON）",
		)
		.argument("<url>", "HTTP(S) URL")
		.option("-p, --provider <id>", "provider instance id，或 auto", "auto")
		.option("--timeout <milliseconds>", "总超时毫秒数", integer)
		.option("--json", "输出 JSON envelope", false)
		.option("--debug", "输出完整路由和脱敏原始响应", false)
		.action(
			(
				url: string,
				options: {
					provider: string;
					timeout?: number;
					json: boolean;
					debug: boolean;
				},
			) => {
				const globals = program.opts<GlobalOptions>();
				const outputMode: CliOutputMode =
					options.json || options.debug || globals.pretty ? "json" : "markdown";
				run(async () => {
					const loaded = loadConfig(globals.config);
					const request: ExtractRequest = {
						url: httpUrl(url),
						provider: options.provider.toLowerCase(),
						timeoutMs: options.timeout,
					};
					return executeExtract(request, {
						loaded,
						signal: processSignal.signal,
						debug: options.debug,
						persistProviderOrder: createProviderOrderWriter(loaded),
					});
				}, outputMode);
			},
		);

	program
		.command("providers")
		.description("列出 provider instance、route 与配置状态")
		.action(() =>
			run(() =>
				executeProviders(loadConfig(program.opts<GlobalOptions>().config)),
			),
		);

	program
		.command("doctor")
		.description("检查本地配置与已启用 provider 的可用性")
		.action(() =>
			run(() =>
				executeDoctor(loadConfig(program.opts<GlobalOptions>().config)),
			),
		);

	const config = program.command("config").description("管理配置文件");
	config
		.command("edit")
		.description("创建默认配置文件并用 VISUAL 或 EDITOR 打开")
		.action(() =>
			run(() =>
				runConfigEdit({
					explicitPath: program.opts<GlobalOptions>().config,
				}),
			),
		);

	return program;
}

function envelopeCommand(args: string[]): EnvelopeCommand | null {
	const nested = args.slice(0, 2).join(".");
	if (COMMANDS.includes(nested as EnvelopeCommand))
		return nested as EnvelopeCommand;
	const command = args[0];
	return COMMANDS.includes(command as EnvelopeCommand)
		? (command as EnvelopeCommand)
		: null;
}

const processSignal = new AbortController();
process.once("SIGINT", () => processSignal.abort());

async function main(): Promise<void> {
	let pending: Promise<OutputEnvelope> | undefined;
	let pendingOutputMode: CliOutputMode = "json";
	const program = createProgram((task, mode = "json") => {
		pendingOutputMode = mode;
		pending = Promise.resolve().then(task);
	});
	if (process.argv.length <= 2) {
		const envelope = errorEnvelope(
			new WebAccessError("invalid_input", "必须指定命令"),
		);
		writeEnvelope(envelope, false);
		process.exitCode = 2;
		return;
	}
	try {
		await program.parseAsync(process.argv);
		if (!pending) throw new WebAccessError("invalid_input", "必须指定命令");
		const envelope = await pending;
		writeOutput(
			envelope,
			pendingOutputMode,
			!!program.opts<GlobalOptions>().pretty,
		);
		process.exitCode = exitCode(envelope);
	} catch (caught) {
		if (
			caught instanceof CommanderError &&
			caught.code === "commander.helpDisplayed"
		)
			return;
		if (caught instanceof CommanderError && caught.code === "commander.version")
			return;
		const normalized =
			caught instanceof CommanderError
				? new WebAccessError(
						"invalid_input",
						caught.code === "commander.help" && program.args[0] === "config"
							? "必须指定 config 子命令"
							: caught.message,
					)
				: asWebAccessError(caught);
		const envelope = errorEnvelope(normalized, envelopeCommand(program.args));
		writeEnvelope(envelope, !!program.opts<GlobalOptions>().pretty);
		process.exitCode = exitCode(envelope);
	}
}

export function isMainModule(
	moduleUrl: string,
	entryPath: string | undefined,
): boolean {
	if (!entryPath) return false;
	try {
		return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
	} catch {
		return false;
	}
}

if (isMainModule(import.meta.url, process.argv[1])) {
	await main();
}
