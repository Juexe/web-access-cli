import open from "open";
import { WebAccessError } from "../core/errors.ts";
import {
	type ConfigEditSuccessEnvelope,
	OUTPUT_SCHEMA_VERSION,
} from "../core/types.ts";
import { resolveConfigPath } from "./config.ts";
import { ensureConfigFile } from "./file.ts";

export {
	CONFIG_SCHEMA_URL,
	ensureConfigFile,
	serializeDefaultConfig,
} from "./file.ts";

export interface EditorCommand {
	variable: "VISUAL" | "EDITOR";
	command: string;
	arguments: string[];
}

export type OpenPath = (
	path: string,
	editor: EditorCommand,
) => Promise<unknown>;

export interface ConfigEditOptions {
	explicitPath?: string;
	env?: NodeJS.ProcessEnv;
	openPath?: OpenPath;
	now?: () => number;
}

function elapsed(start: number, now: () => number): number {
	return Math.max(0, Math.round(now() - start));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseEditorCommand(value: string): string[] {
	const tokens: string[] = [];
	let token = "";
	let quote: '"' | "'" | undefined;
	let tokenStarted = false;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (quote) {
			if (character === quote) {
				quote = undefined;
				tokenStarted = true;
				continue;
			}
			if (quote === "'") {
				token += character;
				tokenStarted = true;
				continue;
			}
			if (character === "\\") {
				const next = value[index + 1];
				if (next === undefined) throw new Error("编辑器命令包含未完成的转义");
				if (next === quote || next === "\\") {
					token += next;
					index += 1;
					continue;
				}
			}
			token += character;
			tokenStarted = true;
			continue;
		}

		if (character === "'" || character === '"') {
			quote = character;
			tokenStarted = true;
			continue;
		}
		if (/\s/u.test(character)) {
			if (tokenStarted) {
				tokens.push(token);
				token = "";
				tokenStarted = false;
			}
			continue;
		}
		if (character === "\\") {
			const next = value[index + 1];
			if (next === undefined) throw new Error("编辑器命令包含未完成的转义");
			if (next === "\\" || /\s/u.test(next) || next === "'" || next === '"') {
				token += next;
				index += 1;
			} else {
				token += character;
			}
			tokenStarted = true;
			continue;
		}
		token += character;
		tokenStarted = true;
	}

	if (quote) throw new Error("编辑器命令包含未闭合的引号");
	if (tokenStarted) tokens.push(token);
	if (!tokens[0]) throw new Error("编辑器命令不能为空");
	return tokens;
}

function resolveEditorCommand(env: NodeJS.ProcessEnv): EditorCommand {
	for (const variable of ["VISUAL", "EDITOR"] as const) {
		const value = env[variable]?.trim();
		if (!value) continue;
		const tokens = parseEditorCommand(value);
		return { variable, command: tokens[0], arguments: tokens.slice(1) };
	}
	throw new Error("未设置 VISUAL 或 EDITOR");
}

const openWithEditor: OpenPath = async (path, editor) => {
	await open(path, {
		app: { name: editor.command, arguments: editor.arguments },
		wait: false,
	});
};

export async function executeConfigEdit(
	options: ConfigEditOptions = {},
): Promise<ConfigEditSuccessEnvelope> {
	const now = options.now ?? performance.now.bind(performance);
	const started = now();
	const path = resolveConfigPath(options.explicitPath, options.env);
	const created = await ensureConfigFile(path);
	try {
		const editor = resolveEditorCommand(options.env ?? process.env);
		await (options.openPath ?? openWithEditor)(path, editor);
	} catch (error) {
		throw new WebAccessError(
			"open_failed",
			`无法用配置编辑器打开配置文件: ${path}`,
			{
				details: { path, created, cause: errorMessage(error) },
			},
		);
	}

	return {
		schemaVersion: OUTPUT_SCHEMA_VERSION,
		ok: true,
		command: "config.edit",
		durationMs: elapsed(started, now),
		data: { path, created, opened: true },
	};
}
